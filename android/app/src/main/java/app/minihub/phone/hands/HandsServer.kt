package app.minihub.phone.hands

import android.util.Log
import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.Gate
import app.minihub.phone.consent.MiniGate
import app.minihub.phone.link.Commands
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Where Mini's session reaches the hands, and the token it must show. Held in memory only: never logged, never written. */
data class HandsInfo(val url: String, val token: String) {
    override fun toString() = "HandsInfo(url=$url)"
}

/**
 * The hands endpoint (docs/08 > The hands endpoint): a small HTTP server on 127.0.0.1 that Mini's session calls
 * through the plugin's `phone_status` and `phone_read`. It refuses any caller without the token made at the last
 * [start], any request with an Origin header, and any Host but this phone's loopback address. It decides nothing
 * itself: every call goes to [MiniGate]. A call the owner is asked about gets a ticket the plugin polls.
 *
 * It holds no Context: the owner is asked through [askOwner], refused callers go to [audit], and [onStop] tells it
 * when Mini is stopped, which ends every open ticket. A ticket that ends by anything but the owner's answer takes its
 * question off the screen, and only one of Mini's questions waits at a time.
 */
class HandsServer(
    private val tools: PhoneTools,
    private val gate: MiniGate,
    /** Shows the owner the question; calls back once with their answer. Returns the way to take the question down. */
    private val askOwner: (question: String, until: Long, answer: (Boolean) -> Unit) -> () -> Unit,
    private val audit: Audit,
    /** Registers what to do when Mini is stopped (on the phone or from the PC). */
    onStop: (() -> Unit) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val random = SecureRandom()
    @Volatile private var token: ByteArray? = null
    @Volatile private var server: ServerSocket? = null
    private var workers: ThreadPoolExecutor? = null
    /** Approved calls run here, so a run never waits behind the workers' long polls. */
    private val runs = Executors.newSingleThreadExecutor(named("mini-hands-run"))
    private val timer = Executors.newSingleThreadScheduledExecutor(named("mini-hands-timer"))
    private val tickets = ConcurrentHashMap<String, Ticket>()
    private val lastRefusal = AtomicLong(Long.MIN_VALUE / 2)

    /** A call waiting for the owner. Exactly one answer counts: the owner's, the deadline's or Stop's. */
    private class Ticket(
        val id: String,
        val plan: Plan.Run,
        val until: Long,
        val approvalId: String,
        val allowed: List<String>,
        val asked: List<String>,
    ) {
        val answered = AtomicBoolean(false)
        val finished = CountDownLatch(1)
        @Volatile var result: JSONObject? = null
        /** Takes the owner's question down (a no that counts for nothing once the ticket has ended). */
        @Volatile var takeDown: (() -> Unit)? = null
    }

    private class Reply(val status: Int, val body: JSONObject)

    private class BadRequest : Exception()

    init {
        onStop { endOpen(byStop = true) }
    }

    /** The port, while listening (for the Brain screen's details; not secret). */
    val port: Int?
        get() = server?.takeIf { !it.isClosed }?.localPort

    /**
     * Listens on 127.0.0.1 (a port Android chooses) if not yet, and makes a new token: the old one stops at once. Open
     * tickets end, because the session that asked can no longer fetch their answer (the brain restarted).
     */
    @Synchronized
    fun start(): HandsInfo {
        endOpen(byStop = false)
        val s = server?.takeIf { !it.isClosed } ?: bind()
        val hex = hex(32)
        token = hex.toByteArray(Charsets.UTF_8)
        return HandsInfo("http://127.0.0.1:${s.localPort}", hex)
    }

    /**
     * Closes the socket and forgets the token. Open tickets end as "stopped" when Mini was stopped ([byStop]), else as
     * failed: the brain went to rest or was given up on, which is not the owner's Stop.
     */
    @Synchronized
    fun stop(byStop: Boolean = true) {
        token = null
        // Tickets end first, so a poll that is waiting gets its answer before its worker goes.
        endOpen(byStop)
        runCatching { server?.close() }
        server = null
        workers?.shutdown()
        workers = null
    }

    private fun bind(): ServerSocket {
        val s = ServerSocket(0, BACKLOG, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
        val pool = ThreadPoolExecutor(WORKERS, WORKERS, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(QUEUE), named("mini-hands-worker"))
        server = s
        workers = pool
        Thread({ accept(s, pool) }, "mini-hands").apply { isDaemon = true }.start()
        return s
    }

    private fun accept(s: ServerSocket, pool: ThreadPoolExecutor) {
        while (!s.isClosed) {
            val c = try {
                s.accept()
            } catch (e: IOException) {
                break
            }
            try {
                c.soTimeout = READ_MS
                pool.execute { serve(c) }
            } catch (e: RejectedExecutionException) {
                runCatching { c.close() }
            } catch (e: IOException) {
                runCatching { c.close() }
            }
        }
    }

    // ---- one request per connection ----

    private fun serve(c: Socket) {
        try {
            c.use {
                val reply = try {
                    handle(c, BufferedInputStream(c.getInputStream()))
                } catch (e: BadRequest) {
                    Reply(400, error("bad request"))
                } catch (e: java.net.SocketTimeoutException) {
                    Reply(400, error("bad request"))
                }
                write(c, reply)
            }
        } catch (e: IOException) {
            // The caller went away. Nothing about it is logged but the kind.
        } catch (e: RuntimeException) {
            Log.w(TAG, "request: ${e.javaClass.simpleName}")
        }
    }

    private fun handle(c: Socket, input: InputStream): Reply {
        val started = now()
        val lines = readHead(c, input, started).split("\r\n")
        val first = lines[0].split(" ")
        if (first.size != 3 || !first[2].startsWith("HTTP/1.") || !first[1].startsWith("/")) throw BadRequest()
        val method = first[0]
        val target = first[1]
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            if (line.isEmpty()) continue
            val colon = line.indexOf(':')
            if (colon <= 0) throw BadRequest()
            val name = line.substring(0, colon).trim().lowercase()
            if (headers.put(name, line.substring(colon + 1).trim()) != null && name in SINGLE) throw BadRequest()
        }
        if ("transfer-encoding" in headers) throw BadRequest()

        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "")

        // Only Mini's session: no browser (Origin), only this loopback address, and the token from the last start.
        // The proof alone needs no token: it is how the plugin knows this is the app before it sends the token.
        if ("origin" in headers || !hostOk(headers["host"]) || !(path == "/v1/proof" || tokenOk(headers["authorization"]))) {
            refused()
            return Reply(401, error("missing or wrong token"))
        }

        return when {
            method == "GET" && path == "/v1/proof" -> {
                if ((headers["content-length"] ?: "0") != "0") throw BadRequest()
                proof(query)
            }
            method == "GET" && path == "/v1/health" -> {
                if ((headers["content-length"] ?: "0") != "0") throw BadRequest()
                Reply(200, JSONObject().put("ok", true).put("tools", JSONArray(listOf("phone_status", "phone_read"))))
            }
            method == "POST" && path == "/v1/tools/call" -> {
                val body = try {
                    JSONObject(String(readBody(c, input, headers, started), Charsets.UTF_8))
                } catch (e: JSONException) {
                    throw BadRequest()
                }
                val tool = body.opt("tool") as? String ?: throw BadRequest()
                val args = when (val a = body.opt("args")) {
                    null, JSONObject.NULL -> JSONObject()
                    is JSONObject -> a
                    else -> throw BadRequest()
                }
                call(tool, args)
            }
            method == "GET" && path == "/v1/tools/ticket" -> {
                if ((headers["content-length"] ?: "0") != "0") throw BadRequest()
                ticket(query)
            }
            else -> Reply(404, error("not found"))
        }
    }

    /** The request line and headers, at most 8 KiB, ending with an empty line, all within the read time. */
    private fun readHead(c: Socket, input: InputStream, started: Long): String {
        val out = ByteArrayOutputStream()
        var tail = 0
        while (true) {
            within(c, started)
            val b = input.read()
            if (b < 0) throw BadRequest()
            out.write(b)
            if (out.size() > MAX_HEAD) throw BadRequest()
            tail = (tail shl 8) or b
            if (tail == 0x0D0A0D0A) break
        }
        return String(out.toByteArray(), 0, out.size() - 4, Charsets.ISO_8859_1)
    }

    /** The whole request has 10 s: each read may wait only for what is left of them. */
    private fun within(c: Socket, started: Long) {
        val left = READ_MS - (now() - started)
        if (left <= 0) throw BadRequest()
        c.soTimeout = left.toInt()
    }

    private fun readBody(c: Socket, input: InputStream, headers: Map<String, String>, started: Long): ByteArray {
        val length = headers["content-length"]?.takeIf { it.isNotEmpty() && it.length <= 6 && it.all(Char::isDigit) }?.toInt()
            ?: throw BadRequest()
        if (length > MAX_BODY) throw BadRequest()
        val body = ByteArray(length)
        var got = 0
        while (got < length) {
            within(c, started)
            val n = input.read(body, got, length - got)
            if (n < 0) throw BadRequest()
            got += n
        }
        return body
    }

    private fun hostOk(host: String?): Boolean {
        val port = server?.localPort ?: return false
        return host == "127.0.0.1:$port" || host.equals("localhost:$port", ignoreCase = true)
    }

    private fun tokenOk(auth: String?): Boolean {
        val expected = token ?: return false
        if (auth == null || auth.length < 7 || !auth.regionMatches(0, "Bearer ", 0, 7, ignoreCase = true)) return false
        return MessageDigest.isEqual(auth.substring(7).trim().toByteArray(Charsets.UTF_8), expected)
    }

    /** Another app knocked: written to the phone's log at most once a minute. */
    private fun refused() {
        val t = now()
        val last = lastRefusal.get()
        if (t - last >= MINUTE_MS && lastRefusal.compareAndSet(last, t)) {
            Log.i(TAG, "refused a caller (401)")
            runCatching { audit.add("Another app", "call Mini's tools", outcome = "refused") }
        }
    }

    private fun write(c: Socket, reply: Reply) {
        val body = reply.body.toString().toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 ${reply.status} ${REASONS[reply.status] ?: "OK"}\r\n" +
            "content-type: application/json\r\n" +
            "cache-control: no-store\r\n" +
            "connection: close\r\n" +
            "content-length: ${body.size}\r\n\r\n"
        val out = c.getOutputStream()
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    // ---- the calls ----

    private fun call(tool: String, args: JSONObject): Reply {
        val plan = try {
            tools.plan(tool, args)
        } catch (e: RuntimeException) {
            Log.w(TAG, "plan: ${e.javaClass.simpleName}")
            val name = tool.takeIf { it in TOOLS } ?: "unknown"
            log { gate.finish(name, "use Mini's tools on this phone", emptyList(), "read", "failed", null, 0, null, "Could not use a tool on this phone") }
            return Reply(200, fail("failed", MiniGate.FAILED))
        }
        when (plan) {
            null -> {
                // Never the name asked for: it could be any text, and the record holds none.
                log { gate.finish("unknown", "use a tool this phone does not have", emptyList(), "read", "refused", "unknown-tool", 0, null, MiniGate.refusedTitle("", "unknown-tool")) }
                return Reply(200, fail("unknown-tool", MiniGate.UNKNOWN_TOOL))
            }
            is Plan.Bad -> {
                log { gate.finish(tool, BAD_ACTION, emptyList(), "read", "refused", "bad-args", 0, null, MiniGate.refusedTitle(BAD_ACTION, "bad-args")) }
                return Reply(200, fail("bad-args", plan.error))
            }
            is Plan.Run -> return when (val g = gate.check(plan)) {
                is Gate.Refuse -> {
                    log { gate.finish(plan, "refused", g.code, 0, null, MiniGate.refusedTitle(plan.action, g.code)) }
                    Reply(200, fail(g.code, g.error))
                }
                is Gate.Go -> Reply(200, run(plan, g.allowed, null))
                is Gate.Ask -> ask(plan, g)
            }
        }
    }

    /** Runs the plan with these scopes and writes how it ended. */
    private fun run(plan: Plan.Run, allowed: List<String>, approvalId: String?): JSONObject = try {
        val done = plan.run(allowed)
        log { gate.finish(plan, "done", null, done.count, approvalId, done.title) }
        JSONObject().put("ok", true).put("text", done.text)
    } catch (e: Exception) {
        Log.w(TAG, "${plan.tool}: ${e.javaClass.simpleName}")
        log { gate.finish(plan, "failed", null, 0, approvalId, "Could not ${plan.action}") }
        fail("failed", MiniGate.FAILED)
    }

    private fun ask(plan: Plan.Run, g: Gate.Ask): Reply {
        val scopes = plan.scopes.distinct()
        val asked = scopes.filter { it !in g.allowed && it !in g.skipped }
        val until = now() + Commands.ASK_MS
        val t = Ticket("t-" + hex(8), plan, until, "a-" + hex(8), g.allowed, asked)
        // One of Mini's questions at a time: a session steered into asking again and again does not pile them up.
        val first = synchronized(tickets) {
            if (tickets.values.any { !it.answered.get() }) {
                false
            } else {
                tickets[t.id] = t
                true
            }
        }
        if (!first) {
            log { gate.finish(plan, "failed", null, 0, null, "Not asked: a question was already waiting") }
            return Reply(200, fail("failed", ALREADY_WAITING))
        }
        log { audit.add("Mini", plan.action, scopes.singleOrNull(), "waiting") }
        timer.schedule({ if (t.answered.compareAndSet(false, true)) end(t, refuse(t, "expired")) }, until - now(), TimeUnit.MILLISECONDS)
        try {
            t.takeDown = askOwner(plan.question(asked.ifEmpty { g.allowed }), until) { yes -> answered(t, yes) }
            // Ended (by Stop, a restart) before the question was put up: it comes down too.
            if (t.result != null) t.takeDown?.let { down -> runCatching { down() } }
        } catch (e: RuntimeException) {
            Log.w(TAG, "ask: ${e.javaClass.simpleName}")
            if (t.answered.compareAndSet(false, true)) {
                log { gate.finish(plan, "failed", null, 0, t.approvalId, "Could not ${plan.action}") }
                end(t, fail("failed", MiniGate.FAILED))
            }
        }
        return Reply(202, JSONObject().put("ticket", t.id).put("until", until))
    }

    /** The owner's tap (or the notification's own deadline, which answers no). */
    private fun answered(t: Ticket, yes: Boolean) {
        if (!t.answered.compareAndSet(false, true)) return
        // The notification answers no itself when its time is up, never before `until`: that no is the deadline's.
        val late = !yes && now() >= t.until
        try {
            runs.execute {
                end(t, if (yes) afterYes(t) else refuse(t, if (late) "expired" else "said-no"))
            }
        } catch (e: RejectedExecutionException) {
            end(t, refuse(t, "stopped"))
        }
    }

    /** Yes: the switches are checked again, so one turned off while the question waited still wins. */
    private fun afterYes(t: Ticket): JSONObject {
        val plan = t.plan
        val skipped = when (val again = gate.check(plan)) {
            is Gate.Refuse -> {
                log { gate.finish(plan, "refused", again.code, 0, t.approvalId, MiniGate.refusedTitle(plan.action, again.code)) }
                return fail(again.code, again.error)
            }
            is Gate.Go -> again.skipped
            is Gate.Ask -> again.skipped
        }
        val scopes = plan.scopes.distinct()
        if (scopes.isEmpty()) return run(plan, emptyList(), t.approvalId)
        // Only what was allowed or asked about when the owner was asked, and is not switched off or uncollected now.
        val approved = (t.allowed + t.asked).toSet()
        val use = scopes.filter { it !in skipped && it in approved }
        if (use.isEmpty()) {
            val (scope, code) = skipped.entries.firstOrNull()?.toPair() ?: (scopes.first() to "not-allowed")
            log { gate.finish(plan, "refused", code, 0, t.approvalId, MiniGate.refusedTitle(plan.action, code)) }
            return fail(code, MiniGate.refusal(scope, code))
        }
        return run(plan, use, t.approvalId)
    }

    private fun refuse(t: Ticket, code: String): JSONObject {
        log { gate.finish(t.plan, "refused", code, 0, t.approvalId, MiniGate.refusedTitle(t.plan.action, code)) }
        return fail(code, MiniGate.text(code))
    }

    /**
     * The ticket's result is kept for 30 s after it is done, then the ticket is forgotten. Its question comes off the
     * card, Home and the notification: after the owner's answer it is gone already, and otherwise a Yes there could no
     * longer do anything.
     */
    private fun end(t: Ticket, result: JSONObject) {
        t.result = result
        t.finished.countDown()
        t.takeDown?.let { down -> runCatching { down() }.onFailure { Log.w(TAG, "take down: ${it.javaClass.simpleName}") } }
        runCatching { timer.schedule({ tickets.remove(t.id) }, KEEP_MS, TimeUnit.MILLISECONDS) }
    }

    /**
     * Every ticket still waiting ends now: as "stopped" for Mini's Stop ([byStop]), else as failed, because the brain
     * restarted or went to rest and the session that asked cannot take the answer.
     */
    private fun endOpen(byStop: Boolean) {
        for (t in tickets.values.toList()) {
            if (!t.answered.compareAndSet(false, true)) continue
            if (byStop) {
                end(t, refuse(t, "stopped"))
            } else {
                log { gate.finish(t.plan, "failed", null, 0, t.approvalId, "Not asked any more: Mini's brain restarted") }
                end(t, fail("failed", RESTARTED))
            }
        }
    }

    private fun params(query: String): Map<String, String> {
        val params = HashMap<String, String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val k = pair.substringBefore('=')
            val v = runCatching { URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8") }.getOrElse { throw BadRequest() }
            params[k] = v
        }
        return params
    }

    /**
     * The endpoint proves it is the app that made the token: the HMAC-SHA256 of the plugin's fresh nonce, keyed with
     * the token. Another app that took this port after the app's process ended has no token and cannot answer.
     */
    private fun proof(query: String): Reply {
        val nonce = params(query)["nonce"]?.takeIf { NONCE.matches(it) } ?: throw BadRequest()
        val key = token ?: return Reply(401, error("missing or wrong token"))
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
        return Reply(200, JSONObject().put("proof", hexOf(mac.doFinal(nonce.toByteArray(Charsets.UTF_8)))))
    }

    private fun ticket(query: String): Reply {
        val params = params(query)
        val id = params["id"]
        val t = id?.takeIf { TICKET.matches(it) }?.let { tickets[it] } ?: return Reply(404, error("no such ticket"))
        val wait = params["wait"]?.let { it.toLongOrNull() ?: throw BadRequest() }?.coerceIn(0L, MAX_WAIT_MS) ?: 0L
        if (t.result == null && wait > 0) {
            try {
                t.finished.await(wait, TimeUnit.MILLISECONDS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        val r = t.result ?: return Reply(200, JSONObject().put("done", false))
        return Reply(200, JSONObject().put("done", true).put("result", r))
    }

    /** Writing the log never ends a call: what failed is logged by its kind only. */
    private inline fun log(block: () -> Unit) {
        try {
            block()
        } catch (e: RuntimeException) {
            Log.w(TAG, "log: ${e.javaClass.simpleName}")
        }
    }

    private fun fail(code: String, text: String) = JSONObject().put("ok", false).put("code", code).put("error", text)
    private fun error(text: String) = JSONObject().put("error", text)

    private fun hex(bytes: Int): String {
        val b = ByteArray(bytes)
        random.nextBytes(b)
        return hexOf(b)
    }

    private fun hexOf(b: ByteArray): String {
        val out = StringBuilder(b.size * 2)
        for (x in b) out.append(HEX[(x.toInt() shr 4) and 15]).append(HEX[x.toInt() and 15])
        return out.toString()
    }

    companion object {
        private const val TAG = "MiniHands"
        private const val HEX = "0123456789abcdef"
        private const val WORKERS = 4
        private const val QUEUE = 16
        private const val BACKLOG = 16
        private const val READ_MS = 10_000
        private const val MAX_HEAD = 8 * 1024
        private const val MAX_BODY = 16 * 1024
        private const val MAX_WAIT_MS = 20_000L
        private const val KEEP_MS = 30_000L
        private const val MINUTE_MS = 60_000L
        private const val BAD_ACTION = "read this phone's record"
        const val ALREADY_WAITING = "A question is already waiting for the owner on the phone. Wait for their answer before asking again."
        const val RESTARTED = "Mini's brain on the phone restarted before the owner answered, so the question was taken back."

        private val SINGLE = setOf("host", "authorization", "content-length", "origin")
        private val TICKET = Regex("t-[0-9a-f]{16}")
        private val NONCE = Regex("[0-9a-f]{32}")
        private val TOOLS = setOf("phone_status", "phone_read")
        private val REASONS = mapOf(200 to "OK", 202 to "Accepted", 400 to "Bad Request", 401 to "Unauthorized", 404 to "Not Found")

        private fun named(name: String) = ThreadFactory { r -> Thread(r, name).apply { isDaemon = true } }
    }
}

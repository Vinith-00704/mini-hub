package app.minihub.phone.link

import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.StoredEvent
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The link's frames (docs/04 > The link protocol, protocol/src/link.ts), version 1. Reading checks the same limits
 * as the hub's schema, and the phone's tests read the same example files as the hub's, so the two cannot drift.
 * JSON values that are passed through (event data, command args, a result's data) are kept as JSON text.
 */
sealed interface Frame {
    data class Hello(val deviceId: String, val token: String, val appVersion: String, val lastSeq: Long, val time: Long) : Frame
    data class Welcome(val ackSeq: Long, val time: Long, val collect: Map<String, Boolean>, val settingsRev: Int) : Frame
    data class Refused(val reason: String) : Frame
    data class Pair(val code: String, val commit: String, val deviceName: String, val model: String, val appVersion: String) : Frame
    data class PairNonce(val nonce: String) : Frame
    data class PairReveal(val nonce: String) : Frame
    data class Paired(val deviceId: String, val token: String, val hubName: String) : Frame
    data class Events(val from: Long, val items: List<StoredEvent>) : Frame
    data class Ack(val seq: Long) : Frame
    data class Gap(val from: Long, val to: Long, val reason: String) : Frame
    data class Cmd(val id: String, val name: String, val args: String, val origin: String, val approved: Boolean, val approvalId: String?) : Frame
    data class Waiting(val id: String, val until: Long) : Frame
    data class Result(val id: String, val ok: Boolean, val data: String? = null, val error: String? = null, val code: String? = null) : Frame
    data object Stop : Frame
    data object StopRequest : Frame
    data class Ping(val time: Long) : Frame
    data class Pong(val time: Long) : Frame
    data class Settings(val rev: Int, val collect: Map<String, Boolean>) : Frame
    data class State(
        val battery: Int?,
        val charging: Boolean?,
        val network: String?,
        val brain: String,
        val controlling: Boolean,
        val stopped: Boolean,
        val collect: Map<String, Boolean>?,
        val mini: Map<String, String>,
        val pc: Map<String, String>,
    ) : Frame
}

object Frames {
    const val VERSION = 1
    const val MAX_BATCH = 200

    val SCOPES = setOf(
        "phone.calls.read", "phone.messages.read", "phone.notifications.read", "phone.usage.read", "phone.location.read",
        "phone.screen.read", "phone.control", "phone.reply", "mail.read", "mail.change", "mail.send", "pc.status.read",
        "pc.power", "home.read", "home.control", "echo.speak", "voice.alexa.ask", "voice.alexa.private",
    )
    val EVENT_TYPES = setOf("call", "sms", "chat", "notification", "mail", "device_state", "app_usage", "home_state", "mini_action", "voice_request", "system")
    private val GRANTS = setOf("off", "ask", "on")
    private val NETWORKS = setOf("wifi", "mobile", "none")
    private val BRAINS = setOf("ok", "asleep", "broken")
    private val HEX64 = Regex("^[0-9a-f]{64}$")

    private class Bad : Exception()

    private fun JSONObject.str(k: String, min: Int, max: Int): String {
        val v = opt(k) as? String ?: throw Bad()
        if (v.length < min || v.length > max) throw Bad()
        return v
    }

    private fun JSONObject.optStr(k: String, max: Int): String? {
        if (!has(k) || isNull(k)) return null
        val v = opt(k) as? String ?: throw Bad()
        if (v.length > max) throw Bad()
        return v
    }

    private fun JSONObject.long(k: String, min: Long = 0): Long {
        val v = opt(k) as? Number ?: throw Bad()
        val d = v.toDouble()
        if (d != Math.floor(d) || d < min) throw Bad()
        return v.toLong()
    }

    private fun JSONObject.bool(k: String): Boolean = opt(k) as? Boolean ?: throw Bad()

    private fun JSONObject.version() {
        if (long("v") != VERSION.toLong()) throw Bad()
    }

    private fun collect(o: JSONObject?): Map<String, Boolean> {
        o ?: throw Bad()
        return o.keys().asSequence().associateWith { k -> if (k !in SCOPES) throw Bad() else o.opt(k) as? Boolean ?: throw Bad() }
    }

    private fun grants(o: JSONObject?): Map<String, String> {
        o ?: throw Bad()
        return o.keys().asSequence().associateWith { k ->
            val v = o.opt(k) as? String
            if (k !in SCOPES || v !in GRANTS) throw Bad()
            v!!
        }
    }

    private fun jsonText(v: Any?): String? = when (v) {
        null, JSONObject.NULL -> null
        is JSONObject, is JSONArray -> v.toString()
        // A single value as JSON text (Android's org.json has no valueToString).
        else -> JSONArray().put(v).toString().removePrefix("[").removeSuffix("]")
    }

    private fun event(o: JSONObject): StoredEvent {
        val type = o.str("type", 1, 40)
        if (type !in EVENT_TYPES) throw Bad()
        val data = if (o.has("data")) o.optJSONObject("data") ?: throw Bad() else null
        return StoredEvent(
            o.long("seq", 1),
            NewEvent(
                type = type,
                occurredAt = o.long("occurredAt"),
                who = o.optStr("who", 200),
                whoKey = o.optStr("whoKey", 200),
                app = o.optStr("app", 200),
                title = o.optStr("title", 300),
                body = o.optStr("body", 20_000),
                data = data?.toString(),
            ),
        )
    }

    /** A frame, or null when the text is not a valid version-1 frame. */
    fun parse(text: String): Frame? = try {
        val o = JSONTokener(text).nextValue() as? JSONObject ?: throw Bad()
        when (o.opt("t")) {
            "hello" -> { o.version(); Frame.Hello(o.str("deviceId", 1, 100), o.str("token", 1, 200), o.str("appVersion", 0, 40), o.long("lastSeq"), o.long("time")) }
            "welcome" -> { o.version(); Frame.Welcome(o.long("ackSeq"), o.long("time"), collect(o.optJSONObject("collect")), o.long("settingsRev").toInt()) }
            "refused" -> Frame.Refused(o.str("reason", 1, 300))
            "pair" -> {
                o.version()
                val name = o.str("deviceName", 1, 60).trim()
                if (name.isEmpty()) throw Bad()
                val commit = o.str("commit", 64, 64)
                if (!HEX64.matches(commit)) throw Bad()
                Frame.Pair(o.str("code", 1, 100), commit, name, o.str("model", 0, 100), o.str("appVersion", 0, 40))
            }
            "pair-nonce" -> Frame.PairNonce(o.str("nonce", 16, 100))
            "pair-reveal" -> Frame.PairReveal(o.str("nonce", 16, 100))
            "paired" -> Frame.Paired(o.str("deviceId", 1, 100), o.str("token", 1, 200), o.str("hubName", 0, 60))
            "events" -> {
                val from = o.long("from", 1)
                val arr = o.optJSONArray("items") ?: throw Bad()
                if (arr.length() < 1 || arr.length() > MAX_BATCH) throw Bad()
                val items = (0 until arr.length()).map { event(arr.optJSONObject(it) ?: throw Bad()) }
                items.forEachIndexed { i, e -> if (e.seq != from + i) throw Bad() }
                Frame.Events(from, items)
            }
            "ack" -> Frame.Ack(o.long("seq"))
            "gap" -> {
                val g = Frame.Gap(o.long("from", 1), o.long("to", 1), o.str("reason", 0, 200))
                if (g.to < g.from) throw Bad()
                g
            }
            "cmd" -> {
                val origin = o.str("origin", 1, 10)
                if (origin != "person" && origin != "agent") throw Bad()
                Frame.Cmd(o.str("id", 1, 100), o.str("name", 1, 60), (o.optJSONObject("args") ?: throw Bad()).toString(), origin, o.bool("approved"), o.optStr("approvalId", 100))
            }
            "waiting" -> Frame.Waiting(o.str("id", 1, 100), o.long("until"))
            "result" -> {
                val r = Frame.Result(o.str("id", 1, 100), o.bool("ok"), jsonText(o.opt("data")), o.optStr("error", 500), o.optStr("code", 60))
                if (!r.ok && (r.error == null || r.code == null)) throw Bad()
                r
            }
            "stop" -> Frame.Stop
            "stop-request" -> Frame.StopRequest
            "ping" -> Frame.Ping(o.long("time"))
            "pong" -> Frame.Pong(o.long("time"))
            "settings" -> Frame.Settings(o.long("rev").toInt(), collect(o.optJSONObject("collect")))
            "state" -> {
                val battery = if (o.has("battery")) o.long("battery").toInt().also { if (it > 100) throw Bad() } else null
                val network = o.optStr("network", 10)?.also { if (it !in NETWORKS) throw Bad() }
                val brain = o.str("brain", 1, 10)
                if (brain !in BRAINS) throw Bad()
                val lists = o.optJSONObject("lists") ?: throw Bad()
                Frame.State(
                    battery = battery,
                    charging = if (o.has("charging")) o.bool("charging") else null,
                    network = network,
                    brain = brain,
                    controlling = o.bool("controlling"),
                    stopped = o.bool("stopped"),
                    collect = if (o.has("collect")) collect(o.optJSONObject("collect")) else null,
                    mini = grants(lists.optJSONObject("mini")),
                    pc = grants(lists.optJSONObject("pc")),
                )
            }
            else -> null
        }
    } catch (_: Bad) {
        null
    } catch (_: org.json.JSONException) {
        null
    }

    private fun map(m: Map<String, *>): JSONObject = JSONObject().apply { for ((k, v) in m) put(k, v) }

    private fun eventJson(e: StoredEvent): JSONObject = JSONObject().apply {
        put("seq", e.seq)
        put("type", e.event.type)
        put("occurredAt", e.event.occurredAt)
        e.event.who?.let { put("who", it) }
        e.event.whoKey?.let { put("whoKey", it) }
        e.event.app?.let { put("app", it) }
        e.event.title?.let { put("title", it) }
        e.event.body?.let { put("body", it) }
        e.event.data?.let { put("data", JSONObject(it)) }
    }

    fun encode(f: Frame): String = when (f) {
        is Frame.Hello -> JSONObject().put("t", "hello").put("v", VERSION).put("deviceId", f.deviceId).put("token", f.token).put("appVersion", f.appVersion).put("lastSeq", f.lastSeq).put("time", f.time)
        is Frame.Welcome -> JSONObject().put("t", "welcome").put("v", VERSION).put("ackSeq", f.ackSeq).put("time", f.time).put("collect", map(f.collect)).put("settingsRev", f.settingsRev)
        is Frame.Refused -> JSONObject().put("t", "refused").put("reason", f.reason)
        is Frame.Pair -> JSONObject().put("t", "pair").put("v", VERSION).put("code", f.code).put("commit", f.commit).put("deviceName", f.deviceName).put("model", f.model).put("appVersion", f.appVersion)
        is Frame.PairNonce -> JSONObject().put("t", "pair-nonce").put("nonce", f.nonce)
        is Frame.PairReveal -> JSONObject().put("t", "pair-reveal").put("nonce", f.nonce)
        is Frame.Paired -> JSONObject().put("t", "paired").put("deviceId", f.deviceId).put("token", f.token).put("hubName", f.hubName)
        is Frame.Events -> JSONObject().put("t", "events").put("from", f.from).put("items", JSONArray().apply { f.items.forEach { put(eventJson(it)) } })
        is Frame.Ack -> JSONObject().put("t", "ack").put("seq", f.seq)
        is Frame.Gap -> JSONObject().put("t", "gap").put("from", f.from).put("to", f.to).put("reason", f.reason)
        is Frame.Cmd -> JSONObject().put("t", "cmd").put("id", f.id).put("name", f.name).put("args", JSONObject(f.args)).put("origin", f.origin).put("approved", f.approved).apply { f.approvalId?.let { put("approvalId", it) } }
        is Frame.Waiting -> JSONObject().put("t", "waiting").put("id", f.id).put("until", f.until)
        is Frame.Result -> JSONObject().put("t", "result").put("id", f.id).put("ok", f.ok).apply {
            f.data?.let { put("data", JSONTokener(it).nextValue()) }
            f.error?.let { put("error", it) }
            f.code?.let { put("code", it) }
        }
        Frame.Stop -> JSONObject().put("t", "stop")
        Frame.StopRequest -> JSONObject().put("t", "stop-request")
        is Frame.Ping -> JSONObject().put("t", "ping").put("time", f.time)
        is Frame.Pong -> JSONObject().put("t", "pong").put("time", f.time)
        is Frame.Settings -> JSONObject().put("t", "settings").put("rev", f.rev).put("collect", map(f.collect))
        is Frame.State -> JSONObject().put("t", "state").apply {
            f.battery?.let { put("battery", it) }
            f.charging?.let { put("charging", it) }
            f.network?.let { put("network", it) }
            put("brain", f.brain)
            put("controlling", f.controlling)
            put("stopped", f.stopped)
            f.collect?.let { put("collect", map(it)) }
            put("lists", JSONObject().put("mini", map(f.mini)).put("pc", map(f.pc)))
        }
    }.toString()
}

package app.minihub.phone.brain

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import app.minihub.phone.Phone
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.Prefs
import app.minihub.phone.voice.TalkActivity
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Mini's brain on the phone, as the app sees it (docs/08 > Mini's brain on the phone). */
sealed interface BrainState {
    data object Off : BrainState
    data class Starting(val note: String) : BrainState
    data object Ready : BrainState
    /** Claude Code waits for the owner in its own window (the folder-trust question, a sign-in). */
    data class NeedsYou(val note: String) : BrainState
    /** "Start when asked": the bot is there, the brain starts with the first question. */
    data object Resting : BrainState
    /** Not answering. [retrying]: the keeper is bringing it back by itself; otherwise only the owner's Start does. */
    data class Asleep(val reason: String, val retrying: Boolean) : BrainState
    /** Claude Code itself does not work (D6 "wait and repair"): no automatic retries. */
    data class Broken(val reason: String) : BrainState
}

/**
 * Starts Mini's runtime and Claude Code session in Termux with fresh keys, makes the runtime prove itself, checks its
 * health, brings it back, and gives up plainly. One per MiniService; everything here runs on the main thread, with one
 * worker for the loopback calls. The keys live only in memory: in the start script's standard input, in [client], and
 * in the hands endpoint.
 */
class BrainKeeper(
    context: Context,
    private val phone: Phone,
    /** SharedPrefs(app, "brain"): the mode only. */
    private val prefs: Prefs,
    private val onState: (BrainState) -> Unit,
) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "mini-brain").apply { isDaemon = true } }
    private val random = SecureRandom()

    var state: BrainState = BrainState.Off
        private set

    /** The runtime that proved itself at the last start; null while there is none. */
    @Volatile var client: RuntimeClient? = null
        private set

    /** [KEEP] (the default) or [DEMAND] ("Start when asked"), kept in prefs. */
    var mode: String
        get() = if (prefs.get(MODE) == DEMAND) DEMAND else KEEP
        set(value) {
            val demand = value == DEMAND
            prefs.put(MODE, if (demand) DEMAND else null)
            if (!demand && state == BrainState.Resting && !phone.stopped) launch(BrainState.Starting(STARTING))
            armIdle()
        }

    /** Bumped by every start and stop: an answer for an older one is ignored. */
    private var gen = 0
    /** A start is under way: the script, the proof, or its first 90 seconds of watching Claude Code start. */
    private var launching = false
    private var checking = false
    /** When the keeper restarted the brain by itself (successful or not), in the last 10 minutes; the owner's Start clears it. */
    private val restarts = ArrayDeque<Long>()
    private var pollUntil = 0L
    /** The next poll of a start's watch, so a stop can take it back. */
    private var pollRun: Runnable? = null
    private var closed = false
    private var shownNow = true
    private var lastBusy = 0L
    /** Mini may be running in Termux, from this keeper or from before it (an app process that was killed). */
    private var dirty = true
    /** One prompt waiting for the brain. */
    private var held: ((RuntimeClient?) -> Unit)? = null

    private val healthTick = Runnable { check() }
    private val retryTick = Runnable { restart((state as? BrainState.Asleep)?.reason ?: BRINGING_BACK) }
    private val idleTick = Runnable { idle() }
    private val heldTick = Runnable { release(null) }

    init {
        phone.brainState = BrainState.Off
    }

    /** The owner's Start: clears the restart count. In "Start when asked" the bot shows and the brain rests. */
    fun start() {
        restarts.clear()
        if (phone.stopped) return set(BrainState.Off)
        // Already running or starting: nothing to do. A restart waiting to happen happens now instead.
        if (launching || client != null) {
            armIdle()
            return
        }
        if (mode == DEMAND) halt(BrainState.Resting) else launch(BrainState.Starting(STARTING))
    }

    /** A prompt or Talk: calls back on the main thread with a runtime that is ready, starting it if it may, or null. */
    fun ensure(then: (RuntimeClient?) -> Unit) {
        val c = client
        if (phone.stopped) return then(null)
        if (state == BrainState.Ready && c != null) return then(c)
        when (val s = state) {
            is BrainState.Broken -> return then(null)
            is BrainState.Asleep -> if (!s.retrying) {
                // Given up: only the owner's Start, or a question in "Start when asked", tries again.
                if (mode != DEMAND) return then(null)
                restarts.clear()
            }
            else -> {}
        }
        hold(then)
        when {
            launching || main.hasCallbacks(retryTick) -> {}
            c != null -> check()
            else -> launch(BrainState.Starting(STARTING))
        }
    }

    /** One health check now: the proof, then the state. Also runs on the cadence. */
    fun check() {
        val c = client
        if (c == null || launching || checking) return
        checking = true
        main.removeCallbacks(healthTick)
        val g = gen
        work {
            val report = if (c.proves()) runCatching { StateReader.read(c.state(), null) }.getOrNull() else null
            main.post {
                checking = false
                if (g != gen || c !== client) return@post
                if (report == null || !report.running) return@post lost(c, BRINGING_BACK)
                when (val s = fromReport(report)) {
                    is BrainState.Broken -> giveUp(s)
                    BrainState.Ready -> {
                        set(s)
                        scheduleHealth()
                        release(c)
                    }
                    else -> {
                        set(s)
                        scheduleHealth()
                    }
                }
            }
        }
    }

    /** The bot is on screen (checks every 30 s) or hidden (every 5 minutes). */
    fun shown(isShown: Boolean) {
        if (shownNow == isShown) return
        shownNow = isShown
        if (client != null && !launching && !checking) scheduleHealth()
    }

    /** A prompt was sent or a reply came: "Start when asked" counts its 10 idle minutes from here. */
    fun busy() {
        lastBusy = SystemClock.elapsedRealtime()
        armIdle()
    }

    /** Mini stopped (on the phone, from the PC, the service ending): both tmux sessions end, the hands close. */
    fun stop() = halt(BrainState.Off)

    /**
     * The runtime [c] stopped answering, or did not prove itself before a prompt: asleep with [reason], and a restart.
     * Ignored for a runtime that is no longer the current one.
     */
    fun lost(c: RuntimeClient, reason: String) {
        if (c !== client || launching) return
        restart(reason)
    }

    /** The service is going away: no more work after [stop]. */
    fun close() {
        closed = true
        cancelPoll()
        worker.shutdown()
    }

    // ---- starting ----

    /**
     * A restart by the keeper itself (a failed start, a failed check, a failed proof). Three in 10 minutes, successful or
     * not, and a fourth is not tried: asleep with [reason] until the owner starts Mini.
     */
    private fun restart(reason: String) {
        val now = SystemClock.elapsedRealtime()
        while (restarts.isNotEmpty() && now - restarts.first() > RESTART_WINDOW_MS) restarts.removeFirst()
        if (restarts.size >= MAX_RESTARTS) return giveUp(BrainState.Asleep(reason, false))
        restarts.addLast(now)
        launch(BrainState.Asleep(reason, true))
    }

    /** Starts the runtime with fresh keys; [during] is what the owner sees while the script runs. */
    private fun launch(during: BrainState) {
        if (phone.stopped) return halt(BrainState.Off)
        if (closed) return
        main.removeCallbacks(retryTick)
        main.removeCallbacks(healthTick)
        cancelPoll()
        val g = ++gen
        launching = true
        checking = false
        client = null
        set(during)
        if (!Termux.isInstalled(app)) return giveUp(BrainState.Asleep(NO_TERMUX, false))
        if (!Termux.hasPermission(app)) return giveUp(BrainState.Asleep(NO_PERMISSION, false))
        dirty = true
        val overlayKey = hex(32)
        work {
            val hands = runCatching { phone.hands.start() }
                .onFailure { Log.w(TAG, "hands: ${it.javaClass.simpleName}") }
                .getOrNull()
            main.post {
                if (g != gen) return@post
                if (hands == null) return@post failed(g, HANDS_FAILED)
                val header = "MINI_OVERLAY_KEY=$overlayKey\nMINI_HANDS_URL=${hands.url}\nMINI_HANDS_TOKEN=${hands.token}\n"
                Termux.runAsset(app, "start-mini.sh", header, "Start Mini") { result -> answered(g, overlayKey, result) }
            }
        }
    }

    private fun answered(g: Int, overlayKey: String, result: Termux.Result) {
        if (g != gen) {
            // Mini was stopped (or given up on) while this start was under way: whatever it started goes too, whatever
            // the answer says (a start that timed out may still have started the runtime). The start script also ends
            // itself when it sees the stop's mark, so this is the second line of defence.
            if (!launching && atRest()) stopScript()
            return
        }
        val error = result.error
        if (error != null) {
            if (error == Termux.REFUSED) giveUp(BrainState.Asleep(error, false)) else failed(g, error)
            return
        }
        ReadyLine.parse(result.stdout).fold(
            onSuccess = { rt ->
                val c = RuntimeClient(rt, overlayKey)
                work {
                    val ok = c.proves()
                    main.post { proved(g, c, ok) }
                }
            },
            onFailure = { e ->
                val message = e.message ?: "Mini did not start."
                if (message == NOT_INSTALLED) giveUp(BrainState.Broken(repair(message))) else failed(g, message)
            },
        )
    }

    private fun proved(g: Int, c: RuntimeClient, ok: Boolean) {
        if (g != gen) return
        if (!ok) return failed(g, NO_PROOF)
        client = c
        pollUntil = SystemClock.elapsedRealtime() + START_WATCH_MS
        poll(g, c)
    }

    /** Each second for up to 90 s after a start: how far Claude Code has come. */
    private fun poll(g: Int, c: RuntimeClient) {
        pollRun = null
        if (g != gen || closed) return
        work {
            val report = runCatching { StateReader.read(c.state(), null) }.getOrNull()
            main.post {
                if (g != gen) return@post
                if (report == null || !report.running) return@post failed(g, RUNTIME_GONE)
                when (val s = fromReport(report)) {
                    BrainState.Ready -> ready(c)
                    is BrainState.Broken -> giveUp(s)
                    else -> {
                        set(s)
                        if (SystemClock.elapsedRealtime() < pollUntil) {
                            val next = Runnable { poll(g, c) }
                            pollRun = next
                            main.postDelayed(next, POLL_MS)
                        } else {
                            settle()
                        }
                    }
                }
            }
        }
    }

    private fun ready(c: RuntimeClient) {
        launching = false
        set(BrainState.Ready)
        scheduleHealth()
        armIdle()
        release(c)
    }

    /** 90 s after a start and Claude Code is not taking prompts yet: it waits for the owner. The checks go on. */
    private fun settle() {
        launching = false
        if (state is BrainState.Starting) set(BrainState.NeedsYou(SLOW))
        scheduleHealth()
        armIdle()
    }

    /** A start failed: a restart in 10 s, unless three restarts in 10 minutes have been tried already. */
    private fun failed(g: Int, reason: String) {
        if (g != gen) return
        launching = false
        client = null
        val now = SystemClock.elapsedRealtime()
        while (restarts.isNotEmpty() && now - restarts.first() > RESTART_WINDOW_MS) restarts.removeFirst()
        if (restarts.size >= MAX_RESTARTS) return giveUp(BrainState.Asleep(reason, false))
        set(BrainState.Asleep(reason, true))
        main.postDelayed(retryTick, RETRY_MS)
    }

    private fun cancelPoll() {
        pollRun?.let(main::removeCallbacks)
        pollRun = null
    }

    /** Runs [task] on the worker, unless the keeper is closed. */
    private fun work(task: () -> Unit) {
        if (closed) return
        try {
            worker.execute(task)
        } catch (e: RejectedExecutionException) {
            Log.w(TAG, "worker: ${e.javaClass.simpleName}")
        }
    }

    /**
     * No more tries by itself: the hands close, and what the last start left in Termux (the runtime, Mini's Claude Code
     * session, the wake lock) is stopped, so "asleep" is asleep. Not when Termux refuses the app's commands: the stop
     * script would be refused too.
     */
    private fun giveUp(s: BrainState) {
        launching = false
        checking = false
        client = null
        main.removeCallbacks(healthTick)
        main.removeCallbacks(retryTick)
        main.removeCallbacks(idleTick)
        cancelPoll()
        set(s)
        release(null)
        work { runCatching { phone.hands.stop(byStop = false) } }
        if (dirty && (s as? BrainState.Asleep)?.reason != Termux.REFUSED && Termux.isInstalled(app) && Termux.hasPermission(app)) {
            stopScript()
            dirty = false
        }
    }

    /** Nothing is meant to run in Termux now: off, resting, or given up on until the owner starts Mini. */
    private fun atRest(): Boolean = when (val s = state) {
        BrainState.Off, BrainState.Resting, is BrainState.Broken -> true
        is BrainState.Asleep -> !s.retrying
        else -> false
    }

    /** Ends everything this keeper started and shows [next]. */
    private fun halt(next: BrainState) {
        gen++
        launching = false
        checking = false
        client = null
        main.removeCallbacks(healthTick)
        main.removeCallbacks(retryTick)
        main.removeCallbacks(idleTick)
        cancelPoll()
        // Off is Mini stopped; resting is not, so tickets ended by it are not written as "stopped".
        work { runCatching { phone.hands.stop(byStop = next == BrainState.Off) } }
        if (dirty) stopScript()
        dirty = false
        set(next)
        release(null)
    }

    private fun stopScript() {
        if (!Termux.isInstalled(app) || !Termux.hasPermission(app)) return
        Termux.runAsset(app, "stop-mini.sh", "", "Stop Mini") { }
    }

    // ---- waiting and checking ----

    private fun hold(then: (RuntimeClient?) -> Unit) {
        // Only one prompt waits: an older one is told the brain is not there.
        held?.let { older -> main.post { older(null) } }
        held = then
        main.removeCallbacks(heldTick)
        main.postDelayed(heldTick, HOLD_MS)
        if (client != null && !launching) scheduleHealth()
    }

    private fun release(c: RuntimeClient?) {
        val then = held ?: return
        held = null
        main.removeCallbacks(heldTick)
        then(c)
    }

    private fun scheduleHealth() {
        main.removeCallbacks(healthTick)
        if (client == null) return
        val every = when {
            held != null -> HELD_CHECK_MS
            shownNow -> SHOWN_CHECK_MS
            else -> HIDDEN_CHECK_MS
        }
        main.postDelayed(healthTick, every)
    }

    private fun armIdle() {
        main.removeCallbacks(idleTick)
        if (mode == DEMAND && (client != null || launching)) main.postDelayed(idleTick, IDLE_MS)
    }

    /**
     * "Start when asked": 10 minutes with no prompt and no question waiting, and the brain rests. Waiting means a
     * prompt held for the brain, a question of Mini's on the phone, the Talk sheet listening, the runtime's own
     * question, or a turn still running (a routine's prompt, which never comes through [busy]).
     */
    private fun idle() {
        if (mode != DEMAND) return
        if (held != null || launching || TalkActivity.listening || Approvals.pending().any { it.who == "Mini" }) return armIdle()
        val since = SystemClock.elapsedRealtime() - lastBusy
        if (since < IDLE_MS) {
            main.postDelayed(idleTick, IDLE_MS - since)
            return
        }
        val c = client ?: return halt(BrainState.Resting)
        work {
            val asking = runCatching {
                StateReader.read(c.state(), null).let { it.card != null || it.phase in TURN_PHASES }
            }.getOrDefault(false)
            main.post {
                if (c !== client) return@post
                if (asking) armIdle() else halt(BrainState.Resting)
            }
        }
    }

    private fun set(s: BrainState) {
        if (s == state) return
        state = s
        phone.brainState = s
        onState(s)
    }

    private fun fromReport(r: BrainReport): BrainState = when (r.status) {
        "running" -> BrainState.Ready
        "needs-you" -> BrainState.NeedsYou(r.note ?: NEEDS_YOU)
        "failed" -> BrainState.Broken(repair(r.note ?: "its session keeps closing."))
        else -> BrainState.Starting(STARTING)
    }

    private fun hex(bytes: Int): String = ByteArray(bytes).also(random::nextBytes).joinToString("") { "%02x".format(it) }

    companion object {
        const val KEEP = "keep"
        const val DEMAND = "demand"
        private const val MODE = "mode"
        private const val TAG = "MiniBrain"

        const val STARTING = "Claude Code is starting in Termux…"
        const val RESTING = "Mini starts when you ask something."
        const val BRINGING_BACK = "Mini's brain stopped. Bringing it back…"
        const val NO_PROOF = "Mini's brain did not prove itself."
        const val NOT_INSTALLED = "Claude Code is not installed in Termux."
        private const val NEEDS_YOU = "Claude Code is waiting for you in Termux. Tap Open Claude Code."
        private const val SLOW = "Claude Code has not finished starting. Tap Open Claude Code to see what it is waiting for."
        private const val RUNTIME_GONE = "Mini's runtime stopped while starting. Its log is ~/.mini/runtime.log in Termux."
        private const val HANDS_FAILED = "Mini's tools on this phone could not start."
        private const val NO_TERMUX = "Termux is not installed. The Brain screen in the Mini app shows how to set it up."
        private const val NO_PERMISSION = "Mini may not run commands in Termux yet. Allow it on the Brain screen in the Mini app."

        private const val MAX_RESTARTS = 3
        private const val RESTART_WINDOW_MS = 10 * 60_000L
        private const val RETRY_MS = 10_000L
        private const val POLL_MS = 1000L
        private const val START_WATCH_MS = 90_000L
        private const val HOLD_MS = 90_000L
        private const val HELD_CHECK_MS = 2000L
        private const val SHOWN_CHECK_MS = 30_000L
        private const val HIDDEN_CHECK_MS = 5 * 60_000L
        private const val IDLE_MS = 10 * 60_000L
        /** The runtime's phases while a turn is under way. */
        private val TURN_PHASES = setOf("sending", "thinking", "working")

        /** The D6 repair text: Claude Code itself needs the owner. */
        fun repair(reason: String): String {
            val r = reason.trim().let { if (it.endsWith(".") || it.endsWith("?")) it else "$it." }
            return "Claude Code on this phone is not working: $r Mini keeps recording. To repair it, open Termux, update or " +
                "reinstall Claude Code the way you installed it, run claude once to check it signs in, then tap Restart on " +
                "the Brain screen."
        }
    }
}

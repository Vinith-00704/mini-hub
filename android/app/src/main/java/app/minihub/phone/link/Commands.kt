package app.minihub.phone.link

import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.Grant
import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.consent.Switches

/** Something the PC may ask the phone to do: the scope whose "From my PC" switch decides, its risk, and how to do it. */
class Runner(val scope: String, val risk: String, val title: String, val run: () -> String?)

/**
 * Commands from the PC (docs/04 > Commands). The phone checks its own "From my PC" switch whatever the hub says:
 * off refuses, ask asks the owner on the phone (answering `waiting` first), on runs. An important command the owner
 * did not approve on the PC is always asked about here. Stop is not a command: it is never refused.
 */
class Commands(
    private val switches: Switches,
    private val audit: Audit,
    /** Shows the owner the question; calls back with their answer, or not at all if they never answer. */
    private val askOwner: (question: String, until: Long, answer: (Boolean) -> Unit) -> Unit,
    private val now: () -> Long,
    private val runners: Map<String, Runner>,
    /** Stopped on this phone (or from the PC): nothing from the PC runs until the owner starts Mini again here. */
    private val stopped: () -> Boolean = { false },
    /** Takes the phone's open questions off the screen. */
    private val clearQuestions: () -> Unit = {},
) {
    /** Questions still waiting for the owner, by command id: Stop answers them all. */
    private val open = java.util.concurrent.ConcurrentHashMap<String, () -> Unit>()

    fun handle(cmd: Frame.Cmd, send: (Frame) -> Unit) {
        val who = if (cmd.origin == "person") "Your PC (you)" else "Your PC (Mini)"
        val runner = runners[cmd.name]
        if (runner == null) {
            audit.add(who, cmd.name, outcome = "failed", detail = "unknown")
            return send(Frame.Result(cmd.id, false, error = "This phone does not know how to do that yet.", code = "unavailable"))
        }
        val label = PhoneScopes.find(runner.scope)?.label?.lowercase() ?: runner.scope
        val detail = if (cmd.approved) "approved on the PC" else null
        fun refuse(error: String) {
            audit.add(who, cmd.name, runner.scope, "refused", detail)
            send(Frame.Result(cmd.id, false, error = error, code = "not-allowed"))
        }
        fun run() {
            val result = runCatching { runner.run() }
            result.onSuccess { data ->
                audit.add(who, cmd.name, runner.scope, "done", detail)
                send(Frame.Result(cmd.id, true, data = data))
            }.onFailure {
                audit.add(who, cmd.name, runner.scope, "failed", detail)
                send(Frame.Result(cmd.id, false, error = "The phone could not do that.", code = "unavailable"))
            }
        }

        if (stopped()) {
            audit.add(who, cmd.name, runner.scope, "refused", "stopped")
            return send(Frame.Result(cmd.id, false, error = "Mini is stopped on this phone. Start it again on the phone to allow this.", code = "stopped"))
        }
        val grant = switches.pc(runner.scope)
        if (grant == Grant.Off) return refuse("From my PC is off for $label. You can change it in the Mini app, under Permissions.")
        val mustAsk = grant == Grant.Ask || (runner.risk == "important" && !cmd.approved)
        if (!mustAsk) return run()

        val until = now() + ASK_MS
        send(Frame.Waiting(cmd.id, until))
        audit.add(who, cmd.name, runner.scope, "waiting", detail)
        // Answered once: by the owner, by the deadline, or by Stop. Whatever comes later is ignored.
        val answered = java.util.concurrent.atomic.AtomicBoolean(false)
        open[cmd.id] = {
            if (answered.compareAndSet(false, true)) {
                audit.add(who, cmd.name, runner.scope, "refused", "stopped")
                send(Frame.Result(cmd.id, false, error = "Mini was stopped.", code = "stopped"))
            }
        }
        askOwner("Your PC wants to ${runner.title}. Allow it?", until) { yes ->
            if (!answered.compareAndSet(false, true)) return@askOwner
            open.remove(cmd.id)
            if (yes && !stopped()) run() else refuse("You said no on the phone.")
        }
    }

    /** Stop from the PC. Needs no switch and is never refused (docs/03 > The stop button). */
    fun stop(onStop: () -> Unit) {
        audit.add("Your PC", "stop", outcome = "done")
        // Every question still waiting is answered no (docs/03 > The stop button).
        val waiting = open.values.toList()
        open.clear()
        waiting.forEach { it() }
        clearQuestions()
        onStop()
    }

    companion object {
        /** The same life as an approval on the hub: two minutes. */
        const val ASK_MS = 120_000L
    }
}

/** Waiting before linking again: 2 s, doubling to a minute, and back to 2 s after a good connection. */
class Backoff {
    private var next = FIRST

    fun next(): Long = next.also { next = (next * 2).coerceAtMost(MAX) }

    fun reset() {
        next = FIRST
    }

    companion object {
        const val FIRST = 2_000L
        const val MAX = 60_000L
    }
}

package app.minihub.phone.brain

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.minihub.phone.MiniService
import app.minihub.phone.consent.Prefs
import org.json.JSONArray
import org.json.JSONObject

/** Where Mini's runtime in Termux listens, the token it takes, and the plugin's version. Kept in memory only. */
data class Runtime(val port: Int, val token: String, val version: String? = null) {
    // Never the token, wherever this is printed.
    override fun toString() = "Runtime(port=$port, version=$version)"
}

/** The start script's answer: one `MINI_READY {...}` line, or a `MINI_ERROR <text>` line saying what is wrong. */
object ReadyLine {
    private const val READY = "MINI_READY "
    private const val ERROR = "MINI_ERROR "

    fun parse(stdout: String): Result<Runtime> {
        val lines = stdout.lines().map { it.trim() }
        lines.lastOrNull { it.startsWith(READY) }?.let { line ->
            runCatching {
                val j = JSONObject(line.removePrefix(READY))
                Runtime(j.getInt("port"), j.getString("token"), j.optString("version").takeIf { it.isNotEmpty() })
            }.onSuccess { return Result.success(it) }
        }
        val error = lines.lastOrNull { it.startsWith(ERROR) }?.removePrefix(ERROR)?.trim()
        return Result.failure(IllegalStateException(if (error.isNullOrEmpty()) "Mini did not start." else error))
    }
}

/**
 * What `check-mini.sh` found in Termux (docs/08 > Setting it up, once). [signedIn], [plugin] and [trusted] are null when
 * unknown. [read]: the script's node program ran (else [plugin], [trusted] and [widened] are unknown); [widenedKnown]: Claude Code's
 * settings could be read, so [widened] is an answer and not a guess. [claudeFound]: a claude command exists (its
 * version [claude] may still be missing). [logMore]: Termux's log level is above Normal; [errorNotes]: Termux's plugin
 * error notifications are on (both null: could not be read).
 */
data class TermuxCheck(
    val claude: String?,
    val node: Boolean,
    val tmux: Boolean,
    val git: Boolean,
    val signedIn: Boolean?,
    val plugin: String?,
    val trusted: Boolean?,
    val widened: List<String>,
    val runtime: Boolean,
    val session: Boolean,
    val logMore: Boolean? = null,
    val errorNotes: Boolean? = null,
    val claudeFound: Boolean = false,
    val read: Boolean = false,
    val widenedKnown: Boolean = false,
)

/** The check script's answer: one `MINI_CHECK {json}` line. */
object CheckLine {
    private const val PREFIX = "MINI_CHECK "

    fun parse(stdout: String): Result<TermuxCheck> {
        val line = stdout.lines().map { it.trim() }.lastOrNull { it.startsWith(PREFIX) }
            ?: return Result.failure(IllegalStateException("Termux gave no answer to the check."))
        return runCatching { fromJson(JSONObject(line.removePrefix(PREFIX))) }
            .recoverCatching { throw IllegalStateException("Termux gave an answer to the check that Mini could not read.") }
    }

    /** The same line the script prints, for keeping the last answer. */
    fun line(c: TermuxCheck): String = PREFIX + JSONObject().apply {
        put("claude", c.claude ?: JSONObject.NULL)
        put("node", c.node)
        put("tmux", c.tmux)
        put("git", c.git)
        put("signedIn", c.signedIn ?: JSONObject.NULL)
        put("plugin", c.plugin ?: JSONObject.NULL)
        put("trusted", c.trusted ?: JSONObject.NULL)
        put("widened", if (c.widenedKnown) JSONArray(c.widened) else JSONObject.NULL)
        put("claudeFound", c.claudeFound)
        put("read", c.read)
        put("runtime", c.runtime)
        put("session", c.session)
        put("logMore", c.logMore ?: JSONObject.NULL)
        put("errorNotes", c.errorNotes ?: JSONObject.NULL)
    }

    private fun fromJson(j: JSONObject): TermuxCheck {
        val widened = j.optJSONArray("widened")
        return TermuxCheck(
            claude = text(j, "claude")?.take(40),
            node = j.optBoolean("node", false),
            tmux = j.optBoolean("tmux", false),
            git = j.optBoolean("git", false),
            signedIn = flag(j, "signedIn"),
            plugin = text(j, "plugin")?.take(40),
            trusted = flag(j, "trusted"),
            widened = if (widened == null) emptyList() else (0 until minOf(widened.length(), 10)).mapNotNull { i ->
                widened.optString(i).takeIf { it.isNotBlank() }?.take(60)
            },
            runtime = j.optBoolean("runtime", false),
            session = j.optBoolean("session", false),
            logMore = flag(j, "logMore"),
            errorNotes = flag(j, "errorNotes"),
            claudeFound = j.optBoolean("claudeFound", false) || text(j, "claude") != null,
            read = j.optBoolean("read", false),
            widenedKnown = widened != null,
        )
    }

    private fun text(j: JSONObject, key: String): String? = if (j.isNull(key)) null else j.optString(key).takeIf { it.isNotEmpty() }
    private fun flag(j: JSONObject, key: String): Boolean? = if (j.isNull(key) || !j.has(key)) null else j.optBoolean(key)
}

/** The update script's answer: `MINI_UPDATED <version>` or `MINI_ERROR <text>`. */
object UpdateLine {
    fun parse(stdout: String): Result<String> {
        val lines = stdout.lines().map { it.trim() }
        lines.lastOrNull { it.startsWith("MINI_UPDATED ") }?.removePrefix("MINI_UPDATED ")?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return Result.success(it) }
        val error = lines.lastOrNull { it.startsWith("MINI_ERROR ") }?.removePrefix("MINI_ERROR ")?.trim()
        return Result.failure(IllegalStateException(if (error.isNullOrEmpty()) "Mini Bot was not updated." else error))
    }
}

/** Whether a plugin version is 0.8.0 or later (the start script's rule). */
fun pluginKnowsThePhone(version: String?): Boolean {
    val m = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)").find(version ?: return false) ?: return false
    return m.groupValues[1].toInt() > 0 || m.groupValues[2].toInt() >= 8
}

sealed interface Reply {
    data object Waiting : Reply
    data class Partial(val text: String) : Reply
    data class Final(val text: String, val isError: Boolean) : Reply
    data object Asleep : Reply
}

/** Reads the runtime's state for the reply to one prompt, as it is written (the same rule as the hub's mini connector). */
object ReplyTracker {
    fun read(stateJson: String, promptId: String): Reply {
        val state = runCatching { JSONObject(stateJson) }.getOrNull() ?: return Reply.Asleep
        if (!state.optBoolean("running", false)) return Reply.Asleep
        val preview = state.optJSONObject("activity")?.optJSONObject("preview") ?: return Reply.Waiting
        if (preview.optString("id") != promptId) return Reply.Waiting
        val text = preview.optString("text")
        return if (preview.optBoolean("partial", false)) Reply.Partial(text) else Reply.Final(text, preview.optBoolean("isError", false))
    }
}

/** A question the runtime has put up for the owner (a routine to add, a bot to keep): answered only from the bot. */
data class RuntimeCard(val id: String, val kind: String, val text: String, val options: List<Option>) {
    data class Option(val id: String, val label: String, val primary: Boolean)
}

/**
 * What the runtime's `GET /v1/state` says, as far as the phone uses it: whether it runs, Mini's session
 * (`assistant.status`: starting, running, needs-you, failed, off; and its note), what Mini is doing, the open question,
 * the last announcement, and the reply to [StateReader.read]'s prompt.
 */
data class BrainReport(
    val running: Boolean,
    val status: String?,
    val note: String?,
    val phase: String?,
    val detail: String?,
    val card: RuntimeCard?,
    val announcement: String?,
    val preview: Reply,
)

object StateReader {
    private val ASLEEP = BrainReport(false, null, null, null, null, null, null, Reply.Asleep)

    /** [promptId] is the prompt whose reply is wanted, or null when none is. */
    fun read(stateJson: String, promptId: String?): BrainReport {
        val state = runCatching { JSONObject(stateJson) }.getOrNull() ?: return ASLEEP
        val running = state.optBoolean("running", false)
        val assistant = state.optJSONObject("assistant")
        val activity = state.optJSONObject("activity")
        return BrainReport(
            running = running,
            status = assistant?.text("status"),
            note = assistant?.text("note"),
            phase = activity?.text("phase"),
            detail = activity?.text("detail"),
            card = state.optJSONObject("card")?.let(::card),
            announcement = state.optJSONObject("announcement")?.text("text"),
            preview = when {
                !running -> Reply.Asleep
                promptId == null -> Reply.Waiting
                else -> ReplyTracker.read(stateJson, promptId)
            },
        )
    }

    private fun card(o: JSONObject): RuntimeCard? {
        val id = o.text("id") ?: return null
        val list = o.optJSONArray("options") ?: return null
        val options = (0 until list.length()).mapNotNull { i ->
            val opt = list.optJSONObject(i) ?: return@mapNotNull null
            val optId = opt.text("id") ?: return@mapNotNull null
            RuntimeCard.Option(optId, opt.text("label") ?: optId, opt.optBoolean("primary", false))
        }
        if (options.isEmpty()) return null
        return RuntimeCard(id, o.text("kind") ?: "question", o.optString("text"), options)
    }

    /** A string field, or null when it is missing, null or empty. */
    private fun JSONObject.text(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
}

/**
 * What the Brain screen knows about the setup, kept for the whole app process: the last answer of Check Termux (kept in
 * prefs `brain`, with its time; it holds nothing secret) and an Update Mini Bot under way. Everything runs on the main
 * thread. It reads Termux's and Claude Code's settings only through `check-mini.sh`, and writes none of them.
 */
class BrainSetup(context: Context, private val prefs: Prefs, private val onChange: () -> Unit) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())

    var last: TermuxCheck? = null
        private set
    var checkedAt = 0L
        private set
    /** Why the last check did not run or was not answered; null after one that was. */
    var error: String? = null
        private set
    var checking = false
        private set
    /** Mini is being stopped, the plugin updated, and Mini started again if it was on. */
    var updating = false
        private set
    /** What the last update said. */
    var updateNote: String? = null
        private set

    init {
        prefs.get(CHECK)?.let { CheckLine.parse(it).getOrNull() }?.let {
            last = it
            checkedAt = prefs.get(CHECKED_AT)?.toLongOrNull() ?: 0L
        }
    }

    private fun problem(): String? = when {
        !Termux.isInstalled(app) -> "Termux is not installed."
        !Termux.hasPermission(app) -> "Mini may not run commands in Termux yet. Allow it above."
        else -> null
    }

    /** Runs `check-mini.sh` in Termux and keeps its answer. */
    fun check(keepNote: Boolean = false) {
        if (checking) return
        // What the last update said belongs to that moment: a new check shows what is true now.
        if (!keepNote) updateNote = null
        problem()?.let {
            error = it
            return onChange()
        }
        checking = true
        error = null
        onChange()
        Termux.check(app) { result ->
            checking = false
            result.fold(
                onSuccess = {
                    last = it
                    checkedAt = System.currentTimeMillis()
                    error = null
                    prefs.put(CHECK, CheckLine.line(it))
                    prefs.put(CHECKED_AT, checkedAt.toString())
                },
                onFailure = { error = it.message ?: "Termux gave no answer to the check." },
            )
            onChange()
        }
    }

    /**
     * Update Mini Bot: Mini stops if it runs (an answer still coming is dropped, with "Mini is updating."), the phone's
     * copy of the plugin is updated, and Mini starts again if it was on.
     */
    fun update() {
        if (updating) return
        problem()?.let {
            updateNote = it
            return onChange()
        }
        updating = true
        updateNote = null
        val wasOn = MiniService.running
        if (wasOn) MiniService.stop(app)
        onChange()
        // The stop reaches Termux first; the update takes the plugin's lock, so it never meets a start.
        main.postDelayed({
            Termux.update(app) { result ->
                updating = false
                updateNote = result.fold(
                    onSuccess = { "Mini Bot on this phone is now $it." },
                    onFailure = { it.message ?: "Mini Bot was not updated." },
                )
                if (wasOn) {
                    runCatching { MiniService.start(app) }.onFailure {
                        updateNote += " Mini could not start itself again. Open the Mini app and tap Start Mini."
                    }
                }
                onChange()
                check(keepNote = true)
            }
        }, if (wasOn) STOP_WAIT_MS else 0L)
    }

    /** Restart: Mini stops, and starts again a moment later. */
    fun restart() {
        if (updating) return
        MiniService.stop(app)
        main.postDelayed({ runCatching { MiniService.start(app) } }, RESTART_WAIT_MS)
    }

    private companion object {
        const val RESTART_WAIT_MS = 1500L
        const val CHECK = "check"
        const val CHECKED_AT = "checkedAt"
        const val STOP_WAIT_MS = 1000L
    }
}

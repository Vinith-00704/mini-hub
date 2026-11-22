package app.minihub.phone.brain

import org.json.JSONObject

/** Where Mini's runtime in Termux listens, and the token it takes. Kept in memory only. */
data class Runtime(val port: Int, val token: String)

/** The start script's answer: one `MINI_READY {...}` line, or a `MINI_ERROR <text>` line saying what is wrong. */
object ReadyLine {
    private const val READY = "MINI_READY "
    private const val ERROR = "MINI_ERROR "

    fun parse(stdout: String): Result<Runtime> {
        val lines = stdout.lines().map { it.trim() }
        lines.lastOrNull { it.startsWith(READY) }?.let { line ->
            runCatching {
                val j = JSONObject(line.removePrefix(READY))
                Runtime(j.getInt("port"), j.getString("token"))
            }.onSuccess { return Result.success(it) }
        }
        val error = lines.lastOrNull { it.startsWith(ERROR) }?.removePrefix(ERROR)?.trim()
        return Result.failure(IllegalStateException(if (error.isNullOrEmpty()) "Mini did not start." else error))
    }
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

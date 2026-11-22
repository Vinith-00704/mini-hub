package app.minihub.phone.brain

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runs a script in Termux through its RUN_COMMAND service and gets its output back through this app's own pending
 * intent. Termux runs it only if the owner set `allow-external-apps = true` in Termux and granted this app Termux's
 * "Run commands" permission (docs/08 > Mini's brain on the phone).
 */
object Termux {
    const val PACKAGE = "com.termux"
    const val PERMISSION = "com.termux.permission.RUN_COMMAND"
    private const val BASH = "/data/data/com.termux/files/usr/bin/bash"
    private const val ANSWER_WAIT_MS = 90_000L

    /** The line the owner pastes into Termux once, so Termux accepts commands from Mini. */
    const val ALLOW_LINE = "mkdir -p ~/.termux && echo 'allow-external-apps = true' >> ~/.termux/termux.properties && termux-reload-settings"

    data class Result(val stdout: String, val stderr: String, val exitCode: Int?, val error: String?)

    private val waiting = ConcurrentHashMap<Int, (Result) -> Unit>()
    private val next = AtomicInteger(1)
    private val main = Handler(Looper.getMainLooper())

    fun isInstalled(context: Context): Boolean =
        runCatching { context.packageManager.getPackageInfo(PACKAGE, 0) }.isSuccess

    fun hasPermission(context: Context): Boolean =
        context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    /** Runs the script with bash, in the background, and calls back on the main thread with what it printed. */
    fun run(context: Context, script: String, label: String, onResult: (Result) -> Unit) {
        val id = next.getAndIncrement()
        waiting[id] = onResult
        val answer = Intent(context, TermuxResultReceiver::class.java).putExtra(EXTRA_ID, id)
        val pending = PendingIntent.getBroadcast(context, id, answer, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        val intent = Intent("com.termux.RUN_COMMAND")
            .setClassName(PACKAGE, "com.termux.app.RunCommandService")
            .putExtra("com.termux.RUN_COMMAND_PATH", BASH)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-s"))
            .putExtra("com.termux.RUN_COMMAND_STDIN", script)
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            .putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", label)
            .putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
        try {
            context.startService(intent)
        } catch (e: Exception) {
            finish(id, Result("", "", null, e.message ?: "Termux did not take the command."))
            return
        }
        main.postDelayed({
            finish(id, Result("", "", null, "Termux did not answer. In Termux, the line from Mini's setup screen may still be needed."))
        }, ANSWER_WAIT_MS)
    }

    internal fun deliver(id: Int, bundle: Bundle?) {
        if (bundle == null) return finish(id, Result("", "", null, "Termux gave no answer."))
        val errmsg = bundle.getString("errmsg")?.takeIf { it.isNotBlank() }
        val err = bundle.getInt("err", -1)
        finish(
            id,
            Result(
                stdout = bundle.getString("stdout").orEmpty(),
                stderr = bundle.getString("stderr").orEmpty(),
                exitCode = if (bundle.containsKey("exitCode")) bundle.getInt("exitCode") else null,
                error = if (err > 0 || errmsg != null) explain(errmsg) else null,
            ),
        )
    }

    private fun explain(errmsg: String?): String = when {
        errmsg == null -> "Termux could not run Mini's command."
        errmsg.contains("allow-external-apps", ignoreCase = true) ->
            "Termux does not accept commands from other apps yet. Paste the line from Mini's setup screen into Termux."
        else -> errmsg.lines().firstOrNull { it.isNotBlank() }?.take(300) ?: "Termux could not run Mini's command."
    }

    private fun finish(id: Int, result: Result) {
        val callback = waiting.remove(id) ?: return
        main.post { callback(result) }
    }

    internal const val EXTRA_ID = "app.minihub.phone.TERMUX_ID"
}

/** Receives Termux's answer. Not exported: only a pending intent made by this app reaches it. */
class TermuxResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Termux.deliver(intent.getIntExtra(Termux.EXTRA_ID, -1), intent.getBundleExtra("result"))
    }
}

package app.minihub.phone.brain

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import java.io.IOException
import java.security.SecureRandom
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
    /** A download of the plugin on a slow connection takes longer than a start. */
    private const val UPDATE_WAIT_MS = 180_000L

    /** The line the owner pastes into Termux once, so Termux accepts commands from Mini. */
    const val ALLOW_LINE = "mkdir -p ~/.termux && echo 'allow-external-apps = true' >> ~/.termux/termux.properties && termux-reload-settings"

    data class Result(val stdout: String, val stderr: String, val exitCode: Int?, val error: String?)

    private val waiting = ConcurrentHashMap<Int, (Result) -> Unit>()
    // Request codes start at a random place in each app process, so a script started by a process that was killed
    // cannot answer through the new process's pending intent with the same code.
    private val next = AtomicInteger(SecureRandom().nextInt(1 shl 30) + 1)
    private val main = Handler(Looper.getMainLooper())

    fun isInstalled(context: Context): Boolean =
        runCatching { context.packageManager.getPackageInfo(PACKAGE, 0) }.isSuccess

    fun hasPermission(context: Context): Boolean =
        context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    /** What Termux answers while `allow-external-apps` is not set: the owner's step, not something to retry. */
    const val REFUSED = "Termux does not accept commands from other apps yet. Paste the line from Mini's setup screen into Termux."

    /**
     * Runs one of the app's own scripts (an asset), with [header] put before its text: the start script's keys travel
     * this way, on standard input only (docs/08 > Mini's brain on the phone).
     */
    fun runAsset(context: Context, name: String, header: String, label: String, waitMs: Long = ANSWER_WAIT_MS, onResult: (Result) -> Unit) {
        val script = try {
            context.assets.open(name).bufferedReader().use { it.readText() }
        } catch (e: IOException) {
            main.post { onResult(Result("", "", null, "The app's $name is missing. Reinstall the Mini app.")) }
            return
        }
        run(context, header + script, label, waitMs, onResult)
    }

    /**
     * Asks Termux what is set up (`check-mini.sh`): it only reads. Calls back on the main thread. Termux's refusal of
     * outside apps comes back as [REFUSED].
     */
    fun check(context: Context, onResult: (kotlin.Result<TermuxCheck>) -> Unit) {
        runAsset(context, "check-mini.sh", "", "Check Mini's setup") { r ->
            onResult(if (r.error != null) kotlin.Result.failure(IllegalStateException(r.error)) else CheckLine.parse(r.stdout))
        }
    }

    /** Brings the phone's own copy of the Mini Bot plugin up to date (`update-mini.sh`); the answer is the version. */
    fun update(context: Context, onResult: (kotlin.Result<String>) -> Unit) {
        runAsset(context, "update-mini.sh", "", "Update Mini Bot", UPDATE_WAIT_MS) { r ->
            // Termux's own words for no answer talk about the setup line, which is not what an update needs.
            val error = r.error?.let { if (it.startsWith("Termux did not answer")) "Termux did not answer the update. Check the phone's internet and try again." else it }
            onResult(if (error != null) kotlin.Result.failure(IllegalStateException(error)) else UpdateLine.parse(r.stdout))
        }
    }

    /**
     * Whether this Termux is a debug build (Termux's GitHub build), which a PC on USB with debugging on can read the
     * files of; null while Termux is not installed. Advice only (docs/11 D5).
     */
    fun isDebugBuild(context: Context): Boolean? = runCatching {
        context.packageManager.getApplicationInfo(PACKAGE, 0).flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    }.getOrNull()

    /**
     * Opens Termux in front, attached to Mini's own Claude Code session, for the owner to answer what waits there (the
     * folder-trust question, a sign-in). The app types nothing into it. Returns what went wrong, or null.
     */
    fun openSession(context: Context): String? {
        val intent = Intent("com.termux.RUN_COMMAND")
            .setClassName(PACKAGE, "com.termux.app.RunCommandService")
            .putExtra("com.termux.RUN_COMMAND_PATH", BASH)
            .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", ATTACH))
            .putExtra("com.termux.RUN_COMMAND_BACKGROUND", false)
            .putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
            .putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Mini's Claude Code")
        return try {
            context.startForegroundService(intent)
            null
        } catch (e: Exception) {
            "Termux could not be opened. Open Termux and run: tmux -L mini attach -t mini"
        }
    }

    private const val ATTACH =
        "unset LD_PRELOAD; tmux -L mini attach -t mini || { echo 'Mini is not running. Start Mini in the Mini app first.'; sleep 5; }"

    /**
     * Runs the script with bash, in the background, and calls back on the main thread with what it printed. Termux's
     * service is started as a foreground service (Termux's own advice since Android 8): a plain start is refused while
     * Termux is not running, as after it was killed.
     */
    fun run(context: Context, script: String, label: String, waitMs: Long = ANSWER_WAIT_MS, onResult: (Result) -> Unit) {
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
            context.startForegroundService(intent)
        } catch (e: Exception) {
            finish(id, Result("", "", null, e.message ?: "Termux did not take the command."))
            return
        }
        main.postDelayed({
            finish(id, Result("", "", null, "Termux did not answer. In Termux, the line from Mini's setup screen may still be needed."))
        }, waitMs)
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
        errmsg.contains("allow-external-apps", ignoreCase = true) -> REFUSED
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

package app.minihub.phone.consent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.minihub.phone.R
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * The phone's own approvals (docs/08 > Approvals on the phone): a notification that says who is asking, with Allow
 * and Don't allow. Only the owner's tap answers it; no answer by the deadline is a no. A fuller card over the
 * screen comes with Phase 3.
 */
object Approvals {
    private const val CHANNEL = "approvals"
    private const val ACTION = "app.minihub.phone.APPROVAL"
    private val waiting = ConcurrentHashMap<Int, (Boolean) -> Unit>()
    private val ids = AtomicInteger(100)

    fun ask(context: Context, question: String, until: Long, answer: (Boolean) -> Unit) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Questions from Mini and your PC", NotificationManager.IMPORTANCE_HIGH))
        val id = ids.incrementAndGet()
        waiting[id] = answer
        fun action(yes: Boolean) = PendingIntent.getBroadcast(
            context,
            id * 2 + if (yes) 1 else 0,
            Intent(context, ApprovalReceiver::class.java).setAction(ACTION).putExtra("id", id).putExtra("yes", yes),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val ms = (until - System.currentTimeMillis()).coerceAtLeast(1_000)
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_mini)
            .setContentTitle("Your PC is asking")
            .setContentText(question)
            .setStyle(Notification.BigTextStyle().bigText(question))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setTimeoutAfter(ms)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Allow", action(true)).build())
            .addAction(Notification.Action.Builder(null, "Don't allow", action(false)).build())
            .build()
        nm.notify(id, n)
        // No answer in time is a no.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ answer(id, false, context) }, ms)
    }

    /** Stop: every open question is answered no and taken off the screen. */
    fun noAll(context: Context) {
        for (id in waiting.keys.toList()) answer(id, false, context)
    }

    fun answer(id: Int, yes: Boolean, context: Context) {
        val fn = waiting.remove(id) ?: return
        context.getSystemService(NotificationManager::class.java).cancel(id)
        fn(yes)
    }
}

class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Approvals.answer(intent.getIntExtra("id", -1), intent.getBooleanExtra("yes", false), context)
    }
}

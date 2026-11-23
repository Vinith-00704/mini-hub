package app.minihub.phone.consent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import app.minihub.phone.MainActivity
import app.minihub.phone.R
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** One question waiting for the owner: who asks ("Mini" or "Your PC"), the words, and the deadline (epoch ms). */
data class Question(val id: Int, val who: String, val text: String, val until: Long)

/**
 * The phone's own approvals (docs/08 > Approvals on the phone): a card over the screen and a notification, both saying
 * who is asking. Yes is answered only by the owner's finger on the card's or Home's Yes button; the notification has No
 * and Open (to Home), never Yes. No answer by the deadline is a no, and so is Stop. Nothing else, no token and no tool,
 * answers yes.
 * Questions live in memory only; the text is never logged.
 */
object Approvals {
    private const val CHANNEL = "approvals"
    private const val ACTION = "app.minihub.phone.APPROVAL"

    private class Open(val question: Question, val answer: (Boolean) -> Unit, val deadline: Runnable)

    private val lock = Any()
    /** Oldest first: a LinkedHashMap keeps the order the questions came in. */
    private val open = LinkedHashMap<Int, Open>()
    // A random start, so a notification action kept from an earlier run of the app never matches a new question.
    private val ids = AtomicInteger(100 + java.security.SecureRandom().nextInt(1_000_000))
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val main by lazy { Handler(Looper.getMainLooper()) }

    /**
     * Puts a question to the owner: [who] is "Mini" or "Your PC". [answer] is called once, with the owner's tap, or with
     * false when [until] passes or Stop comes. Returns the question's number.
     */
    fun ask(context: Context, who: String, question: String, until: Long, answer: (Boolean) -> Unit): Int {
        val app = context.applicationContext
        val nm = app.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Questions from Mini and your PC", NotificationManager.IMPORTANCE_HIGH))
        val id = ids.incrementAndGet()
        // The notification can only say no. Yes is the owner's own tap on the card or on Home (a notification's action can
        // be fired by any app that is allowed to read notifications), so Open takes the owner to the question.
        val no = PendingIntent.getBroadcast(
            app,
            id * 2,
            Intent(app, ApprovalReceiver::class.java).setAction(ACTION).putExtra("id", id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val openHome = PendingIntent.getActivity(
            app,
            id * 2 + 1,
            Intent(app, MainActivity::class.java).putExtra(MainActivity.OPEN_HOME, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val ms = (until - System.currentTimeMillis()).coerceAtLeast(1_000)
        // No answer in time is a no.
        val deadline = Runnable { answer(id, false, app) }
        synchronized(lock) { open[id] = Open(Question(id, who, question, until), answer, deadline) }
        val n = Notification.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_mini)
            .setContentTitle("$who is asking")
            .setContentText(question)
            .setStyle(Notification.BigTextStyle().bigText(question))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setTimeoutAfter(ms)
            .setAutoCancel(true)
            .setContentIntent(openHome)
            // The question holds no record content, so the lock screen can show it and its No.
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            // No works from the lock screen; Open needs the phone unlocked.
            .addAction(Notification.Action.Builder(null, "No", no).build())
            .addAction(Notification.Action.Builder(null, "Open", openHome).setAuthenticationRequired(true).build())
            .build()
        nm.notify(id, n)
        main.postDelayed(deadline, ms)
        changed()
        return id
    }

    /** The questions waiting now, oldest first. */
    fun pending(): List<Question> = synchronized(lock) { open.values.map { it.question } }

    /** How many questions are waiting for the owner now (Mini's phone_status says so). */
    fun waitingCount(): Int = synchronized(lock) { open.size }

    /** Stop: every open question is answered no and taken off the screen. */
    fun noAll(context: Context) {
        for (q in pending()) answer(q.id, false, context)
    }

    /** Calls [fn] whenever a question comes or goes (from any thread). Returns the way to stop. */
    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    /** The owner's tap (or the deadline, or Stop): answered once, taken off the screen and out of the notifications. */
    fun answer(id: Int, yes: Boolean, context: Context) {
        val taken = synchronized(lock) { open.remove(id) } ?: return
        main.removeCallbacks(taken.deadline)
        context.applicationContext.getSystemService(NotificationManager::class.java).cancel(id)
        try {
            taken.answer(yes)
        } finally {
            changed()
        }
    }

    private fun changed() = listeners.forEach { runCatching { it() } }
}

class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Only ever a no: a yes is the owner's tap on the card or on Home.
        Approvals.answer(intent.getIntExtra("id", -1), false, context)
    }
}

package app.minihub.phone.collect

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.telecom.TelecomManager
import android.util.Log
import app.minihub.phone.consent.Prefs
import app.minihub.phone.consent.Switches
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/** What a source still needs before it can run, in the order it is asked for (protocol/src/link.ts > NEEDS). */
enum class Need(val wire: String) { Permission("permission"), NotificationAccess("notification-access"), Apps("apps") }

/** One source as the Permissions screen shows it: running, or what it still needs. */
data class SourceStatus(val name: String, val running: Boolean, val need: Need?, val permission: String? = null)

/** What every source is given: the app, the record, the collectors' prefs and thread, and a way to say it was refused. */
class Shared(
    val context: Context,
    val record: Record,
    val prefs: Prefs,
    val handler: Handler,
    val refused: (Source, Need) -> Unit,
)

/**
 * One way the phone's record is fed (calls, SMS, and the notification listener's two). [Collectors] runs it,
 * on its own thread, only while its collect switch is on and Android allows it.
 */
abstract class Source(val name: String, val key: String, val scope: String, val permission: String?) {
    @Volatile var running = false
        protected set

    /** A refusal seen while reading (Android said no although the permission looked granted); cleared by refresh. */
    @Volatile var refused: Need? = null

    /** What Android has not allowed yet, checked now; null when the source may run. */
    abstract fun missing(): Need?

    /** The source has just become allowed (switch on and permission granted): from now on only, no history. */
    open fun fresh() {}

    /** Registers and catches up. */
    abstract fun begin()

    /** Unregisters at once. */
    abstract fun end()
}

/**
 * A source read from one of Android's content providers (the call log, the SMS store): a content observer says
 * something changed, and 1.5 s after the last change the source catches up. It reads only rows written since it
 * was turned on (`<key>:since`), after the last row it took (`<key>:lastId`, in `_ID` order, 500 at a time) or
 * newer than the newest one it took (`<key>:lastDate`: a provider may give a deleted newest row's `_ID` to the next
 * one). So anything written while the app was not running is caught up at the next start, with its real time.
 */
abstract class ProviderSource(
    name: String,
    key: String,
    scope: String,
    private val perm: String,
    protected val shared: Shared,
    private val uri: Uri,
) : Source(name, key, scope, perm) {
    protected val context: Context get() = shared.context
    protected val record: Record get() = shared.record
    private val catchUp = Runnable { read() }
    private val observer = object : ContentObserver(shared.handler) {
        override fun onChange(selfChange: Boolean) {
            shared.handler.removeCallbacks(catchUp)
            shared.handler.postDelayed(catchUp, DEBOUNCE_MS)
        }
    }

    /** The provider's rows for `selection` (on `_id` and `date`), in `sort` order; at most `limit` are read from it. */
    protected abstract fun query(columns: Array<String>, selection: String?, args: Array<String>?, sort: String, limit: Int): Cursor?

    /** The columns [take] reads; the first is `_id`. */
    protected abstract val columns: Array<String>

    /** Records one row (the cursor is on it). False while the row is still waiting to be sent: it is read again later. */
    protected abstract fun take(c: Cursor): Boolean

    override fun missing(): Need? =
        if (context.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) null else Need.Permission

    override fun fresh() {
        val now = System.currentTimeMillis()
        // The rows already there are history, whatever their dates say (the clock may have been moved back).
        val top = first("_id")
        val newest = maxOf(now, first("date"))
        shared.prefs.put("$key:since", now.toString())
        shared.prefs.put("$key:lastId", top.toString())
        shared.prefs.put("$key:lastDate", newest.toString())
    }

    /** The largest value of `column` now (`_id` or `date`), or 0. */
    private fun first(column: String): Long =
        query(arrayOf(column), null, null, "$column DESC", 1)?.use { if (it.moveToFirst()) it.getLong(0) else 0L } ?: 0L

    override fun begin() {
        if (running) return
        try {
            context.contentResolver.registerContentObserver(uri, true, observer)
        } catch (e: SecurityException) {
            return refuse()
        }
        running = true
        read()
    }

    override fun end() {
        running = false
        shared.handler.removeCallbacks(catchUp)
        runCatching { context.contentResolver.unregisterContentObserver(observer) }
    }

    /** Catches up at once instead of after the wait (on the collectors' thread). */
    fun catchUpNow() {
        shared.handler.removeCallbacks(catchUp)
        read()
    }

    private fun read() {
        if (!running) return
        // Checked before every query: a permission taken away in Android's settings stops the source, no crash.
        if (missing() != null) return refuse()
        try {
            if (shared.prefs.get("$key:since") == null) fresh()
            val since = shared.prefs.get("$key:since")?.toLongOrNull() ?: return
            val start = shared.prefs.get("$key:lastId")?.toLongOrNull() ?: 0L
            val lastDate = shared.prefs.get("$key:lastDate")?.toLongOrNull() ?: since
            var done = lastDate
            var waitingDate = Long.MAX_VALUE

            /** Takes up to [BATCH] rows; [onRow] gets each row's `_ID` and whether it is done with. Returns the count. */
            fun takeAll(c: Cursor, onRow: (Long, Boolean) -> Unit): Int {
                var n = 0
                val idCol = c.getColumnIndexOrThrow("_id")
                val dateCol = c.getColumnIndexOrThrow("date")
                while (n < BATCH && c.moveToNext()) {
                    n++
                    val date = c.getLong(dateCol)
                    val ok = take(c)
                    if (ok) done = maxOf(done, date) else waitingDate = minOf(waitingDate, date)
                    onRow(c.getLong(idCol), ok)
                }
                return n
            }

            // Under the saved place but newer than the newest row taken: an `_ID` given again after the newest row
            // was deleted. A row read twice is folded by its fingerprint (which holds its date).
            query(columns, "date >= ? AND date > ? AND _id <= ?", arrayOf(since.toString(), lastDate.toString(), start.toString()), "_id ASC", BATCH)
                ?.use { takeAll(it) { _, _ -> } }

            var after = start
            var keep = start
            var waiting = false
            while (running) {
                val c = query(columns, "date >= ? AND _id > ?", arrayOf(since.toString(), after.toString()), "_id ASC", BATCH) ?: break
                val n = c.use {
                    takeAll(it) { id, ok ->
                        after = id
                        // A row still waiting holds the saved place below it; the rows after it are read on (and
                        // folded by their fingerprints when read again).
                        if (!ok) waiting = true
                        if (!waiting) keep = id
                    }
                }
                if (keep != start) shared.prefs.put("$key:lastId", keep.toString())
                if (n < BATCH) break
            }
            // The newest date taken, but below any row still waiting, so that row is found again once sent.
            val newDate = if (waitingDate == Long.MAX_VALUE) done else minOf(done, waitingDate - 1)
            if (newDate != lastDate) shared.prefs.put("$key:lastDate", newDate.toString())
        } catch (e: SecurityException) {
            refuse()
        } catch (e: RuntimeException) {
            Log.w(TAG, "$key: ${e.javaClass.simpleName}")
        }
    }

    private fun refuse() {
        end()
        shared.refused(this, Need.Permission)
    }

    companion object {
        const val BATCH = 500
        const val DEBOUNCE_MS = 1_500L
        private const val TAG = "MiniCollect"
    }
}

/**
 * The record's collectors (docs/08 > The record): one coordinator over every source, all on one thread
 * ("mini-collect"). A source runs only while its collect switch is on and Android allows it; otherwise it is not
 * registered at all. Nothing here asks Android for anything: the Permissions screen's buttons do.
 */
class Collectors(context: Context, record: Record, private val switches: Switches, private val prefs: Prefs) {
    private val thread = HandlerThread("mini-collect").apply { start() }
    private val handler = Handler(thread.looper)
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val shared = Shared(context.applicationContext, record, prefs, handler) { source, need ->
        source.refused = need
        handler.post(::sync)
    }
    /** "Apps to include": the apps whose notifications are read at all. */
    val apps = Apps(prefs)
    private val chats = NotesSource("Chat apps", "chats", MESSAGES, "chat", shared, apps, ::notesAccess, ::showing)
    private val notes = NotesSource("Notifications", "notes", NOTIFICATIONS, "notification", shared, apps, ::notesAccess, ::showing)
    private val sms = SmsCollector(shared)
    private val sources: List<Source> = listOf(
        CallLogCollector(shared),
        sms,
        chats,
        notes,
    )
    // The SMS app's messages passed over as the SMS already stored, so its re-posts pass them over too (this thread only).
    private val smsTwins = LinkedHashSet<String>()
    @Volatile private var started = false
    private var exitsChecked = false
    // The apps ticked when the collectors' thread last looked: an app ticked since then shows only history.
    private var ticked: Set<String> = apps.chosen()
    private val labels = ConcurrentHashMap<String, String>()

    init {
        // Followed even before start: a switch going off forgets its place at once (even if it is turned on again
        // before the collectors' thread looks), so turning it on later starts afresh.
        switches.onChange {
            sources.forEach { if (!switches.collect(it.scope)) prefs.put("${it.key}:on", null) }
            handler.post(::sync)
        }
        apps.onChange { handler.post(::appsChanged) }
    }

    /** Starts every source that may run, and follows the switches. Safe to call again. */
    fun start() {
        handler.post {
            if (!exitsChecked) {
                exitsChecked = true
                afterPermissionChange()
            }
            started = true
            sync()
        }
    }

    /**
     * Android ends the app when a permission is taken away, so the collectors never see it go. If the app last ended
     * that way (since the last look), every source starts afresh: access may have been off meanwhile, and what
     * happened then is not read. Android does not say which permission changed, so this errs on the side of less.
     */
    private fun afterPermissionChange() {
        val app = shared.context
        val exits = runCatching {
            app.getSystemService(ActivityManager::class.java)?.getHistoricalProcessExitReasons(app.packageName, 0, 0)
        }.getOrNull().orEmpty()
        val seen = prefs.get("exits:checked")?.toLongOrNull() ?: 0L
        if (exits.any { it.timestamp > seen && it.reason == ApplicationExitInfo.REASON_PERMISSION_CHANGE }) {
            sources.forEach { prefs.put("${it.key}:on", null) }
        }
        val newest = exits.maxOfOrNull { it.timestamp } ?: return
        if (newest > seen) prefs.put("exits:checked", newest.toString())
    }

    fun stop() {
        handler.post {
            started = false
            sources.forEach { if (it.running) it.end() }
            told()
        }
    }

    /** Checks permissions and access again (the app coming back, an answer to a permission request). */
    fun refresh() {
        handler.post {
            sources.forEach { it.refused = null }
            dropRemovedApps()
            sync()
        }
    }

    /** The notification listener's name, for Android's notification access screen. */
    fun notesComponent(): ComponentName = ComponentName(shared.context, NotesListener::class.java)

    /** Whether the owner has given Mini notification access in Android's settings. */
    fun notesAccess(): Boolean =
        runCatching { shared.context.getSystemService(NotificationManager::class.java)?.isNotificationListenerAccessGranted(notesComponent()) }
            .getOrNull() == true

    /**
     * A notification was posted (on the listener's thread). Passed over at once unless it comes from a ticked app
     * other than Mini and the phone app, and one of the two sources runs; read on the collectors' thread.
     *
     * The default SMS app's messages are mostly the SMS already read from the SMS store: one is passed over when an
     * SMS from the same sender with the same text was stored in the last 2 minutes, and kept as a chat otherwise
     * (RCS messages arrive only this way). The SMS store is read first, a moment after the notification, so the SMS
     * is there to compare with.
     */
    fun onNote(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return
        if (pkg == shared.context.packageName || pkg !in apps.chosen()) return
        // Calls come from the call log; the phone app's notifications are never read.
        if (pkg == dialer()) return
        if (!chats.running && !notes.running) return
        val fromSmsApp = pkg == smsApp()
        handler.postDelayed({
            if (pkg !in apps.chosen()) return@postDelayed
            val country = Numbers.country(shared.context)
            val read = try {
                Notes.read(sbn, label(pkg), country)
            } catch (e: RuntimeException) {
                Log.w(TAG, "notes: ${e.javaClass.simpleName}")
                return@postDelayed
            }
            val compare = fromSmsApp && sms.running && read.any { it.second.type == chats.type }
            if (compare) sms.catchUpNow()
            for ((fp, e) in read) {
                if (compare && e.type == chats.type && smsTwin(fp, e, country)) continue
                (if (e.type == chats.type) chats else notes).take(fp, e)
            }
        }, if (fromSmsApp && sms.running) SMS_WAIT_MS else 0L)
    }

    /** The SMS app's message is an SMS already stored (or was found to be one before): remembered and passed over. */
    private fun smsTwin(fp: String, e: NewEvent, country: String): Boolean {
        if (fp in smsTwins) return true
        val keys = setOfNotNull(e.whoKey, e.who?.let { Numbers.key(it, country) })
        if (!sms.storedRecently(keys, e.who, e.body)) return false
        smsTwins.add(fp)
        if (smsTwins.size > MAX_TWINS) smsTwins.remove(smsTwins.first())
        return true
    }

    /** The phone app Android uses for calls; null when Android does not say. */
    fun dialer(): String? = runCatching { shared.context.getSystemService(TelecomManager::class.java)?.defaultDialerPackage }.getOrNull()

    /** The app Android uses for SMS; null when Android does not say. */
    private fun smsApp(): String? = runCatching { Telephony.Sms.getDefaultSmsPackage(shared.context) }.getOrNull()

    /** The listener has connected: what is on screen now is history. Read here, before the posts that follow it. */
    fun notesConnected(listener: NotesListener) {
        val all = active(listener, apps.chosen())
        val chatsShowing = all.filter { it.second.type == chats.type }.map { it.first }.toSet()
        val notesShowing = all.filter { it.second.type == notes.type }.map { it.first }.toSet()
        handler.post {
            chats.nowShowing(chatsShowing)
            notes.nowShowing(notesShowing)
            sync()
        }
    }

    /** Android has let go of the listener (access turned off, or Mini asked it to): the status follows. */
    fun notesDisconnected() {
        handler.post(::sync)
    }

    /** The fingerprints of [type] on screen now, from [packages] (ticked apps only); empty while the listener is not connected. */
    private fun showing(type: String, packages: Set<String>): Set<String> {
        val listener = NotesListener.current ?: return emptySet()
        return active(listener, packages).filter { it.second.type == type }.map { it.first }.toSet()
    }

    /** What the notifications on screen now from [packages] would give. Other apps' notifications are not read. */
    private fun active(listener: NotesListener, packages: Set<String>): List<Pair<String, NewEvent>> {
        if (packages.isEmpty()) return emptyList()
        val all = runCatching { listener.activeNotifications }.getOrNull().orEmpty()
        return all.filter { it.packageName in packages && it.packageName != shared.context.packageName }
            .flatMap { runCatching { Notes.read(it, "") }.getOrDefault(emptyList()) }
    }

    /** On the collectors' thread: apps just ticked show only history; then each source is checked again. */
    private fun appsChanged() {
        val now = apps.chosen()
        val added = now - ticked
        ticked = now
        if (added.isNotEmpty()) {
            chats.alsoShowing(showing(chats.type, added))
            notes.alsoShowing(showing(notes.type, added))
        }
        sync()
    }

    /** A ticked app that is no longer installed, or is now the phone app (it cannot be ticked), leaves the list quietly. */
    private fun dropRemovedApps() {
        val pm = shared.context.packageManager
        val phoneApp = dialer()
        for (pkg in apps.chosen()) {
            if (pkg == phoneApp) {
                apps.set(pkg, false)
                continue
            }
            val there = try {
                pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
                true
            } catch (e: PackageManager.NameNotFoundException) {
                false
            }
            if (!there) {
                apps.set(pkg, false)
                labels.remove(pkg)
            }
        }
    }

    /** The app's name as the launcher shows it; its package name when Android will not say. */
    private fun label(pkg: String): String = labels.getOrPut(pkg) {
        val pm = shared.context.packageManager
        try {
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))).toString().trim().ifEmpty { pkg }
        } catch (e: PackageManager.NameNotFoundException) {
            pkg
        }
    }

    /** Messages or Other notifications is collected: the listener should be bound. */
    fun notesWanted(): Boolean = switches.collect(MESSAGES) || switches.collect(NOTIFICATIONS)

    /**
     * The listener is enabled the first time Messages or Other notifications is collected (so Android lists it under
     * notification access, and binds it once allowed) and is never disabled again: disabling it would make Android
     * forget the owner's grant. While both switches are off, Mini asks Android to let go of it (`requestUnbind`), and
     * asks for it again (`requestRebind`) when one comes back on and access is granted.
     */
    private fun syncListener() {
        val pm = shared.context.packageManager
        val c = notesComponent()
        val want = notesWanted()
        try {
            if (want && pm.getComponentEnabledSetting(c) != PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                pm.setComponentEnabledSetting(c, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            }
            val bound = NotesListener.current
            if (!want) {
                bound?.requestUnbind()
            } else if (bound == null && notesAccess()) {
                NotificationListenerService.requestRebind(c)
            }
        } catch (e: RuntimeException) {
            Log.w(TAG, "listener: ${e.javaClass.simpleName}")
        }
    }

    fun status(scope: String): List<SourceStatus> = sources.filter { it.scope == scope }.map {
        SourceStatus(it.name, it.running, if (it.running) null else it.missing() ?: it.refused, it.permission)
    }

    /** Per collected scope that no source of it can serve: the first thing missing (permission, access, apps). */
    fun needs(): Map<String, String> = SCOPES.mapNotNull { (scope, _) ->
        if (!switches.collect(scope)) return@mapNotNull null
        val all = status(scope)
        if (all.isEmpty() || all.any { it.need == null }) return@mapNotNull null
        scope to all.mapNotNull { it.need }.minBy { it.ordinal }.wire
    }.toMap()

    /** What is being recorded now, in words for the service's notification: "calls", "messages", "notifications". */
    fun recording(): List<String> = SCOPES.filter { (scope, _) -> sources.any { it.scope == scope && it.running } }.map { it.second }

    /** Any of the three collect switches is on: the service keeps running for the record. */
    fun anyOn(): Boolean = SCOPES.any { (scope, _) -> switches.collect(scope) }

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    private fun told() = listeners.forEach { it() }

    /** On the collectors' thread: each source runs exactly while its switch is on and Android allows it. */
    private fun sync() {
        syncListener()
        for (s in sources) {
            val on = switches.collect(s.scope)
            if (!on) s.refused = null
            if (!on || s.refused != null || s.missing() != null) {
                if (s.running) s.end()
                // Not allowed now: the next time it is, it starts from that moment.
                if (prefs.get("${s.key}:on") != null) prefs.put("${s.key}:on", null)
                continue
            }
            if (!started) continue
            // Turned off and on again before this thread looked: start afresh, as for any new turn-on.
            if (s.running && prefs.get("${s.key}:on") != "1") s.end()
            if (s.running) continue
            try {
                // Allowed again after a gap (or for the first time): from now on only. Allowed all along (the app
                // was only not running): carry on from its place, so what happened meanwhile is caught up.
                if (prefs.get("${s.key}:on") != "1") {
                    s.fresh()
                    prefs.put("${s.key}:on", "1")
                }
                s.begin()
            } catch (e: SecurityException) {
                s.end()
                s.refused = Need.Permission
                prefs.put("${s.key}:on", null)
            } catch (e: RuntimeException) {
                Log.w(TAG, "${s.key}: ${e.javaClass.simpleName}")
            }
        }
        told()
    }

    companion object {
        private const val TAG = "MiniCollect"
        private const val MESSAGES = "phone.messages.read"
        private const val NOTIFICATIONS = "phone.notifications.read"
        /** How long a notification from the SMS app waits, so the SMS store has the message to compare with. */
        private const val SMS_WAIT_MS = 2_000L
        private const val MAX_TWINS = 1_000

        /** The record's scopes the collectors serve, with their words. */
        private val SCOPES = listOf(
            "phone.calls.read" to "calls",
            MESSAGES to "messages",
            NOTIFICATIONS to "notifications",
        )
    }
}

package app.minihub.phone.collect

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import app.minihub.phone.Phone

/**
 * Android's notification listener for the record (docs/08 > The record). Android binds it only while the owner has
 * given Mini notification access in Settings. The app enables it the first time Messages or Other notifications is
 * collected and never disables it (that would make Android forget the grant); while both are off it asks Android to
 * let go of it. It reads nothing itself: every posted notification goes to the collectors, which decide.
 */
class NotesListener : NotificationListenerService() {
    override fun onListenerConnected() {
        val collectors = Phone.get(this).collectors
        // Android binds it again after a restart, whatever was asked before: let go at once while nothing needs it.
        if (!collectors.notesWanted()) {
            runCatching { requestUnbind() }
            return
        }
        current = this
        collectors.notesConnected(this)
    }

    override fun onListenerDisconnected() {
        if (current === this) current = null
        Phone.get(this).collectors.notesDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        Phone.get(this).collectors.onNote(sbn ?: return)
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    companion object {
        /** The listener while Android has it connected; null otherwise. */
        @Volatile var current: NotesListener? = null
            private set
    }
}

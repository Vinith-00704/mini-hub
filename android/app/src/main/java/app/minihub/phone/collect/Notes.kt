package app.minihub.phone.collect

import android.app.Notification
import android.app.Person
import android.net.Uri
import android.os.Bundle
import android.os.Parcelable
import android.service.notification.StatusBarNotification
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import org.json.JSONObject

/**
 * What one posted notification becomes in the record (docs/08 > The record): chats (one per message, under Messages)
 * or one notification (under Other notifications), each with its fingerprint. Ongoing notifications, foreground
 * services, group summaries, empty notifications and the owner's own messages give nothing. Which apps are read at
 * all, and the app's own notifications, are decided by the caller.
 */
object Notes {
    private val MESSAGING = Notification.MessagingStyle::class.java.name

    /** Fingerprint to event, for a notification of the app called [label]; [country] keys `tel:` people as calls and SMS do. */
    fun read(sbn: StatusBarNotification, label: String, country: String = ""): List<Pair<String, NewEvent>> {
        val n = sbn.notification ?: return emptyList()
        if (sbn.isOngoing) return emptyList()
        if (n.flags and (Notification.FLAG_FOREGROUND_SERVICE or Notification.FLAG_GROUP_SUMMARY) != 0) return emptyList()
        val x = n.extras ?: Bundle.EMPTY
        val title = x.text(Notification.EXTRA_TITLE)
        val text = x.text(Notification.EXTRA_BIG_TEXT) ?: x.text(Notification.EXTRA_TEXT)
        val styled = x.getString(Notification.EXTRA_TEMPLATE) == MESSAGING
        val messages = if (styled) messages(x) else emptyList()
        if (title == null && text == null && messages.isEmpty()) return emptyList()
        val pkg = sbn.packageName
        // A chat is never stored as a notification: a messaging notification gives its messages or nothing.
        if (styled) return chats(sbn, n, x, pkg, label, country, messages)
        if (n.category == Notification.CATEGORY_MESSAGE) {
            // Without the messaging style: one message, from the title. No sender is the owner's own (or nobody's).
            val sender = title ?: return emptyList()
            val body = text ?: return emptyList()
            val one = Msg(body, if (n.`when` > 0) n.`when` else sbn.postTime, sender, people(x).singleOrNull())
            return chats(sbn, n, x, pkg, label, country, listOf(one), occurredAt = sbn.postTime)
        }
        val data = JSONObject()
            .apply { n.category?.let { put("category", it.take(60)) } }
            .put("ongoing", false)
            .put("package", pkg)
            .put("notificationKey", sbn.key.take(300))
        return listOf(
            Record.fingerprint("note", pkg, sbn.key, title, text) to NewEvent(
                type = "notification",
                occurredAt = sbn.postTime,
                app = label,
                title = title,
                body = text,
                data = data.toString(),
            ),
        )
    }

    /** One message: its text, its own time, who sent it, and their Person when the app gave one. */
    private class Msg(val text: String, val time: Long, val sender: String, val person: Person?)

    /** The notification's current messages (not the historic ones), without the owner's own. */
    private fun messages(x: Bundle): List<Msg> {
        val all = x.getParcelableArray(Notification.EXTRA_MESSAGES, Parcelable::class.java) ?: return emptyList()
        val me = x.getParcelable(Notification.EXTRA_MESSAGING_PERSON, Person::class.java)
        return all.mapNotNull { p ->
            val b = p as? Bundle ?: return@mapNotNull null
            val text = b.getCharSequence("text")?.toString()?.trim()?.ifEmpty { null } ?: return@mapNotNull null
            val person = b.getParcelable("sender_person", Person::class.java)
            // No sender means the owner wrote it; so does a sender who is the conversation's own user.
            if (person != null && isMe(person, me)) return@mapNotNull null
            val sender = (person?.name ?: b.getCharSequence("sender"))?.toString()?.trim()?.ifEmpty { null } ?: return@mapNotNull null
            Msg(text, b.getLong("time"), sender, person)
        }
    }

    /**
     * The sender is the conversation's own user: the same key, or, when neither has a key (an app that names the
     * owner "You" with no key), the same name and the same link when both have one.
     */
    private fun isMe(person: Person, me: Person?): Boolean {
        if (me == null) return false
        if (person.key != null) return person.key == me.key
        if (me.key != null) return false
        val name = person.name?.toString()?.trim()?.ifEmpty { null } ?: return false
        if (name != me.name?.toString()?.trim()) return false
        return person.uri == null || me.uri == null || person.uri == me.uri
    }

    private fun chats(
        sbn: StatusBarNotification,
        n: Notification,
        x: Bundle,
        pkg: String,
        label: String,
        country: String,
        messages: List<Msg>,
        occurredAt: Long? = null,
    ): List<Pair<String, NewEvent>> {
        val conversation = x.text(Notification.EXTRA_CONVERSATION_TITLE)
        val group = x.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false)
        val canReply = n.actions.orEmpty().any { a -> a.remoteInputs.orEmpty().any { it.allowFreeFormInput } }
        val data = JSONObject()
            .apply { conversation?.let { put("conversation", it.take(200)) } }
            .put("canReply", canReply)
            .put("notificationKey", sbn.key.take(300))
            .put("package", pkg)
            .put("group", group)
            .toString()
        return messages.map { m ->
            val time = if (m.time > 0) m.time else sbn.postTime
            Record.fingerprint("chat", pkg, conversation, m.sender, time.toString(), m.text) to NewEvent(
                type = "chat",
                occurredAt = occurredAt ?: time,
                who = m.sender,
                whoKey = phoneKey(m.person, country) ?: "$pkg:${m.sender.lowercase()}",
                app = label,
                title = conversation ?: m.sender,
                body = m.text,
                data = data,
            )
        }
    }

    /** The people a notification names, when it names them (messaging apps often do). */
    private fun people(x: Bundle): List<Person> =
        x.getParcelableArrayList(Notification.EXTRA_PEOPLE_LIST, Person::class.java).orEmpty()

    /** The person's number as calls and SMS key it, when the app gave a `tel:` link for them. */
    private fun phoneKey(person: Person?, country: String): String? {
        val uri = person?.uri ?: return null
        if (!uri.startsWith("tel:", ignoreCase = true)) return null
        val number = runCatching { Uri.parse(uri).schemeSpecificPart }.getOrNull() ?: return null
        return Numbers.key(number, country)
    }

    private fun Bundle.text(key: String): String? = getCharSequence(key)?.toString()?.trim()?.ifEmpty { null }
}

/**
 * One of the notification listener's two kinds as a source of the record: "chat" (under Messages) or "notification"
 * (under Other notifications). It runs only while its switch is on, notification access is granted and at least one
 * app is ticked. Nothing already on screen when it becomes allowed (or when an app is ticked) is read: what is
 * showing then is remembered and passed over, even when the app posts it again.
 */
class NotesSource(
    name: String,
    key: String,
    scope: String,
    val type: String,
    private val shared: Shared,
    private val apps: Apps,
    private val access: () -> Boolean,
    private val showing: (type: String, packages: Set<String>) -> Set<String>,
) : Source(name, key, scope, null) {
    // The fingerprints on screen when this source became allowed; used on the collectors' thread only.
    private var onScreen: Set<String> = emptySet()

    override fun missing(): Need? = when {
        !access() -> Need.NotificationAccess
        apps.chosen().isEmpty() -> Need.Apps
        else -> null
    }

    override fun fresh() {
        onScreen = showing(type, apps.chosen())
    }

    /** The listener has just connected: what it finds on screen now was there before it could be read. */
    fun nowShowing(fps: Set<String>) {
        onScreen = fps
    }

    /** Apps have just been ticked: what they show now is history. */
    fun alsoShowing(fps: Set<String>) {
        if (fps.isNotEmpty()) onScreen = onScreen + fps
    }

    override fun begin() {
        running = true
    }

    override fun end() {
        running = false
    }

    /** Records one message or notification, once (by its fingerprint), while running. */
    fun take(fp: String, e: NewEvent) {
        if (!running || e.type != type || fp in onScreen) return
        shared.record.addOnce(fp, e)
    }
}

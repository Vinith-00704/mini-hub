package app.minihub.phone.collect

import android.Manifest
import android.database.Cursor
import android.provider.Telephony
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import org.json.JSONObject

/**
 * SMS, from Android's SMS store (docs/08 > The record): received and sent alike, read as they are written. Drafts
 * and failed messages are passed over; a message still waiting to go out (outbox, queued) is read again once sent.
 * MMS are not recorded. Needs `READ_SMS`; names come from contacts only if the owner allowed `READ_CONTACTS`.
 */
class SmsCollector(shared: Shared) : ProviderSource(
    "SMS", "sms", "phone.messages.read", Manifest.permission.READ_SMS, shared, Telephony.Sms.CONTENT_URI,
) {
    private var country = ""
    /** Received SMS stored in the last [TWIN_MS], so the SMS app's notification of the same message is not stored again. */
    private val recent = ArrayDeque<Received>()

    private class Received(val at: Long, val key: String?, val name: String?, val text: String)

    override val columns = COLUMNS

    // The SMS store has no limit parameter; the caller reads at most `limit` rows from the cursor.
    override fun query(columns: Array<String>, selection: String?, args: Array<String>?, sort: String, limit: Int): Cursor? {
        country = Numbers.country(context)
        return context.contentResolver.query(Telephony.Sms.CONTENT_URI, columns, selection, args, sort)
    }

    override fun take(c: Cursor): Boolean {
        val id = c.getLong(0)
        val address = c.getString(1).orEmpty().trim()
        val body = c.getString(2)
        val date = c.getLong(3)
        val direction = when (c.getInt(4)) {
            Telephony.Sms.MESSAGE_TYPE_INBOX -> "in"
            Telephony.Sms.MESSAGE_TYPE_SENT -> "out"
            // Still going out: hold the place below it so it is seen again once sent. Not for ever: past HOLD_MS
            // it is passed over, before the fingerprints of the rows after it are forgotten (7 days).
            Telephony.Sms.MESSAGE_TYPE_OUTBOX, Telephony.Sms.MESSAGE_TYPE_QUEUED -> return System.currentTimeMillis() - date > HOLD_MS
            else -> return true // drafts and failed messages
        }
        val who = Numbers.name(context, address) ?: address.ifEmpty { null }
        val seq = record.addOnce(
            Record.fingerprint("sms", id.toString(), date.toString()),
            NewEvent(
                type = "sms",
                occurredAt = date,
                who = who,
                whoKey = Numbers.key(address, country),
                app = "SMS",
                title = who,
                body = body,
                data = JSONObject().put("direction", direction).put("thread", c.getLong(5).toString()).toString(),
            ),
        )
        if (seq != null && direction == "in" && body != null) {
            val now = System.currentTimeMillis()
            forgetOld(now)
            recent.addLast(Received(now, Numbers.key(address, country), who, body.trim()))
        }
        return true
    }

    /**
     * Whether an SMS from this sender with this text was stored in the last 2 minutes (on the collectors' thread).
     * The sender matches by number, normalised as the record keys it ([keys]: the chat's key and its sender read as a
     * number), or by the contact's name.
     */
    fun storedRecently(keys: Set<String>, name: String?, text: String?): Boolean {
        val t = text?.trim() ?: return false
        forgetOld(System.currentTimeMillis())
        return recent.any { r ->
            r.text == t && ((r.key != null && r.key in keys) || (name != null && r.name != null && r.name.equals(name, ignoreCase = true)))
        }
    }

    private fun forgetOld(now: Long) {
        while (recent.isNotEmpty() && (now - recent.first().at > TWIN_MS || recent.size > MAX_RECENT)) recent.removeFirst()
    }

    companion object {
        private const val HOLD_MS = 6 * 86_400_000L
        private const val TWIN_MS = 2 * 60_000L
        private const val MAX_RECENT = 500

        private val COLUMNS = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.TYPE,
            Telephony.Sms.THREAD_ID,
        )
    }
}

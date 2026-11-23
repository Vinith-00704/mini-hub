package app.minihub.phone.collect

import android.Manifest
import android.database.Cursor
import android.provider.CallLog
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import kotlin.math.roundToLong
import org.json.JSONObject

/**
 * Calls, from Android's call log (docs/08 > The record): read when the log changes (a call has ended), and at the
 * next start for calls made while the app was not running. Needs `READ_CALL_LOG`, asked for by the owner's button.
 */
class CallLogCollector(shared: Shared) : ProviderSource(
    "Call log", "calls", "phone.calls.read", Manifest.permission.READ_CALL_LOG, shared, CallLog.Calls.CONTENT_URI,
) {
    private var country = ""

    override val columns = COLUMNS

    override fun query(columns: Array<String>, selection: String?, args: Array<String>?, sort: String, limit: Int): Cursor? {
        country = Numbers.country(context)
        return context.contentResolver.query(limited(limit), columns, selection, args, sort)
    }

    override fun take(c: Cursor): Boolean {
        val id = c.getLong(0)
        val number = c.getString(1).orEmpty().trim()
        val presentation = c.getInt(2)
        val cached = c.getString(3)?.takeIf { it.isNotBlank() }
        val date = c.getLong(5)
        val seconds = c.getLong(6).coerceAtLeast(0)
        val direction = when (c.getInt(4)) {
            CallLog.Calls.INCOMING_TYPE, CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "in"
            CallLog.Calls.OUTGOING_TYPE -> "out"
            CallLog.Calls.MISSED_TYPE, CallLog.Calls.VOICEMAIL_TYPE -> "missed"
            CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "rejected"
            else -> return true // a kind of entry the record does not know: passed over
        }
        val shown = presentation == CallLog.Calls.PRESENTATION_ALLOWED && number.isNotEmpty()
        // The call log's own name only: contacts are allowed for SMS names, not read for calls.
        val who = if (!shown) PRIVATE else cached ?: number
        val title = when (direction) {
            "missed" -> "Missed call"
            "rejected" -> "Declined call"
            "in" -> "Incoming, ${length(seconds)}"
            else -> "Outgoing, ${length(seconds)}"
        }
        record.addOnce(
            Record.fingerprint("call", id.toString(), date.toString()),
            NewEvent(
                type = "call",
                occurredAt = date,
                who = who,
                whoKey = if (shown) Numbers.key(number, country) else null,
                app = "Phone",
                title = title,
                data = JSONObject().put("direction", direction).put("seconds", seconds).toString(),
            ),
        )
        return true
    }

    private fun limited(n: Int) = CallLog.Calls.CONTENT_URI.buildUpon().appendQueryParameter(CallLog.Calls.LIMIT_PARAM_KEY, n.toString()).build()

    companion object {
        private const val PRIVATE = "Private number"

        private val COLUMNS = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.NUMBER_PRESENTATION,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
        )

        /** "30 s" under a minute, else whole minutes rounded, at least 1: "4 min". */
        fun length(seconds: Long): String =
            if (seconds < 60) "$seconds s" else "${(seconds / 60.0).roundToLong().coerceAtLeast(1)} min"
    }
}

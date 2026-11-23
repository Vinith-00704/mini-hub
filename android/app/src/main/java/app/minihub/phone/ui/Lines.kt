package app.minihub.phone.ui

import app.minihub.phone.data.NewEvent
import app.minihub.phone.link.LinkStatus

/** The plain words the phone's screens use, kept apart from the views so they can be tested. */
object Lines {
    private fun ago(at: Long, now: Long): String {
        val s = (now - at).coerceAtLeast(0) / 1000
        return when {
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86_400 -> "${s / 3600} h ago"
            else -> "${s / 86_400} d ago"
        }
    }

    /** The hub's state for Home and the Hub screen (docs/08 > The app's own screens). */
    fun hub(status: LinkStatus, lastSync: Long, waiting: Long, now: Long): String = when (status) {
        LinkStatus.NotPaired -> "Not paired"
        LinkStatus.Connecting -> "Linking to your PC…"
        LinkStatus.Linked -> if (waiting > 0) "Syncing: $waiting waiting" else "Synced ${ago(lastSync, now)}"
        LinkStatus.NotAtHome -> if (waiting > 0) "Not at home: $waiting waiting" else "Not at home"
        is LinkStatus.Refused -> status.reason
    }

    /** Today's counts, in a fixed order. Phone-state changes are not counted: they are not news to the owner. */
    fun today(counts: Map<String, Int>): List<Pair<String, Int>> = listOf(
        "Calls" to (counts["call"] ?: 0),
        "Messages" to ((counts["sms"] ?: 0) + (counts["chat"] ?: 0)),
        "Notifications" to (counts["notification"] ?: 0),
        "Mini" to (counts["mini_action"] ?: 0),
    )

    private val CODE_WORD = Regex("""\b(otp|code|pin|passcode|verification)\b""", RegexOption.IGNORE_CASE)
    private val DIGITS = Regex("""\b\d{4,8}\b""")

    /** One-time codes are hidden in lists: when the text speaks of a code, every 4 to 8 digit number shows as dots. The full text shows when the row is tapped. */
    fun mask(text: String): String = if (CODE_WORD.containsMatchIn(text)) DIGITS.replace(text, "••••••") else text

    private val KIND =mapOf("call" to "Call", "sms" to "Message", "chat" to "Message", "notification" to "Notification", "device_state" to "Phone state", "app_usage" to "App use", "mini_action" to "Mini")

    /** A record line's heading: a call is "Call · who", a notification "Notification · <app>". */
    fun recordHead(e: NewEvent): String = when (e.type) {
        "call" -> recordTitle(e.type, e.who, null)
        "notification" -> recordTitle(e.type, e.app, null)
        else -> recordTitle(e.type, e.who, e.title)
    }

    /** A record line's second line, before masking: a call's title ("Missed call"), a notification's "title: text", else the text. */
    fun recordDetail(e: NewEvent): String? {
        val text = when (e.type) {
            "call" -> e.title
            "notification" -> listOfNotNull(e.title, e.body).filter { it.isNotBlank() }.joinToString(": ")
            else -> e.body ?: e.data?.replace(Regex("[{}\"]"), "")?.replace(",", ", ")?.replace(":", ": ")
        }
        return text?.takeIf { it.isNotBlank() }
    }

    fun recordTitle(type: String, who: String?, title: String?): String {
        val kind = KIND[type] ?: type
        return when {
            who != null -> "$kind · $who"
            title != null && type == "device_state" -> title
            title != null -> "$kind · $title"
            else -> kind
        }
    }
}

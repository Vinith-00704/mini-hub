package app.minihub.phone.ui

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

    private val KIND = mapOf("call" to "Call", "sms" to "Message", "chat" to "Message", "notification" to "Notification", "device_state" to "Phone state", "app_usage" to "App use", "mini_action" to "Mini")

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

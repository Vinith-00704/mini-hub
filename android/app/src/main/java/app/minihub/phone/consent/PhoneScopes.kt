package app.minihub.phone.consent

/**
 * The phone's scopes, the same ids, words and kinds as the hub's (protocol/src/scopes.ts), plus the phone's own
 * ([phoneOnly]: not in the hub's list, so not sent to it, and with no "From my PC" switch).
 */
data class PhoneScope(
    val id: String,
    val label: String,
    val kind: String,
    val collectable: Boolean,
    val phoneOnly: Boolean = false,
    /** The scope whose Collect switch this one's data depends on, when it has none of its own. */
    val collectedBy: String? = null,
)

object PhoneScopes {
    /** Mini's `phone_status` on this phone: its own "Mini on this phone" switch, and Collect for Battery and app use. */
    const val STATUS = "phone.status.read"

    val ALL = listOf(
        PhoneScope("phone.calls.read", "Call history", "read", true),
        PhoneScope("phone.messages.read", "Messages (SMS and chat apps)", "read", true),
        PhoneScope("phone.notifications.read", "Other notifications", "read", true),
        PhoneScope("phone.usage.read", "Battery and app use", "read", true),
        PhoneScope(STATUS, "Phone status", "read", false, phoneOnly = true, collectedBy = "phone.usage.read"),
        PhoneScope("phone.location.read", "Location", "read", true),
        PhoneScope("phone.screen.read", "Reading the screen", "read", false),
        PhoneScope("phone.control", "Controlling the phone", "act", false),
        PhoneScope("phone.reply", "Sending replies, SMS and calls", "important", false),
    )

    /** Mini's own actions are always recorded: the owner must be able to see what Mini did. */
    const val OWN = "own"

    fun find(id: String): PhoneScope? = ALL.firstOrNull { it.id == id }

    /** The Collect switch that decides whether this scope's data is recorded: its own, another's, or none (null). */
    fun collectScope(id: String): String? = find(id)?.let { it.collectedBy ?: if (it.collectable) it.id else null }

    /** The scope that decides whether an event of this type is recorded; null for a type the phone does not know. */
    fun forEvent(type: String): String? = when (type) {
        "call" -> "phone.calls.read"
        "sms", "chat" -> "phone.messages.read"
        "notification" -> "phone.notifications.read"
        "device_state", "app_usage" -> "phone.usage.read"
        "mini_action" -> OWN
        else -> null
    }
}

enum class Grant {
    Off, Ask, On;

    val wire: String get() = name.lowercase()

    companion object {
        fun parse(s: String?): Grant = entries.firstOrNull { it.wire == s } ?: Off
    }
}

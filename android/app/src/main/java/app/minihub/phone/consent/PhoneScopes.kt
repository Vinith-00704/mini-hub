package app.minihub.phone.consent

/** The phone's scopes, the same ids, words and kinds as the hub's (protocol/src/scopes.ts). */
data class PhoneScope(val id: String, val label: String, val kind: String, val collectable: Boolean)

object PhoneScopes {
    val ALL = listOf(
        PhoneScope("phone.calls.read", "Call history", "read", true),
        PhoneScope("phone.messages.read", "Messages (SMS and chat apps)", "read", true),
        PhoneScope("phone.notifications.read", "Other notifications", "read", true),
        PhoneScope("phone.usage.read", "Battery and app use", "read", true),
        PhoneScope("phone.location.read", "Location", "read", true),
        PhoneScope("phone.screen.read", "Reading the screen", "read", false),
        PhoneScope("phone.control", "Controlling the phone", "act", false),
        PhoneScope("phone.reply", "Sending replies, SMS and calls", "important", false),
    )

    /** Mini's own actions are always recorded: the owner must be able to see what Mini did. */
    const val OWN = "own"

    fun find(id: String): PhoneScope? = ALL.firstOrNull { it.id == id }

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

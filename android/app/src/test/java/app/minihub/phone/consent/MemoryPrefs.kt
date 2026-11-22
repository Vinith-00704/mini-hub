package app.minihub.phone.consent

/** Preferences in memory, for tests. */
class MemoryPrefs : Prefs {
    private val map = HashMap<String, String>()
    override fun get(key: String): String? = map[key]
    override fun put(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}

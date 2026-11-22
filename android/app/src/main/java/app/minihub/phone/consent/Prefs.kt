package app.minihub.phone.consent

import android.content.Context

/** A small key-value store. The switches are not secret; they live in the app's private preferences. */
interface Prefs {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

class SharedPrefs(context: Context, name: String) : Prefs {
    private val p = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun get(key: String): String? = p.getString(key, null)
    override fun put(key: String, value: String?) {
        p.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}

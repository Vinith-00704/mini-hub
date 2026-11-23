package app.minihub.phone.collect

import app.minihub.phone.consent.Prefs
import java.util.concurrent.CopyOnWriteArrayList

/**
 * "Apps to include" (docs/08 > The record): the one list of apps whose notifications Mini reads at all. Nothing is
 * ticked at first. A ticked app's messaging notifications become chats (under Messages), the rest notifications.
 */
class Apps(private val prefs: Prefs) {
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    // Read for every notification posted on the phone, so it is kept in memory.
    @Volatile private var picked: Set<String> = prefs.get(KEY)?.split(',')?.filter { it.isNotBlank() }?.toSet().orEmpty()

    /** The packages ticked, by package name. */
    fun chosen(): Set<String> = picked

    fun set(pkg: String, on: Boolean) {
        synchronized(this) {
            val next = if (on) picked + pkg else picked - pkg
            if (next == picked) return
            picked = next
            prefs.put(KEY, next.sorted().joinToString(",").ifEmpty { null })
        }
        listeners.forEach { it() }
    }

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    companion object {
        private const val KEY = "apps:chosen"
    }
}

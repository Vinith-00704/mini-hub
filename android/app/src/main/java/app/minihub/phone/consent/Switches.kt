package app.minihub.phone.consent

import java.util.concurrent.CopyOnWriteArrayList

/**
 * The phone's own switches (docs/03 > The three lists, docs/04 > Whose switches win): per scope, Collect (on/off),
 * Mini on this phone (off/ask/on) and From my PC (off/ask/on). Everything starts off. The phone's switches are the
 * limit: the hub may change what is collected only while "only change these on the phone" is off.
 */
class Switches(private val prefs: Prefs) {
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    fun collect(scope: String): Boolean = prefs.get("collect:$scope") == "1"
    fun mini(scope: String): Grant = Grant.parse(prefs.get("mini:$scope"))
    fun pc(scope: String): Grant = Grant.parse(prefs.get("pc:$scope"))

    var lockedOnPhone: Boolean
        get() = prefs.get("locked") == "1"
        set(value) {
            prefs.put("locked", if (value) "1" else null)
            told()
        }

    /** The rev of the last collect change from the hub that was taken. */
    val hubRev: Int get() = prefs.get("hubRev")?.toIntOrNull() ?: 0

    fun setCollect(scope: String, on: Boolean) {
        if (PhoneScopes.find(scope)?.collectable != true) return
        prefs.put("collect:$scope", if (on) "1" else null)
        told()
    }

    fun setMini(scope: String, g: Grant) {
        if (PhoneScopes.find(scope) == null) return
        prefs.put("mini:$scope", g.wire)
        told()
    }

    fun setPc(scope: String, g: Grant) {
        if (PhoneScopes.find(scope) == null) return
        prefs.put("pc:$scope", g.wire)
        told()
    }

    /** A collect change from the hub. Taken only when the phone is not locked and the change is newer. */
    fun applyFromHub(collect: Map<String, Boolean>, rev: Int): Boolean {
        if (lockedOnPhone || rev <= hubRev) return false
        for ((scope, on) in collect) if (PhoneScopes.find(scope)?.collectable == true) prefs.put("collect:$scope", if (on) "1" else null)
        prefs.put("hubRev", rev.toString())
        told()
        return true
    }

    /** Forgetting the hub starts its numbering again. */
    fun forgetHub() = prefs.put("hubRev", null)

    /** The phone's two lists, as sent to the hub in the state frame. */
    fun lists(): Pair<Map<String, String>, Map<String, String>> =
        PhoneScopes.ALL.associate { it.id to mini(it.id).wire } to PhoneScopes.ALL.associate { it.id to pc(it.id).wire }

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    private fun told() = listeners.forEach { it() }
}

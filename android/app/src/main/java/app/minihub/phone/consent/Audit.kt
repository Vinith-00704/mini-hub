package app.minihub.phone.consent

/** One line of what happened on the phone: who asked ("Your PC", "Mini", "You"), what, and how it ended. */
data class AuditRow(val at: Long, val who: String, val action: String, val scope: String? = null, val outcome: String, val detail: String? = null)

interface AuditStore {
    fun addAudit(row: AuditRow)
    fun recentAudit(limit: Int): List<AuditRow>
}

/** The phone's own log (docs/04 > Commands: origin, approved and approvalId go into the phone's own log). Never content. */
class Audit(private val store: AuditStore, private val now: () -> Long = System::currentTimeMillis) {
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    fun add(who: String, action: String, scope: String? = null, outcome: String, detail: String? = null) {
        store.addAudit(AuditRow(now(), who, action, scope, outcome, detail))
        listeners.forEach { it() }
    }

    fun recent(limit: Int = 200): List<AuditRow> = store.recentAudit(limit)

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }
}

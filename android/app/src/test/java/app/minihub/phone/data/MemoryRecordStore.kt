package app.minihub.phone.data

/** The record in a list, for tests; the real one is the encrypted database on the phone. */
class MemoryRecordStore : RecordStore {
    private val rows = ArrayList<StoredEvent>()
    private var next = 1L

    fun all(): List<StoredEvent> = rows.toList()

    override fun insert(e: NewEvent): Long = (next++).also { rows.add(StoredEvent(it, e)) }
    private val seen = HashMap<String, Long>()

    override fun after(seq: Long, limit: Int, types: Set<String>) = rows.filter { it.seq > seq && it.event.type in types }.take(limit)
    override fun insertOnce(fp: String, at: Long, e: NewEvent): Long? {
        if (seen.containsKey(fp)) return null
        seen[fp] = at
        return insert(e)
    }
    override fun prune(ackedUpTo: Long, before: Long): Int {
        seen.values.removeAll { it < before }
        val old = rows.filter { it.seq <= ackedUpTo && it.event.occurredAt < before }
        rows.removeAll(old.toSet())
        return old.size
    }
    override fun latestSeq() = next - 1
    override fun search(q: String, limit: Int) =
        rows.filter { listOfNotNull(it.event.who, it.event.title, it.event.body).any { s -> s.contains(q, ignoreCase = true) } }.reversed().take(limit)
    override fun query(types: Set<String>, from: Long, to: Long, who: String?, text: String?, limit: Int) =
        rows.filter { r ->
            val e = r.event
            e.type in types && e.occurredAt in from..to &&
                (who.isNullOrBlank() || e.who?.contains(who.trim(), ignoreCase = true) == true) &&
                (text.isNullOrBlank() || listOfNotNull(e.title, e.body).any { it.contains(text.trim(), ignoreCase = true) })
        }.sortedWith(compareByDescending<StoredEvent> { it.event.occurredAt }.thenByDescending { it.seq }).take(limit)
    override fun delete(seqs: List<Long>): Int {
        val before = rows.size
        rows.removeAll { it.seq in seqs }
        return before - rows.size
    }
    override fun countsSince(time: Long) = rows.filter { it.event.occurredAt >= time }.groupingBy { it.event.type }.eachCount()
}

package app.minihub.phone.data

/** The record in a list, for tests; the real one is the encrypted database on the phone. */
class MemoryRecordStore : RecordStore {
    private val rows = ArrayList<StoredEvent>()
    private var next = 1L

    fun all(): List<StoredEvent> = rows.toList()

    override fun insert(e: NewEvent): Long = (next++).also { rows.add(StoredEvent(it, e)) }
    override fun after(seq: Long, limit: Int) = rows.filter { it.seq > seq }.take(limit)
    override fun latestSeq() = next - 1
    override fun search(q: String, limit: Int) =
        rows.filter { listOfNotNull(it.event.who, it.event.title, it.event.body).any { s -> s.contains(q, ignoreCase = true) } }.reversed().take(limit)
    override fun delete(seqs: List<Long>): Int {
        val before = rows.size
        rows.removeAll { it.seq in seqs }
        return before - rows.size
    }
    override fun countsSince(time: Long) = rows.filter { it.event.occurredAt >= time }.groupingBy { it.event.type }.eachCount()
}

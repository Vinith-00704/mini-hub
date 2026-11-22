package app.minihub.phone.data

import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.consent.Switches
import java.util.concurrent.CopyOnWriteArrayList

/** Something that happened on the phone, as the link protocol carries it. `data` is JSON text. */
data class NewEvent(
    val type: String,
    val occurredAt: Long,
    val who: String? = null,
    val whoKey: String? = null,
    val app: String? = null,
    val title: String? = null,
    val body: String? = null,
    val data: String? = null,
)

data class StoredEvent(val seq: Long, val event: NewEvent)

/** Where the record is kept: the encrypted database on the phone (RecordDb), a plain list in tests. */
interface RecordStore {
    fun insert(e: NewEvent): Long
    fun after(seq: Long, limit: Int): List<StoredEvent>
    fun latestSeq(): Long
    fun search(q: String, limit: Int): List<StoredEvent>
    fun delete(seqs: List<Long>): Int
    fun countsSince(time: Long): Map<String, Int>
}

/**
 * The phone's record (docs/08 > The record). `add` is the only way in, and it checks the collect switch first:
 * with a switch off, nothing of that kind is stored, so nothing of it can be sent.
 */
class Record(private val store: RecordStore, private val switches: Switches) {
    private val listeners = CopyOnWriteArrayList<(Long) -> Unit>()

    /** The new event's number, or null when collecting it is off (or the phone does not know the kind). */
    fun add(e: NewEvent): Long? {
        val scope = PhoneScopes.forEvent(e.type) ?: return null
        if (scope != PhoneScopes.OWN && !switches.collect(scope)) return null
        val seq = synchronized(this) { store.insert(e) }
        listeners.forEach { it(seq) }
        return seq
    }

    fun after(seq: Long, limit: Int): List<StoredEvent> = store.after(seq, limit)
    fun latestSeq(): Long = store.latestSeq()
    fun search(q: String, limit: Int = 200): List<StoredEvent> = store.search(q, limit)
    fun delete(seqs: List<Long>): Int = store.delete(seqs)
    fun countsSince(time: Long): Map<String, Int> = store.countsSince(time)

    fun onAdd(fn: (Long) -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }
}

package app.minihub.phone.data

import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.consent.Switches
import java.security.MessageDigest
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
    /** Only rows whose type is in `types`: the filter is in the query, so filtered-out rows cannot hide the rest. */
    fun after(seq: Long, limit: Int, types: Set<String>): List<StoredEvent>

    /** Stores the event and remembers `fp` (seen at `at`) in one step; null, and nothing stored, when `fp` is already known. */
    fun insertOnce(fp: String, at: Long, e: NewEvent): Long?

    /** Deletes events numbered up to `ackedUpTo` that happened before `before`, and fingerprints seen before `before`. Returns the events deleted. */
    fun prune(ackedUpTo: Long, before: Long): Int
    fun latestSeq(): Long
    fun search(q: String, limit: Int): List<StoredEvent>

    /** Newest first; types IN (…), occurred_at in [from, to], who LIKE, title or body LIKE; filtered in SQL. */
    fun query(types: Set<String>, from: Long, to: Long, who: String?, text: String?, limit: Int): List<StoredEvent>
    fun delete(seqs: List<Long>): Int
    fun countsSince(time: Long): Map<String, Int>
}

/**
 * The phone's record (docs/08 > The record). `add` is the only way in, and it checks the collect switch first:
 * with a switch off, nothing of that kind is stored, so nothing of it can be sent.
 */
class Record(
    private val store: RecordStore,
    private val switches: Switches,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val listeners = CopyOnWriteArrayList<(Long) -> Unit>()

    /** The new event's number, or null when collecting it is off (or the phone does not know the kind). Too-long text is cut to the protocol's limits. */
    fun add(e: NewEvent): Long? {
        if (!collecting(e.type)) return null
        val seq = synchronized(this) { store.insert(trimmed(e)) }
        return told(seq)
    }

    /**
     * Like [add], but an event whose fingerprint was seen in the last 7 days is folded: not stored again, null back.
     * The switch is checked first: with it off nothing is written, not even the fingerprint.
     */
    fun addOnce(fp: String, e: NewEvent): Long? {
        if (!collecting(e.type)) return null
        val seq = synchronized(this) { store.insertOnce(fp, clock(), trimmed(e)) } ?: return null
        return told(seq)
    }

    private fun told(seq: Long): Long {
        listeners.forEach { it(seq) }
        return seq
    }

    /** Whether events of this kind are recorded (and handed over) now: Mini's own actions always, the rest while their switch is on. */
    private fun collecting(type: String): Boolean {
        val scope = PhoneScopes.forEvent(type) ?: return false
        return scope == PhoneScopes.OWN || switches.collect(scope)
    }

    /** Only kinds collected now: events stored while a switch was on are not sent after it goes off (they stay, and are reported as a gap). */
    fun after(seq: Long, limit: Int): List<StoredEvent> = store.after(seq, limit, KINDS.filter(::collecting).toSet())

    /** The 7-day cleanup: what the hub has (up to `ackedUpTo`) and is older than a week goes, and so do old fingerprints. */
    fun prune(ackedUpTo: Long, now: Long): Int = store.prune(ackedUpTo, now - KEEP_MS)
    fun latestSeq(): Long = store.latestSeq()
    fun search(q: String, limit: Int = 200): List<StoredEvent> = store.search(q, limit)

    /** What Mini reads (hands/PhoneTools): only kinds collected now, newest first, `who` and `text` matched anywhere in them. */
    fun query(types: Set<String>, from: Long, to: Long, who: String?, text: String?, limit: Int): List<StoredEvent> {
        val kinds = types.filter(::collecting).toSet()
        if (kinds.isEmpty() || limit <= 0) return emptyList()
        return store.query(kinds, from, to, who?.takeIf { it.isNotBlank() }, text?.takeIf { it.isNotBlank() }, limit)
    }
    fun delete(seqs: List<Long>): Int = store.delete(seqs)
    fun countsSince(time: Long): Map<String, Int> = store.countsSince(time)

    fun onAdd(fn: (Long) -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    companion object {
        const val KEEP_MS = 7 * 86_400_000L

        /** The kinds the phone records. */
        private val KINDS = listOf("call", "sms", "chat", "notification", "device_state", "app_usage", "mini_action")

        /** Hex of SHA-256 over the parts joined by \u0001 (a missing part counts as empty), the first 32 characters. */
        fun fingerprint(vararg parts: String?): String {
            val sum = MessageDigest.getInstance("SHA-256").digest(parts.joinToString("\u0001") { it ?: "" }.toByteArray(Charsets.UTF_8))
            return sum.joinToString("") { "%02x".format(it) }.take(32)
        }

        /** At most `max` UTF-16 units, never ending on half of a surrogate pair. */
        private fun cut(s: String?, max: Int): String? {
            if (s == null || s.length <= max) return s
            return s.substring(0, if (Character.isHighSurrogate(s[max - 1])) max - 1 else max)
        }

        private fun trimmed(e: NewEvent) = e.copy(
            who = cut(e.who, 200),
            whoKey = cut(e.whoKey, 200),
            app = cut(e.app, 200),
            title = cut(e.title, 300),
            body = cut(e.body, 20_000),
        )
    }
}

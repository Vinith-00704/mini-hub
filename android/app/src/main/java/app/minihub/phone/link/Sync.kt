package app.minihub.phone.link

import app.minihub.phone.data.StoredEvent

/**
 * Handing the record over (docs/04 > Handing over the record): from the hub's `ackSeq + 1`, at most 200 at a time,
 * one batch in flight until its ack. Events the owner deleted before they were sent are reported as a gap, so the
 * hub can move past them. After any break the phone starts again from what the hub says it has.
 */
class Sync(private val after: (seq: Long, limit: Int) -> List<StoredEvent>, private val latest: () -> Long) {
    /** The highest number the hub has stored. */
    var acked: Long = 0
        private set
    private var inFlight = false
    var linked = false
        private set

    fun welcome(ackSeq: Long) {
        acked = ackSeq
        inFlight = false
        linked = true
    }

    /** The hub's position: everything up to `seq` is stored. A lower number than sent means start again from there. */
    fun ack(seq: Long) {
        acked = seq
        inFlight = false
    }

    fun lost() {
        inFlight = false
        linked = false
    }

    /** The next frame to send, or null when there is nothing, or a batch is waiting for its ack. */
    fun next(): Frame? {
        if (!linked || inFlight) return null
        val items = after(acked, Frames.MAX_BATCH)
        val first = items.firstOrNull()
        val frame = when {
            first == null -> latest().let { last -> if (last > acked) Frame.Gap(acked + 1, last, DELETED) else null }
            first.seq > acked + 1 -> Frame.Gap(acked + 1, first.seq - 1, DELETED)
            else -> Frame.Events(first.seq, items.filterIndexed { i, e -> e.seq == first.seq + i })
        }
        if (frame != null) inFlight = true
        return frame
    }

    /** How many are waiting to go to the hub. */
    fun waiting(): Long = (latest() - acked).coerceAtLeast(0)

    companion object {
        const val DELETED = "deleted on the phone before it was sent"
    }
}

package app.minihub.phone.link

import app.minihub.phone.data.StoredEvent

/**
 * Handing the record over (docs/04 > Handing over the record): from the hub's `ackSeq + 1`, at most 200 at a time,
 * one batch in flight until its ack. Events the owner deleted before they were sent are reported as a gap, so the
 * hub can move past them. After any break the phone starts again from what the hub says it has.
 */
class Sync(
    private val after: (seq: Long, limit: Int) -> List<StoredEvent>,
    private val latest: () -> Long,
    /** The size of one item as sent (its JSON text); a frame holds at most [maxChars] of them (the hub's frame limit is 4 MiB). */
    private val size: (StoredEvent) -> Int = { 0 },
    private val maxChars: Int = 512_000,
) {
    /** The highest number the hub has stored. */
    var acked: Long = 0
        private set
    private var inFlight = false
    /** Up to here the PC already has everything, from before this phone was paired with it again. */
    private var sentBefore: Long = 0
    var linked = false
        private set

    /**
     * Linked: the hub has everything up to `ackSeq`. [sentBefore] is what this PC acked under an earlier pairing:
     * when it is higher, the first frame is a gap up to it, so what the PC already has is not sent again.
     */
    fun welcome(ackSeq: Long, sentBefore: Long = 0) {
        acked = ackSeq
        this.sentBefore = sentBefore
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
        // Read before the items: an event added between the two reads has a higher number than `last`, so it is
        // never covered by a gap; the next pump (its add starts one) sends it.
        val last = latest()
        val before = minOf(sentBefore, last)
        sentBefore = 0
        if (before > acked) {
            inFlight = true
            return Frame.Gap(acked + 1, before, AGAIN)
        }
        val items = after(acked, Frames.MAX_BATCH)
        val first = items.firstOrNull()
        val frame = when {
            first == null -> if (last > acked) Frame.Gap(acked + 1, last, DELETED) else null
            first.seq > acked + 1 -> Frame.Gap(acked + 1, first.seq - 1, DELETED)
            else -> Frame.Events(first.seq, fit(first.seq, items))
        }
        if (frame != null) inFlight = true
        return frame
    }

    /** The consecutive items from `from` while their running size stays within the limit; always at least the first. */
    private fun fit(from: Long, items: List<StoredEvent>): List<StoredEvent> {
        val out = ArrayList<StoredEvent>()
        var total = 0L
        for ((i, e) in items.withIndex()) {
            if (e.seq != from + i) break
            total += size(e)
            if (out.isNotEmpty() && total > maxChars) break
            out.add(e)
        }
        return out
    }

    /** How many are waiting to go to the hub. */
    fun waiting(): Long = (latest() - acked).coerceAtLeast(0)

    companion object {
        const val DELETED = "deleted or not shared on the phone before it was sent"
        const val AGAIN = "already sent to this PC before it was paired again"
    }
}

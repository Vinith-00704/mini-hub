package app.minihub.phone.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.minihub.phone.consent.AuditRow
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The encrypted record on a real phone, in the trial build only (app.minihub.phone.trial), with made-up data. */
@RunWith(AndroidJUnit4::class)
class RecordDbTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun fresh() {
        check(context.packageName.endsWith(".trial")) { "On-device tests run only in the trial build." }
        context.deleteDatabase("record.db")
    }

    private fun sms(n: Long) = NewEvent(type = "sms", occurredAt = 1_000 + n, who = "Asha Example", whoKey = "+15550123", title = "Asha Example", body = "Message $n")

    @Test
    fun eventsAreStoredNumberedAndReadBackInOrder() {
        val db = RecordDb(context)
        assertEquals(0L, db.latestSeq())
        val seqs = (1L..5L).map { db.insert(sms(it)) }
        assertEquals(listOf(1L, 2L, 3L, 4L, 5L), seqs)
        assertEquals(5L, db.latestSeq())
        assertEquals(listOf(3L, 4L), db.after(2, 2, setOf("sms")).map { it.seq })
        assertEquals("Message 3", db.after(2, 1, setOf("sms")).single().event.body)
    }

    @Test
    fun aDeletedNumberIsNeverUsedAgain() {
        val db = RecordDb(context)
        (1L..3L).forEach { db.insert(sms(it)) }
        assertEquals(1, db.delete(listOf(3L)))
        assertEquals(4L, db.insert(sms(4)))
    }

    @Test
    fun searchCountsAndTheLogWork() {
        val db = RecordDb(context)
        db.insert(sms(1))
        db.insert(NewEvent(type = "call", occurredAt = 5_000, who = "Ravi Example"))
        assertEquals(1, db.search("ravi", 10).size)
        assertEquals(2, db.search("", 10).size)
        assertEquals(0, db.search("100%_", 10).size)
        assertEquals(mapOf("sms" to 1, "call" to 1), db.countsSince(0))
        assertEquals(mapOf("call" to 1), db.countsSince(2_000))
        db.addAudit(AuditRow(1, "Your PC (you)", "status", "phone.usage.read", "done"))
        assertEquals("status", db.recentAudit(5).single().action)
    }

    @Test
    fun theFileOnDiskIsNotPlainSqlite() {
        RecordDb(context).insert(sms(1))
        val file: File = context.getDatabasePath("record.db")
        assertTrue(file.exists())
        val head = file.readBytes().copyOf(16)
        assertFalse(String(head, Charsets.US_ASCII).startsWith("SQLite format 3"))
    }
}

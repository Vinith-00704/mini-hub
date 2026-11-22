package app.minihub.phone.link

import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.AuditRow
import app.minihub.phone.consent.AuditStore
import app.minihub.phone.consent.Grant
import app.minihub.phone.consent.MemoryPrefs
import app.minihub.phone.consent.Switches
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.StoredEvent
import java.io.File
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared examples, read from the protocol package: the hub's tests read the very same files. */
private val examples = File("../../protocol/examples/link")

class FramesTest {
    private fun read(dir: String) = File(examples, dir).listFiles { f -> f.name.endsWith(".json") }!!.sortedBy { it.name }

    @Test
    fun everyValidExampleParsesAndEveryInvalidOneIsRefused() {
        val valid = read("valid")
        val invalid = read("invalid")
        assertTrue(valid.size >= 17)
        assertTrue(invalid.size >= 6)
        for (f in valid) assertNotNull(f.name, Frames.parse(f.readText()))
        for (f in invalid) assertNull(f.name, Frames.parse(f.readText()))
    }

    @Test
    fun aFrameIsTheSameAfterWritingAndReadingIt() {
        for (f in read("valid")) {
            val once = Frames.parse(f.readText())!!
            assertEquals(f.name, once, Frames.parse(Frames.encode(once)))
        }
    }

    @Test
    fun anEventsFrameWith201ItemsIsRefused() {
        fun frame(n: Int) = JSONObject().put("t", "events").put("from", 1).put(
            "items",
            org.json.JSONArray().apply { for (i in 1..n) put(JSONObject().put("seq", i).put("type", "device_state").put("occurredAt", 1)) },
        ).toString()
        assertNotNull(Frames.parse(frame(200)))
        assertNull(Frames.parse(frame(201)))
    }

    @Test
    fun somethingThatIsNotJsonIsRefused() {
        assertNull(Frames.parse("hello"))
        assertNull(Frames.parse("[]"))
    }

    @Test
    fun thePairingWordsMatchTheSharedExample() {
        val ex = JSONObject(File(examples, "pairing-words.json").readText())
        val words = ex.getJSONArray("words").let { a -> (0 until a.length()).map { a.getString(it) } }
        assertEquals(words, Words.pairing(ex.getString("fp"), ex.getString("code"), ex.getString("phoneNonce"), ex.getString("hubNonce")))
        assertEquals(ex.getString("commit"), Words.commit(ex.getString("phoneNonce")))
    }

    @Test
    fun thePairingFramesAreReadAsTheExchangeNeedsThem() {
        val pair = Frames.parse(File(examples, "valid/pair.json").readText()) as Frame.Pair
        assertEquals(64, pair.commit.length)
        assertEquals(Frame.PairNonce("aHViLW5vbmNlLW5vdC1yZWFsLTAy"), Frames.parse(File(examples, "valid/pair-nonce.json").readText()))
        assertEquals(Frame.PairReveal("bm9uY2Utbm90LXJlYWwtMDE"), Frames.parse(File(examples, "valid/pair-reveal.json").readText()))
    }

    @Test
    fun theWordListHas256DistinctWords() {
        assertEquals(256, Words.LIST.size)
        assertEquals(256, Words.LIST.toSet().size)
    }
}

class PairingLinkTest {
    private val fp = "cd".repeat(32)

    @Test
    fun aPairingLinkIsRead() {
        val p = PairingLink.parse("minihub://pair?v=1&host=192.168.1.20%3A47800&fp=$fp&code=Zm9vYmFyYmF6cXV4MTIzNA&name=Test+PC")
        assertEquals(PairingInfo("192.168.1.20", 47800, fp, "Zm9vYmFyYmF6cXV4MTIzNA", "Test PC"), p)
    }

    @Test
    fun anotherVersionOrAnotherKindOfLinkIsRefused() {
        assertThrows(IllegalArgumentException::class.java) { PairingLink.parse("minihub://pair?v=2&host=192.168.1.20%3A47800&fp=$fp&code=x&name=y") }
        assertThrows(IllegalArgumentException::class.java) { PairingLink.parse("https://example.com/?v=1") }
        assertThrows(IllegalArgumentException::class.java) { PairingLink.parse("minihub://pair?v=1&host=192.168.1.20%3A47800&fp=short&code=x") }
    }

    @Test
    fun anAddressAndCodeTypedByHandAreRead() {
        assertEquals(PairingInfo("192.168.1.20", 47800, null, "abc", null), PairingLink.typed(" 192.168.1.20:47800 ", " abc "))
        assertEquals(47800, PairingLink.typed("192.168.1.20", "abc").port)
        assertThrows(IllegalArgumentException::class.java) { PairingLink.typed("", "abc") }
    }
}

class PinTest {
    private fun cert(name: String): X509Certificate =
        CertificateFactory.getInstance("X.509").generateCertificate(javaClass.getResourceAsStream("/link/$name")!!) as X509Certificate

    private val fpA = javaClass.getResourceAsStream("/link/hub-a.fp")!!.bufferedReader().readText().trim()

    @Test
    fun thePinnedHubIsAccepted() {
        assertEquals(fpA, Pin.spkiSha256(cert("hub-a.public-cert.txt")))
        PinnedTrust(fpA).checkServerTrusted(arrayOf(cert("hub-a.public-cert.txt")), "ECDHE_ECDSA")
    }

    @Test
    fun aCertificateWithAnotherKeyIsRefused() {
        assertThrows(CertificateException::class.java) { PinnedTrust(fpA).checkServerTrusted(arrayOf(cert("hub-b.public-cert.txt")), "ECDHE_ECDSA") }
        assertThrows(CertificateException::class.java) { PinnedTrust(fpA).checkServerTrusted(arrayOf(), "ECDHE_ECDSA") }
    }

    @Test
    fun theHubNeverAsksThePhoneForACertificate() {
        assertThrows(CertificateException::class.java) { PinnedTrust(fpA).checkClientTrusted(arrayOf(cert("hub-a.public-cert.txt")), "ECDHE_ECDSA") }
    }
}

class SyncTest {
    private val rows = (1L..450L).map { StoredEvent(it, NewEvent(type = "sms", occurredAt = it)) }.toMutableList()
    private fun sync() = Sync({ after, limit -> rows.filter { it.seq > after }.take(limit) }, { rows.maxOfOrNull { it.seq } ?: 0 })

    @Test
    fun batchesHoldAtMost200AndWaitForTheirAck() {
        val s = sync()
        s.welcome(0)
        val first = s.next() as Frame.Events
        assertEquals(1L, first.from)
        assertEquals(200, first.items.size)
        assertNull(s.next())
        s.ack(200)
        assertEquals(201L, (s.next() as Frame.Events).from)
    }

    @Test
    fun afterABreakThePhoneResendsFromAckSeqPlusOne() {
        val s = sync()
        s.welcome(0)
        s.next()
        s.ack(200)
        s.next()
        s.lost()
        s.welcome(200)
        val again = s.next() as Frame.Events
        assertEquals(201L, again.from)
    }

    @Test
    fun anAckForAnOlderPositionRestartsFromThere() {
        val s = sync()
        s.welcome(0)
        s.next()
        s.ack(150)
        assertEquals(151L, (s.next() as Frame.Events).from)
    }

    @Test
    fun eventsDeletedBeforeTheyWereSentAreReportedAsAGap() {
        rows.removeAll { it.seq in 3L..5L }
        val s = sync()
        s.welcome(2)
        val gap = s.next() as Frame.Gap
        assertEquals(3L, gap.from)
        assertEquals(5L, gap.to)
        assertNull(s.next())
        s.ack(5)
        assertEquals(6L, (s.next() as Frame.Events).from)
    }

    @Test
    fun deletedEventsAtTheEndAreAGapToo() {
        rows.removeAll { it.seq > 448 }
        val s = Sync({ after, limit -> rows.filter { it.seq > after }.take(limit) }, { 450 })
        s.welcome(448)
        assertEquals(Frame.Gap(449, 450, Sync.DELETED), s.next())
    }

    @Test
    fun nothingNewIsNothingToSend() {
        val s = sync()
        s.welcome(450)
        assertNull(s.next())
    }
}

private class MemoryAudit : AuditStore {
    val rows = ArrayList<AuditRow>()
    override fun addAudit(row: AuditRow) {
        rows.add(row)
    }
    override fun recentAudit(limit: Int) = rows.reversed().take(limit)
}

class CommandsTest {
    private val sent = ArrayList<Frame>()
    private val asked = ArrayList<String>()
    private var answer: Boolean? = null
    private val switches = Switches(MemoryPrefs())
    private val audit = MemoryAudit()
    private var ran = 0
    private var stoppedHere = false
    private var cleared = 0

    private fun commands(risk: String = "read") = Commands(
        switches = switches,
        audit = Audit(audit) { 1_000 },
        askOwner = { question, _, reply -> asked.add(question); answer?.let(reply) },
        now = { 1_000 },
        runners = mapOf(
            "status" to Runner("phone.usage.read", risk, "check the battery and network") { ran++; JSONObject().put("battery", 80).toString() },
        ),
        stopped = { stoppedHere },
        clearQuestions = { cleared++ },
    )

    private fun cmd(origin: String = "agent", approved: Boolean = false, name: String = "status") =
        Frame.Cmd(id = "c-1", name = name, args = "{}", origin = origin, approved = approved, approvalId = null)

    @Test
    fun aCommandWhoseFromMyPcSwitchIsOffIsRefusedWhoeverStartedIt() {
        for (origin in listOf("agent", "person")) {
            sent.clear()
            commands().handle(cmd(origin = origin, approved = origin == "person")) { sent.add(it) }
            val r = sent.single() as Frame.Result
            assertFalse(r.ok)
            assertEquals("not-allowed", r.code)
        }
        assertEquals(0, ran)
        assertEquals("refused", audit.rows.last().outcome)
    }

    @Test
    fun onRunsAndAnswers() {
        switches.setPc("phone.usage.read", Grant.On)
        commands().handle(cmd()) { sent.add(it) }
        val r = sent.single() as Frame.Result
        assertTrue(r.ok)
        assertEquals(80, JSONObject(r.data!!).getInt("battery"))
        assertEquals(1, ran)
        assertEquals("Your PC (Mini)", audit.rows.last().who)
    }

    @Test
    fun askWaitsForTheOwnerAndThenRunsOrRefuses() {
        switches.setPc("phone.usage.read", Grant.Ask)
        commands().handle(cmd()) { sent.add(it) }
        assertTrue(sent.single() is Frame.Waiting)
        assertEquals(1, asked.size)
        assertEquals(0, ran)

        answer = true
        sent.clear()
        commands().handle(cmd()) { sent.add(it) }
        assertTrue(sent[0] is Frame.Waiting)
        assertTrue((sent[1] as Frame.Result).ok)

        answer = false
        sent.clear()
        commands().handle(cmd()) { sent.add(it) }
        assertEquals("not-allowed", (sent[1] as Frame.Result).code)
    }

    @Test
    fun anImportantCommandWithApprovedFalseIsAlwaysAsked() {
        switches.setPc("phone.usage.read", Grant.On)
        commands(risk = "important").handle(cmd(approved = false)) { sent.add(it) }
        assertTrue(sent.single() is Frame.Waiting)
        assertEquals(1, asked.size)
        assertEquals(0, ran)
    }

    @Test
    fun anUnknownCommandIsRefusedPlainly() {
        commands().handle(cmd(name = "launch_rockets")) { sent.add(it) }
        assertEquals("unavailable", (sent.single() as Frame.Result).code)
    }

    @Test
    fun whileStoppedACommandFromThePcIsRefusedWithStopped() {
        switches.setPc("phone.usage.read", Grant.On)
        stoppedHere = true
        commands().handle(cmd()) { sent.add(it) }
        assertEquals("stopped", (sent.single() as Frame.Result).code)
        assertEquals(0, ran)
    }

    @Test
    fun stopAnswersAWaitingQuestionNoAndALateYesDoesNothing() {
        switches.setPc("phone.usage.read", Grant.Ask)
        val replies = ArrayList<(Boolean) -> Unit>()
        val c = Commands(switches, Audit(audit) { 1_000 }, { _, _, reply -> replies.add(reply) }, { 1_000 }, mapOf("status" to Runner("phone.usage.read", "read", "check") { ran++; null }), { stoppedHere }, { cleared++ })
        c.handle(cmd()) { sent.add(it) }
        c.stop { }
        assertEquals(1, cleared)
        assertEquals("stopped", (sent.last() as Frame.Result).code)
        replies.single()(true)
        assertEquals(0, ran)
        assertEquals(2, sent.size)
    }

    @Test
    fun stopIsNeverRefused() {
        switches.lockedOnPhone = true
        var stopped = 0
        commands().stop { stopped++ }
        assertEquals(1, stopped)
        assertEquals("stop", audit.rows.last().action)
    }
}

class BackoffTest {
    @Test
    fun backoffDoublesTo60SecondsAndResetsAfterAGoodConnection() {
        val b = Backoff()
        assertEquals(listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L), (1..7).map { b.next() })
        b.reset()
        assertEquals(2_000L, b.next())
    }
}

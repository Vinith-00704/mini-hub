package app.minihub.phone.consent

import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import app.minihub.phone.data.MemoryRecordStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SwitchesTest {
    private fun switches() = Switches(MemoryPrefs())

    @Test
    fun everySwitchStartsOff() {
        val s = switches()
        for (scope in PhoneScopes.ALL) {
            assertFalse(scope.id, s.collect(scope.id))
            assertEquals(scope.id, Grant.Off, s.mini(scope.id))
            assertEquals(scope.id, Grant.Off, s.pc(scope.id))
        }
        assertFalse(s.lockedOnPhone)
    }

    @Test
    fun theHubCanChangeWhatIsCollectedWhenThePhoneIsNotLocked() {
        val s = switches()
        assertTrue(s.applyFromHub(mapOf("phone.usage.read" to true), rev = 1))
        assertTrue(s.collect("phone.usage.read"))
        // An older or repeated change is ignored.
        assertFalse(s.applyFromHub(mapOf("phone.usage.read" to false), rev = 1))
        assertTrue(s.collect("phone.usage.read"))
    }

    @Test
    fun aLockedPhoneIgnoresACollectChangeFromTheHub() {
        val s = switches()
        s.lockedOnPhone = true
        assertFalse(s.applyFromHub(mapOf("phone.usage.read" to true), rev = 5))
        assertFalse(s.collect("phone.usage.read"))
    }

    @Test
    fun theHubCannotTurnOnSomethingThatIsNotCollectable() {
        val s = switches()
        s.applyFromHub(mapOf("phone.control" to true, "pc.power" to true), rev = 1)
        assertFalse(s.collect("phone.control"))
        assertFalse(s.collect("pc.power"))
    }

    @Test
    fun switchesAreKeptAcrossRestarts() {
        val prefs = MemoryPrefs()
        Switches(prefs).apply {
            setCollect("phone.calls.read", true)
            setPc("phone.usage.read", Grant.Ask)
            setMini("phone.calls.read", Grant.On)
        }
        val again = Switches(prefs)
        assertTrue(again.collect("phone.calls.read"))
        assertEquals(Grant.Ask, again.pc("phone.usage.read"))
        assertEquals(Grant.On, again.mini("phone.calls.read"))
    }

    @Test
    fun aChangeIsTold() {
        val s = switches()
        var told = 0
        s.onChange { told++ }
        s.setCollect("phone.usage.read", true)
        s.setPc("phone.usage.read", Grant.On)
        assertEquals(2, told)
    }
}

class RecordTest {
    private val sms = NewEvent(type = "sms", occurredAt = 1_000, who = "Asha Example", whoKey = "+15550123", title = "Asha Example", body = "See you at 8")

    @Test
    fun withCollectOffNothingIsStored() {
        val store = MemoryRecordStore()
        val record = Record(store, Switches(MemoryPrefs()))
        assertNull(record.add(sms))
        assertEquals(0, store.all().size)
    }

    @Test
    fun withCollectOnEventsAreNumberedInOrder() {
        val switches = Switches(MemoryPrefs()).apply { setCollect("phone.messages.read", true) }
        val record = Record(MemoryRecordStore(), switches)
        assertEquals(1L, record.add(sms))
        assertEquals(2L, record.add(sms.copy(occurredAt = 2_000)))
        assertEquals(listOf(2L), record.after(1, 200).map { it.seq })
        assertEquals(2L, record.latestSeq())
    }

    @Test
    fun eachKindFollowsItsOwnSwitch() {
        val switches = Switches(MemoryPrefs()).apply { setCollect("phone.usage.read", true) }
        val record = Record(MemoryRecordStore(), switches)
        assertNull(record.add(NewEvent(type = "call", occurredAt = 1)))
        assertEquals(1L, record.add(NewEvent(type = "device_state", occurredAt = 1)))
    }

    @Test
    fun whatMiniDidIsAlwaysRecorded() {
        val record = Record(MemoryRecordStore(), Switches(MemoryPrefs()))
        assertEquals(1L, record.add(NewEvent(type = "mini_action", occurredAt = 1, title = "Your PC asked for the status")))
    }

    @Test
    fun anUnknownKindIsRefused() {
        val switches = Switches(MemoryPrefs()).apply { for (s in PhoneScopes.ALL) if (s.collectable) setCollect(s.id, true) }
        val record = Record(MemoryRecordStore(), switches)
        assertNull(record.add(NewEvent(type = "telepathy", occurredAt = 1)))
    }
}

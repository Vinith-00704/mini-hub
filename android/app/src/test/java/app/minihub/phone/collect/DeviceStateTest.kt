package app.minihub.phone.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceStateTest {
    @Test
    fun theBatteryIsReportedInStepsOfFiveAndOnlyWhenTheStepChanges() {
        val s = DeviceState()
        assertEquals(StateReading(battery = 80, charging = false, network = "wifi"), s.reading(level = 83, scale = 100, plugged = false, network = "wifi"))
        assertNull(s.reading(level = 81, scale = 100, plugged = false, network = "wifi"))
        assertEquals(75, s.reading(level = 79, scale = 100, plugged = false, network = "wifi")?.battery)
    }

    @Test
    fun chargingOrTheNetworkChangingIsAReading() {
        val s = DeviceState()
        s.reading(50, 100, false, "wifi")
        assertNotNull(s.reading(50, 100, true, "wifi"))
        assertNotNull(s.reading(50, 100, true, "mobile"))
        assertNull(s.reading(52, 100, true, "mobile"))
    }

    @Test
    fun anOddScaleIsTurnedIntoPercent() {
        assertEquals(50, DeviceState().reading(level = 127, scale = 255, plugged = false, network = "none")?.battery)
    }

    @Test
    fun aFullBatteryIsHundred() {
        assertEquals(100, DeviceState().reading(level = 100, scale = 100, plugged = true, network = "wifi")?.battery)
    }

    @Test
    fun anUnknownBatteryIsLeftOut() {
        assertNull(DeviceState().reading(level = -1, scale = 100, plugged = false, network = "wifi")?.battery)
    }
}

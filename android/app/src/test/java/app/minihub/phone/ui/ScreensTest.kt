package app.minihub.phone.ui

import app.minihub.phone.link.LinkStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class ScreensTest {
    private val now = 10_000_000L

    @Test
    fun theHubLineSaysWhereThingsStand() {
        assertEquals("Not paired", Lines.hub(LinkStatus.NotPaired, 0, 0, now))
        assertEquals("Synced just now", Lines.hub(LinkStatus.Linked, now - 20_000, 0, now))
        assertEquals("Synced 2 min ago", Lines.hub(LinkStatus.Linked, now - 120_000, 0, now))
        assertEquals("Syncing: 12 waiting", Lines.hub(LinkStatus.Linked, now, 12, now))
        assertEquals("Not at home: 143 waiting", Lines.hub(LinkStatus.NotAtHome, now - 3_600_000, 143, now))
        assertEquals("Not at home", Lines.hub(LinkStatus.NotAtHome, 0, 0, now))
        assertEquals("Linking to your PC…", Lines.hub(LinkStatus.Connecting, 0, 0, now))
        assertEquals("This phone was removed.", Lines.hub(LinkStatus.Refused("This phone was removed."), 0, 0, now))
    }

    @Test
    fun aLongTimeAgoIsSaidInHoursOrDays() {
        assertEquals("Synced 3 h ago", Lines.hub(LinkStatus.Linked, now - 3 * 3_600_000, 0, now))
        assertEquals("Synced 2 d ago", Lines.hub(LinkStatus.Linked, now - 2 * 86_400_000L - 5, 0, now - 0))
    }

    @Test
    fun countsGroupByKindForToday() {
        val c = Lines.today(mapOf("sms" to 3, "chat" to 4, "call" to 2, "device_state" to 9, "mini_action" to 1))
        assertEquals(listOf("Calls" to 2, "Messages" to 7, "Notifications" to 0, "Mini" to 1), c)
    }

    @Test
    fun aRecordLineNamesTheKindAndWho() {
        assertEquals("Call · Asha Example", Lines.recordTitle("call", "Asha Example", null))
        assertEquals("Phone state", Lines.recordTitle("device_state", null, "Phone state"))
        assertEquals("Message · Ravi Example", Lines.recordTitle("chat", "Ravi Example", "hi"))
    }
}

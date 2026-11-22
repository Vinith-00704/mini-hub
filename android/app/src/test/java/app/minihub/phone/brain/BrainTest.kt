package app.minihub.phone.brain

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadyLineTest {
    @Test
    fun theReadyLineIsFoundAmongOtherLines() {
        val out = "Cloning Mini...\nstarting\nMINI_READY {\"port\":40123,\"token\":\"${"t".repeat(64)}\"}\n"
        val rt = ReadyLine.parse(out).getOrThrow()
        assertEquals(40123, rt.port)
        assertEquals("t".repeat(64), rt.token)
    }

    @Test
    fun anErrorLineBecomesTheMessage() {
        val r = ReadyLine.parse("something\nMINI_ERROR Claude Code is not installed in Termux.\n")
        assertEquals("Claude Code is not installed in Termux.", r.exceptionOrNull()?.message)
    }

    @Test
    fun nothingUsefulSaysMiniDidNotStart() {
        assertEquals("Mini did not start.", ReadyLine.parse("").exceptionOrNull()?.message)
        assertEquals("Mini did not start.", ReadyLine.parse("MINI_READY {not json").exceptionOrNull()?.message)
    }
}

class ReplyTrackerTest {
    private fun state(running: Boolean = true, previewJson: String = "null") =
        """{"running":$running,"activity":{"phase":"thinking","id":"p1","preview":$previewJson}}"""

    @Test
    fun anotherPromptsReplyIsNotOurs() {
        assertEquals(Reply.Waiting, ReplyTracker.read(state(previewJson = """{"id":"other","text":"hi"}"""), "p1"))
        assertEquals(Reply.Waiting, ReplyTracker.read(state(), "p1"))
    }

    @Test
    fun aReplyBeingWrittenIsPartial() {
        assertEquals(Reply.Partial("Asha cal"), ReplyTracker.read(state(previewJson = """{"id":"p1","text":"Asha cal","partial":true}"""), "p1"))
    }

    @Test
    fun aWholeReplyIsFinal() {
        assertEquals(Reply.Final("Asha called.", false), ReplyTracker.read(state(previewJson = """{"id":"p1","text":"Asha called."}"""), "p1"))
        assertEquals(Reply.Final("It failed.", true), ReplyTracker.read(state(previewJson = """{"id":"p1","text":"It failed.","isError":true}"""), "p1"))
    }

    @Test
    fun aStoppedRuntimeIsAsleep() {
        assertEquals(Reply.Asleep, ReplyTracker.read(state(running = false), "p1"))
        assertEquals(Reply.Asleep, ReplyTracker.read("not json", "p1"))
    }
}

class StartScriptTest {
    private fun asset(name: String): String {
        val f = listOf(File("src/main/assets/$name"), File("app/src/main/assets/$name")).first { it.exists() }
        return f.readText()
    }

    @Test
    fun theStartScriptRunsClaudeCodeSafely() {
        val s = asset("start-mini.sh")
        assertTrue("Termux's exec helper breaks Claude Code", s.contains("unset LD_PRELOAD"))
        assertTrue(s.contains("--permission-mode dontAsk"))
        assertTrue(s.contains("--plugin-dir"))
        assertTrue(s.contains("https://github.com/Vinith-00704/Claude-Mini-bot"))
        assertTrue(s.contains("MINI_READY"))
        assertFalse("the full-access flags are never used on the phone", s.contains("--dangerously") || s.contains("bypassPermissions"))
    }

    @Test
    fun theTokenIsOnlyPrintedInTheReadyLine() {
        val s = asset("start-mini.sh")
        val printsToken = s.lines().filter { it.contains("token") && (it.contains("echo") || it.contains("printf")) }
        assertTrue(printsToken.all { it.contains("MINI_READY") })
    }

    @Test
    fun theStopScriptEndsBothSessions() {
        val s = asset("stop-mini.sh")
        assertTrue(s.contains("kill-session -t mini") && s.contains("kill-session -t rt"))
        assertTrue(s.contains("termux-wake-unlock"))
    }
}

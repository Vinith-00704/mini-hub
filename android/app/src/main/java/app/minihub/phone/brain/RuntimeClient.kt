package app.minihub.phone.brain

import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/** The runtime answered with a status that is not a success; [code] tells "no longer open" (409) from the rest. */
class RuntimeRefused(val code: Int) : IllegalStateException("Mini's runtime answered $code.")

/**
 * Talks to the Mini Bot runtime in Termux, on this phone only (127.0.0.1), with its token and the overlay key this app
 * made for it (docs/08 > Mini's brain on the phone). Call from a worker thread. Neither key is ever logged. Neither is
 * sent with a proof, and every request that carries them is sent only after a fresh proof has matched: a program that
 * takes the runtime's port after it dies never sees them.
 */
class RuntimeClient(private val runtime: Runtime, private val overlayKey: String) {
    private val random = SecureRandom()

    /** The runtime's loopback port (not secret; the Brain screen's details). */
    val port: Int get() = runtime.port

    /** Queues a prompt for Mini's Claude Code session and returns its id. */
    fun ask(text: String, spoken: Boolean): String {
        val body = JSONObject().put("text", text).put("source", if (spoken) "voice" else "text").toString()
        return JSONObject(request("POST", "/v1/prompts", body)).getString("id")
    }

    fun state(): String = request("GET", "/v1/state", null)

    /**
     * Whether this runtime holds the overlay key: it must answer a fresh nonce with its HMAC-SHA256 (key = the overlay
     * key, message = the nonce). A program that took the runtime's port after it died cannot, so it gets no prompt.
     * The proof request carries no secret (no token, no overlay key): such a program learns nothing from it.
     */
    fun proves(): Boolean = runCatching { proveOnce() }.getOrDefault(false)

    private fun proveOnce(): Boolean {
        val nonce = hex(16)
        val proof = JSONObject(request("GET", "/v1/phone/proof?nonce=$nonce", null, secrets = false)).getString("proof")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(overlayKey.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val want = mac.doFinal(nonce.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        return MessageDigest.isEqual(want.toByteArray(Charsets.UTF_8), proof.toByteArray(Charsets.UTF_8))
    }

    /** The owner's answer to the runtime's question [id], from the bot. */
    fun answerCard(id: String, choice: String) {
        request("POST", "/v1/cards/answer", JSONObject().put("id", id).put("choice", choice).toString())
    }

    private fun request(method: String, path: String, body: String?, secrets: Boolean = true): String {
        if (secrets && !proveOnce()) error("Mini's runtime did not prove itself.")
        val c = URL("http://127.0.0.1:${runtime.port}$path").openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.useCaches = false
            if (secrets) {
                c.setRequestProperty("authorization", "Bearer ${runtime.token}")
                c.setRequestProperty("x-mini-bot-overlay", overlayKey)
            }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("content-type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val ok = c.responseCode in 200..299
            val text = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (!ok) throw RuntimeRefused(c.responseCode)
            return text
        } finally {
            c.disconnect()
        }
    }

    private fun hex(bytes: Int): String = ByteArray(bytes).also(random::nextBytes).joinToString("") { "%02x".format(it) }

    override fun toString() = "RuntimeClient(port=${runtime.port})"

    private companion object {
        const val TIMEOUT_MS = 5000
    }
}

package app.minihub.phone.link

import android.os.Handler
import android.os.Looper
import java.security.SecureRandom
import java.util.Base64
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** The phone's name and kind, sent to the hub once, at pairing. */
data class ThisPhone(val name: String, val model: String, val appVersion: String)

/**
 * One pairing (docs/04 > Pairing a device): connect to the hub from the code, show the four words, and wait for the
 * owner to press Pair on the PC. The hub then sends this phone's token, once, and it is sealed away.
 */
class Pairer(
    private val info: PairingInfo,
    private val phone: ThisPhone,
    private val save: (HubInfo) -> Unit,
    private val onWords: (List<String>) -> Unit,
    private val onDone: (hubName: String) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var ws: WebSocket? = null
    @Volatile private var finished = false

    fun start() {
        val pinned = info.fp?.let { PinnedTrust(it) }
        val firstSight = if (pinned == null) FirstSightTrust() else null
        val nonce = ByteArray(16).also { SecureRandom().nextBytes(it) }.let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
        val request = Request.Builder().url("https://${info.host}:${info.port}/v1/link").build()
        ws = Tls.client(pinned ?: firstSight!!).newWebSocket(request, object : WebSocketListener() {
            var fp: String? = info.fp

            override fun onOpen(webSocket: WebSocket, response: Response) {
                fp = info.fp ?: firstSight?.seen
                if (fp == null) return fail("Could not read your PC's certificate.")
                // First only a commitment to this phone's random value; it is revealed after the hub sends its own.
                webSocket.send(Frames.encode(Frame.Pair(info.code, Words.commit(nonce), phone.name.take(60).ifBlank { "Phone" }, phone.model.take(100), phone.appVersion)))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                when (val f = Frames.parse(text)) {
                    is Frame.PairNonce -> {
                        val hash = fp ?: return fail("Could not read your PC's certificate.")
                        val words = Words.pairing(hash, info.code, nonce, f.nonce)
                        main.post { onWords(words) }
                        webSocket.send(Frames.encode(Frame.PairReveal(nonce)))
                    }
                    is Frame.Paired -> {
                        val hash = fp ?: return fail("Could not read your PC's certificate.")
                        save(HubInfo(info.host, info.port, hash, f.hubName.ifBlank { info.name ?: "Your PC" }, f.deviceId, f.token))
                        finished = true
                        webSocket.close(1000, null)
                        main.post { onDone(f.hubName) }
                    }
                    is Frame.Refused -> fail(f.reason)
                    else -> {}
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (t is javax.net.ssl.SSLHandshakeException && info.fp != null)
                    fail("This is not the PC that showed the code. Make a new code on your PC and scan it again.")
                else fail("Could not reach your PC at ${info.host}. Check both are on the same Wi-Fi, and that Windows allowed Mini Hub on private networks.")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!finished) fail("Your PC ended the pairing.")
            }
        })
    }

    private fun fail(message: String) {
        if (finished) return
        finished = true
        ws?.cancel()
        main.post { onError(message) }
    }

    fun cancel() {
        finished = true
        ws?.cancel()
    }
}

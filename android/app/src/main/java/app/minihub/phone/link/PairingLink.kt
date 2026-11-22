package app.minihub.phone.link

import java.net.URLDecoder

/** What the pairing code says: where the hub is, its certificate's hash, the one-time code, and its name. */
data class PairingInfo(val host: String, val port: Int, val fp: String?, val code: String, val name: String?)

/** Reads `minihub://pair?v=1&host=…&fp=…&code=…&name=…` (protocol/src/link.ts > pairingLink). */
object PairingLink {
    const val PORT = 47800
    private val FP = Regex("^[0-9a-f]{64}$")

    fun parse(uri: String): PairingInfo {
        val prefix = "minihub://pair?"
        require(uri.startsWith(prefix)) { "This is not a Mini Hub pairing code." }
        val q = uri.removePrefix(prefix).split("&").filter { it.isNotEmpty() }.associate {
            val at = it.indexOf('=')
            val k = if (at < 0) it else it.substring(0, at)
            val v = if (at < 0) "" else URLDecoder.decode(it.substring(at + 1), "UTF-8")
            k to v
        }
        require(q["v"] == "1") { "This pairing code is from another version of Mini Hub." }
        val hostPort = q["host"].orEmpty()
        val at = hostPort.lastIndexOf(':')
        val port = hostPort.substring(at + 1).toIntOrNull()
        val fp = q["fp"].orEmpty()
        val code = q["code"].orEmpty()
        require(at > 0 && port != null && port in 1..65535 && FP.matches(fp) && code.isNotEmpty()) { "This pairing code is incomplete." }
        return PairingInfo(hostPort.substring(0, at), port, fp, code, q["name"])
    }

    /**
     * An address and code typed by hand. Without the hash from the QR code there is nothing to pin yet, so the four
     * words are what protects this way in: the owner must compare them.
     */
    fun typed(address: String, code: String): PairingInfo {
        val a = address.trim()
        val c = code.trim()
        require(a.isNotEmpty() && c.isNotEmpty()) { "Type the address and the code shown on your PC." }
        val at = a.lastIndexOf(':')
        val port = if (at > 0) a.substring(at + 1).toIntOrNull() else PORT
        require(port != null && port in 1..65535) { "That address is not right." }
        return PairingInfo(if (at > 0) a.substring(0, at) else a, port, null, c, null)
    }
}

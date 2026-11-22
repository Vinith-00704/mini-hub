package app.minihub.phone.brain

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Talks to the Mini Bot runtime in Termux, on this phone only (127.0.0.1), with its token. Call from a worker thread. */
class RuntimeClient(private val runtime: Runtime) {
    /** Queues a prompt for Mini's Claude Code session and returns its id. */
    fun ask(text: String, spoken: Boolean): String {
        val body = JSONObject().put("text", text).put("source", if (spoken) "voice" else "text").toString()
        return JSONObject(request("POST", "/v1/prompts", body)).getString("id")
    }

    fun state(): String = request("GET", "/v1/state", null)

    private fun request(method: String, path: String, body: String?): String {
        val c = URL("http://127.0.0.1:${runtime.port}$path").openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.setRequestProperty("authorization", "Bearer ${runtime.token}")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("content-type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val ok = c.responseCode in 200..299
            val text = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (!ok) error("Mini's runtime answered ${c.responseCode}.")
            return text
        } finally {
            c.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 5000
    }
}

package app.minihub.phone.link

import android.content.Context
import app.minihub.phone.data.Sealed
import java.io.File
import org.json.JSONObject

/** The paired hub: where it is, its pinned hash, its name, and this phone's id and token there. */
data class HubInfo(val host: String, val port: Int, val fp: String, val name: String, val deviceId: String, val token: String)

/** Keeps the paired hub sealed with a Keystore key (docs/04 > Pairing a device, step 5). The token is never logged. */
class HubStore(context: Context) {
    private val sealed = Sealed("mini-hub", File(context.noBackupFilesDir, "hub.sealed"))
    @Volatile private var cached: HubInfo? = null
    @Volatile private var loaded = false

    @Synchronized
    fun get(): HubInfo? {
        if (loaded) return cached
        loaded = true
        cached = runCatching {
            sealed.read()?.let { bytes ->
                val o = JSONObject(String(bytes, Charsets.UTF_8))
                HubInfo(o.getString("host"), o.getInt("port"), o.getString("fp"), o.getString("name"), o.getString("deviceId"), o.getString("token"))
            }
        }.getOrNull()
        return cached
    }

    @Synchronized
    fun save(h: HubInfo) {
        val o = JSONObject().put("host", h.host).put("port", h.port).put("fp", h.fp).put("name", h.name).put("deviceId", h.deviceId).put("token", h.token)
        sealed.write(o.toString().toByteArray(Charsets.UTF_8))
        cached = h
        loaded = true
    }

    /** The hub moved to another address on the home network (found again by its announcement). */
    fun moved(host: String, port: Int) {
        get()?.let { if (it.host != host || it.port != port) save(it.copy(host = host, port = port)) }
    }

    @Synchronized
    fun forget() {
        sealed.delete()
        cached = null
        loaded = true
    }
}

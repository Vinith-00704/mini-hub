package app.minihub.phone.collect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.BatteryManager
import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import org.json.JSONObject

/**
 * The phone's state: battery, charging and network, driven by Android's own news (no timer, docs/08 > Staying light).
 * Every change goes to [onState] for the link's state frame; it is also recorded as a `device_state` event, which
 * the record keeps only while "Battery and app use" is collected.
 */
class DeviceStateCollector(private val context: Context, private val record: Record, private val onState: (StateReading) -> Unit) {
    private val state = DeviceState()
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private var level = -1
    private var scale = 100
    private var plugged = false
    private var started = false

    private val battery = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
            plugged = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
            changed()
        }
    }

    private val net = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = changed()
        override fun onLost(network: Network) = changed()
    }

    val current: StateReading? get() = state.current

    fun networkKind(): String {
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "none"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            else -> "none"
        }
    }

    @Synchronized
    private fun changed() {
        val r = state.reading(level, scale, plugged, networkKind()) ?: return
        val data = JSONObject().apply {
            r.battery?.let { put("battery", it) }
            put("charging", r.charging)
            put("network", r.network)
        }
        record.add(NewEvent(type = "device_state", occurredAt = System.currentTimeMillis(), title = "Phone state", data = data.toString()))
        onState(r)
    }

    fun start() {
        if (started) return
        started = true
        context.registerReceiver(battery, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        cm.registerDefaultNetworkCallback(net)
    }

    fun stop() {
        if (!started) return
        started = false
        runCatching { context.unregisterReceiver(battery) }
        runCatching { cm.unregisterNetworkCallback(net) }
    }
}

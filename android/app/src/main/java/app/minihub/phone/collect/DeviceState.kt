package app.minihub.phone.collect

import kotlin.math.roundToInt

/** The phone's state as the hub sees it: battery in steps of 5%, charging, and the kind of network. */
data class StateReading(val battery: Int?, val charging: Boolean, val network: String)

/** Turns Android's battery and network news into readings, and only when something the owner would notice changed. */
class DeviceState {
    private var last: StateReading? = null

    fun reading(level: Int, scale: Int, plugged: Boolean, network: String): StateReading? {
        val battery = if (level < 0 || scale <= 0) null else ((level * 100.0 / scale).roundToInt().coerceIn(0, 100) / 5) * 5
        val now = StateReading(battery, plugged, network)
        if (now == last) return null
        last = now
        return now
    }

    val current: StateReading? get() = last
}

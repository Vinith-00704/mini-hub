package app.minihub.phone.link

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper

/**
 * Finds the paired hub again on the home network by its `_minihub._tcp` announcement (docs/04 > Finding the hub).
 * Only a hub announcing the pinned hash is taken, and the link still checks the certificate itself.
 * No location permission is needed: the Wi-Fi's name is never read.
 */
class Discovery(context: Context) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var active: NsdManager.DiscoveryListener? = null

    @Synchronized
    fun find(fp: String, found: (host: String, port: Int) -> Unit) {
        if (active != null) return
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = done(this)
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceLost(service: NsdServiceInfo) {}

            @Suppress("DEPRECATION")
            override fun onServiceFound(service: NsdServiceInfo) {
                val self = this
                nsd.resolveService(service, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(s: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(s: NsdServiceInfo) {
                        val announced = s.attributes["fp"]?.toString(Charsets.UTF_8)
                        val host = s.host?.hostAddress ?: return
                        if (announced == fp) {
                            done(self)
                            found(host, s.port)
                        }
                    }
                })
            }
        }
        active = listener
        runCatching { nsd.discoverServices("_minihub._tcp", NsdManager.PROTOCOL_DNS_SD, listener) }.onFailure { active = null }
        main.postDelayed({ done(listener) }, SEARCH_MS)
    }

    @Synchronized
    private fun done(listener: NsdManager.DiscoveryListener) {
        if (active !== listener) return
        active = null
        runCatching { nsd.stopServiceDiscovery(listener) }
    }

    companion object {
        const val SEARCH_MS = 30_000L
    }
}

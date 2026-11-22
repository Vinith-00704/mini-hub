package app.minihub.phone.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.Switches
import app.minihub.phone.data.Record
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** What the Hub line on the phone says. */
sealed interface LinkStatus {
    data object NotPaired : LinkStatus
    data object Connecting : LinkStatus
    data object Linked : LinkStatus
    data object NotAtHome : LinkStatus
    data class Refused(val reason: String) : LinkStatus
}

/**
 * The phone's side of the device link (docs/04 > The link protocol). One connection, only on Wi-Fi, only to the pinned
 * hub; no wake lock (docs/08 > Staying light). Everything happens on one thread, in order.
 */
class HubLink(
    context: Context,
    private val hubs: HubStore,
    private val record: Record,
    private val switches: Switches,
    private val audit: Audit,
    private val commands: () -> Commands,
    /** The phone's state frame, built fresh each time. */
    private val state: () -> Frame.State,
    private val appVersion: String,
) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val nsd = Discovery(context)
    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "mini-link").apply { isDaemon = true } }
    private val backoff = Backoff()
    private val sync = Sync({ after, limit -> record.after(after, limit) }, { record.latestSeq() })
    private val listeners = CopyOnWriteArrayList<() -> Unit>()

    private var ws: WebSocket? = null
    private var onWifi = false
    private var started = false
    private var retry: ScheduledFuture<*>? = null
    private var pinger: ScheduledFuture<*>? = null
    private var missed = 0
    private var lastFind = 0L

    @Volatile var status: LinkStatus = if (hubs.get() == null) LinkStatus.NotPaired else LinkStatus.NotAtHome
        private set
    @Volatile var lastSync: Long = 0
        private set

    /** How many events are waiting to go to the hub. */
    fun waiting(): Long = sync.waiting()

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    private fun set(s: LinkStatus) {
        status = s
        listeners.forEach { it() }
    }

    private val wifi = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = onLink {
            onWifi = true
            backoff.reset()
            connect()
        }

        override fun onLost(network: Network) = onLink {
            onWifi = false
            close(LinkStatus.NotAtHome)
        }
    }

    private fun onLink(block: () -> Unit) {
        worker.execute { runCatching(block).onFailure { Log.w(TAG, "link: ${it.javaClass.simpleName}") } }
    }

    fun start() = onLink {
        if (started) return@onLink
        started = true
        cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), wifi)
        record.onAdd { onLink { pump() } }
        switches.onChange { sendState() }
    }

    /** Sync now: send what is waiting, or try to link straight away. */
    fun syncNow() = onLink {
        if (sync.linked) pump() else {
            backoff.reset()
            connect()
        }
    }

    /** Paired just now, or the hub moved: link again with the saved details. */
    fun relink() = onLink {
        close(if (hubs.get() == null) LinkStatus.NotPaired else LinkStatus.NotAtHome)
        backoff.reset()
        connect()
    }

    fun forget() = onLink {
        close(LinkStatus.NotPaired)
        hubs.forget()
        switches.forgetHub()
        audit.add("You", "forget the hub", outcome = "done")
    }

    fun send(f: Frame) = onLink { ws?.send(Frames.encode(f)) }

    fun sendState() = onLink { if (sync.linked) ws?.send(Frames.encode(state())) }

    private fun connect() {
        retry?.cancel(false)
        val hub = hubs.get() ?: return set(LinkStatus.NotPaired)
        if (status is LinkStatus.Refused || ws != null || !onWifi) return
        set(LinkStatus.Connecting)
        val request = Request.Builder().url("https://${hub.host}:${hub.port}/v1/link").build()
        ws = Tls.client(PinnedTrust(hub.fp)).newWebSocket(request, Listener(hub))
    }

    private fun close(next: LinkStatus) {
        retry?.cancel(false)
        pinger?.cancel(false)
        ws?.cancel()
        ws = null
        sync.lost()
        set(next)
    }

    private fun pump() {
        val f = sync.next() ?: return
        ws?.send(Frames.encode(f))
    }

    private fun later() {
        if (!onWifi || status is LinkStatus.Refused || hubs.get() == null) return
        retry?.cancel(false)
        retry = worker.schedule({ runCatching { connect() } }, backoff.next(), TimeUnit.MILLISECONDS)
    }

    /** The hub may have a new address on the home network: look for its announcement, at most every 15 minutes. */
    private fun findAgain(hub: HubInfo) {
        val now = System.currentTimeMillis()
        if (now - lastFind < FIND_EVERY_MS) return
        lastFind = now
        nsd.find(hub.fp) { host, port ->
            onLink {
                if (host == hub.host && port == hub.port) return@onLink
                hubs.moved(host, port)
                backoff.reset()
                connect()
            }
        }
    }

    private inner class Listener(private val hub: HubInfo) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) = onLink {
            if (webSocket != ws) return@onLink
            webSocket.send(Frames.encode(Frame.Hello(hub.deviceId, hub.token, appVersion, record.latestSeq(), System.currentTimeMillis())))
        }

        override fun onMessage(webSocket: WebSocket, text: String) = onLink {
            if (webSocket != ws) return@onLink
            when (val f = Frames.parse(text)) {
                is Frame.Welcome -> {
                    backoff.reset()
                    sync.welcome(f.ackSeq)
                    switches.applyFromHub(f.collect, f.settingsRev)
                    lastSync = System.currentTimeMillis()
                    set(LinkStatus.Linked)
                    webSocket.send(Frames.encode(state()))
                    startPings(webSocket)
                    pump()
                }
                is Frame.Ack -> {
                    sync.ack(f.seq)
                    lastSync = System.currentTimeMillis()
                    pump()
                    listeners.forEach { it() }
                }
                is Frame.Settings -> switches.applyFromHub(f.collect, f.rev)
                is Frame.Cmd -> commands().handle(f) { out -> onLink { webSocket.send(Frames.encode(out)) } }
                Frame.Stop -> commands().stop { stopFromPc.forEach { it() } }
                is Frame.Ping -> webSocket.send(Frames.encode(Frame.Pong(f.time)))
                is Frame.Pong -> missed = 0
                is Frame.Refused -> {
                    // A removed phone stops trying at once (and does not count against the hub's wrong-token limit).
                    close(LinkStatus.Refused(f.reason))
                    audit.add("Your PC", "link", outcome = "refused", detail = f.reason)
                }
                else -> {}
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onLink { gone(webSocket) }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onLink {
            val wasLinked = sync.linked
            gone(webSocket)
            if (!wasLinked) findAgain(hub)
        }
    }

    private fun gone(webSocket: WebSocket) {
        if (webSocket != ws) return
        ws = null
        pinger?.cancel(false)
        sync.lost()
        if (status !is LinkStatus.Refused) set(LinkStatus.NotAtHome)
        later()
    }

    private fun startPings(webSocket: WebSocket) {
        pinger?.cancel(false)
        missed = 0
        pinger = worker.scheduleWithFixedDelay({
            runCatching {
                if (webSocket != ws) return@runCatching
                if (missed >= 2) {
                    webSocket.cancel()
                    gone(webSocket)
                } else {
                    missed++
                    webSocket.send(Frames.encode(Frame.Ping(System.currentTimeMillis())))
                }
            }
        }, PING_MS, PING_MS, TimeUnit.MILLISECONDS)
    }

    /** Told when the PC sends Stop. */
    val stopFromPc = CopyOnWriteArrayList<() -> Unit>()

    companion object {
        private const val TAG = "MiniLink"
        const val PING_MS = 30_000L
        const val FIND_EVERY_MS = 15 * 60_000L
    }
}

package app.minihub.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import app.minihub.phone.brain.ReadyLine
import app.minihub.phone.brain.Reply
import app.minihub.phone.brain.ReplyTracker
import app.minihub.phone.brain.Runtime
import app.minihub.phone.brain.RuntimeClient
import app.minihub.phone.brain.Termux
import app.minihub.phone.link.LinkStatus
import app.minihub.phone.overlay.Overlay
import app.minihub.phone.overlay.SpriteView
import app.minihub.phone.voice.Voice
import java.util.concurrent.Executors

/**
 * Keeps Mini on the phone, in two parts under one notification that says what is on:
 * - the bot: the floating bot and the link to Mini's Claude Code session in Termux;
 * - the link: the phone's record and state, handed to the paired hub on the home Wi-Fi.
 * Stopping the bot ends Mini's session in Termux; the record keeps being collected (docs/03 > The stop button).
 */
class MiniService : Service(), Overlay.Actions {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var overlay: Overlay
    private lateinit var voice: Voice
    private lateinit var phone: Phone
    @Volatile private var client: RuntimeClient? = null
    @Volatile private var asking: String? = null
    private var botOn = false
    private var linkOn = false
    private var unlisten: (() -> Unit)? = null
    private val onStopFromPc: () -> Unit = { main.post { stopFromPc() } }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        phone = Phone.get(this)
        overlay = Overlay(this, this)
        voice = Voice(this)
        phone.link.stopFromPc.add(onStopFromPc)
        unlisten = phone.link.onChange { main.post { if (botOn || linkOn) goForeground() } }
        goForeground("Starting Mini")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (phone.hubs.get() != null && !linkOn) {
            linkOn = true
            linkRunning = true
            phone.startLink()
        }
        when (intent?.action) {
            ACTION_STOP -> stopMini()
            ACTION_SHOW -> showBot()
            ACTION_LINK -> if (!linkOn && !botOn) stopSelf() else goForeground()
            ACTION_ASK -> {
                val text = intent.getStringExtra("text")?.trim().orEmpty()
                if (botOn && text.isNotEmpty()) {
                    showBot()
                    overlay.openPanel()
                    send(text)
                }
            }
            else -> {
                botOn = true
                running = true
                phone.stopped = false
                showBot()
                if (client == null) startMini()
            }
        }
        return START_NOT_STICKY
    }

    private fun showBot() {
        if (!botOn) return
        if (Settings.canDrawOverlays(this)) overlay.show()
        goForeground()
    }

    override fun startMini() {
        phone.stopped = false
        overlay.setAsleep(false)
        overlay.sprite.state = SpriteView.State.Thinking
        overlay.setStatus("Starting Mini's Claude Code in Termux…")
        val script = assets.open("start-mini.sh").bufferedReader().use { it.readText() }
        Termux.run(this, script, "Start Mini") { result ->
            val ready = if (result.error != null) Result.failure(IllegalStateException(result.error)) else ReadyLine.parse(result.stdout)
            ready.onSuccess { rt: Runtime ->
                client = RuntimeClient(rt)
                phone.brain = "ok"
                overlay.sprite.state = SpriteView.State.Idle
                overlay.setStatus("Mini is ready.")
                goForeground()
            }.onFailure { e ->
                client = null
                phone.brain = "asleep"
                overlay.setAsleep(true)
                overlay.setStatus(e.message ?: "Mini did not start.")
                overlay.openPanel()
                goForeground()
            }
        }
    }

    override fun send(text: String) = ask(text, spoken = false)

    override fun listen() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            overlay.setStatus("Mini needs the microphone permission. Open the Mini app to allow it.")
            return
        }
        voice.listen(
            onListening = { on ->
                overlay.sprite.state = if (on) SpriteView.State.Listening else SpriteView.State.Idle
                if (on) overlay.setStatus("Listening…")
            },
            onText = { text -> ask(text, spoken = true) },
            onError = { message -> overlay.setStatus(message) },
        )
    }

    private fun ask(text: String, spoken: Boolean) {
        val c = client ?: return run {
            overlay.setAsleep(true)
            overlay.setStatus(if (phone.stopped) "Mini is stopped. Tap Start Mini to resume." else "Mini is asleep. Tap Start Mini.")
        }
        voice.quiet()
        overlay.setReply("You: $text")
        overlay.setStatus("Mini is thinking…")
        overlay.sprite.state = SpriteView.State.Thinking
        worker.execute {
            val outcome = runCatching {
                val id = c.ask(text, spoken)
                asking = id
                val until = System.currentTimeMillis() + REPLY_WAIT_MS
                var last: Reply = Reply.Waiting
                while (System.currentTimeMillis() < until && asking == id) {
                    val r = ReplyTracker.read(c.state(), id)
                    if (r != last) {
                        last = r
                        main.post { showReply(text, r, spoken) }
                    }
                    if (r is Reply.Final || r is Reply.Asleep) return@runCatching
                    Thread.sleep(POLL_MS)
                }
                if (last !is Reply.Final) main.post { overlay.setStatus("No reply after 3 minutes. Mini may be busy; try again.") }
            }
            outcome.onFailure { e ->
                main.post {
                    client = null
                    phone.brain = "asleep"
                    overlay.setAsleep(true)
                    overlay.setStatus("Mini is asleep (${e.message}). Tap Start Mini.")
                }
            }
        }
    }

    private fun showReply(prompt: String, r: Reply, spoken: Boolean) {
        when (r) {
            is Reply.Partial -> {
                overlay.setReply("You: $prompt\n\n${r.text}")
                overlay.setStatus("Mini is writing…")
            }
            is Reply.Final -> {
                overlay.setReply("You: $prompt\n\n${r.text}")
                overlay.setStatus(if (r.isError) "Mini had a problem." else "")
                overlay.sprite.state = SpriteView.State.Idle
                if (spoken && !r.isError) voice.say(r.text)
            }
            Reply.Asleep -> {
                client = null
                phone.brain = "asleep"
                overlay.setAsleep(true)
                overlay.setStatus("Mini's session stopped. Tap Start Mini.")
            }
            Reply.Waiting -> {}
        }
    }

    override fun hide() {
        overlay.hideAll()
        goForeground("Mini is on, hidden. Tap Show to bring the bot back.")
    }

    /** Ends Mini's session in Termux and the bot's microphone use. */
    private fun endSession() {
        asking = null
        voice.stopListening()
        val script = assets.open("stop-mini.sh").bufferedReader().use { it.readText() }
        Termux.run(this, script, "Stop Mini") { }
        client = null
        phone.brain = "asleep"
    }

    /** Stop on the phone: Mini's session ends and the bot goes. The link keeps the record going if paired. */
    override fun stopMini() {
        if (botOn) phone.audit.add("You", "stop Mini", outcome = "done")
        endSession()
        overlay.hideAll()
        botOn = false
        running = false
        if (linkOn) goForeground() else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    /** Stop from the PC (docs/03 > The stop button): never refused. Mini stops here too, and says so. */
    private fun stopFromPc() {
        phone.stopped = true
        endSession()
        if (botOn) {
            overlay.setAsleep(true)
            overlay.setStatus("Stopped from your PC. Tap Start Mini to resume here.")
            overlay.openPanel()
        }
        goForeground("Stopped from your PC.")
    }

    override fun onDestroy() {
        running = false
        linkRunning = false
        asking = null
        phone.link.stopFromPc.remove(onStopFromPc)
        unlisten?.invoke()
        overlay.hideAll()
        voice.close()
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun linkWords(): String? = if (!linkOn) null else when (val s = phone.link.status) {
        LinkStatus.Linked -> "linked to your PC"
        LinkStatus.Connecting -> "linking to your PC"
        LinkStatus.NotAtHome -> "not at home (recording)"
        is LinkStatus.Refused -> "removed from your PC"
        LinkStatus.NotPaired -> null
    }

    private fun botWords(): String? = when {
        !botOn -> null
        client != null -> "bot on"
        else -> "bot starting"
    }

    private fun goForeground(override: String? = null) {
        val text = override ?: listOfNotNull(linkWords(), botWords()).joinToString(" · ").ifEmpty { "Mini" }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Mini", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val show = PendingIntent.getService(this, 1, Intent(this, MiniService::class.java).setAction(ACTION_SHOW), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, MiniService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_mini)
            .setContentTitle("Mini")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .apply {
                if (botOn) {
                    addAction(Notification.Action.Builder(null, "Show", show).build())
                    addAction(Notification.Action.Builder(null, "Stop Mini", stop).build())
                }
            }
            .build()
        val mic = botOn && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or (if (mic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
        try {
            startForeground(NOTIFICATION_ID, n, type)
        } catch (e: SecurityException) {
            // Android may refuse the microphone type while the app is in the background; the notification must still
            // show. The microphone is only ever used from the bot's Talk button, with the app in front.
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        }
    }

    companion object {
        const val ACTION_STOP = "app.minihub.phone.STOP"
        const val ACTION_SHOW = "app.minihub.phone.SHOW"
        const val ACTION_LINK = "app.minihub.phone.LINK"
        const val ACTION_ASK = "app.minihub.phone.ASK"
        private const val CHANNEL = "mini"
        private const val NOTIFICATION_ID = 1
        private const val POLL_MS = 500L
        private const val REPLY_WAIT_MS = 180_000L

        /** The bot is on. */
        @Volatile var running = false
            private set

        /** The link part is on. */
        @Volatile var linkRunning = false
            private set

        fun start(context: Context) = context.startForegroundService(Intent(context, MiniService::class.java))
        fun stop(context: Context) = context.startService(Intent(context, MiniService::class.java).setAction(ACTION_STOP))

        /** Asks Mini from the app's Home box; the reply shows in the bot's panel. */
        fun ask(context: Context, text: String) = context.startService(Intent(context, MiniService::class.java).setAction(ACTION_ASK).putExtra("text", text))

        /** Starts the link part (and only that) when a hub is paired. */
        fun startLink(context: Context) = context.startForegroundService(Intent(context, MiniService::class.java).setAction(ACTION_LINK))
    }
}

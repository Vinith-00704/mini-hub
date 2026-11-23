package app.minihub.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import app.minihub.phone.brain.BrainKeeper
import app.minihub.phone.brain.BrainReport
import app.minihub.phone.brain.BrainState
import app.minihub.phone.brain.Reply
import app.minihub.phone.brain.ReplyTracker
import app.minihub.phone.brain.RuntimeCard
import app.minihub.phone.brain.RuntimeClient
import app.minihub.phone.brain.RuntimeRefused
import app.minihub.phone.brain.StateReader
import app.minihub.phone.brain.Termux
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.SharedPrefs
import app.minihub.phone.link.LinkStatus
import app.minihub.phone.overlay.ApprovalCard
import app.minihub.phone.overlay.Overlay
import app.minihub.phone.overlay.SpriteView
import app.minihub.phone.voice.Speaker
import app.minihub.phone.voice.TalkActivity
import java.util.concurrent.Executors

/**
 * Keeps Mini on the phone, in three parts under one notification that says what is on:
 * - the record: the collectors, while any collect switch is on;
 * - the link: the phone's record and state, handed to the paired hub on the home Wi-Fi;
 * - the bot: the floating bot and the link to Mini's Claude Code session in Termux, kept by [BrainKeeper].
 * Stopping the bot ends Mini's session in Termux; the record keeps being collected (docs/03 > The stop button).
 * Hiding the bot keeps the brain running.
 */
class MiniService : Service(), Overlay.Actions {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    /** Watches the runtime's state while the bot is shown, and carries the owner's answer to its questions. */
    private val watcher = Executors.newSingleThreadExecutor()
    private lateinit var overlay: Overlay
    private lateinit var approvalCard: ApprovalCard
    private lateinit var speaker: Speaker
    private lateinit var phone: Phone
    private lateinit var keeper: BrainKeeper
    @Volatile private var asking: String? = null
    private var botOn = false
    private var linkOn = false
    private var commanded = false
    private var unlisten: (() -> Unit)? = null
    private var unlistenRecord: (() -> Unit)? = null
    private var unlistenApprovals: (() -> Unit)? = null
    private var unlistenTalk: (() -> Unit)? = null
    private val onStopFromPc: () -> Unit = { main.post { stopFromPc() } }

    // A prompt of ours is being followed, a state check is out, and the runtime's questions the owner has just answered
    // (until the runtime stops listing them). Listening is the Talk sheet's own (TalkActivity.listening).
    @Volatile private var following = false
    private var watching = false
    private val answeredCards = HashSet<String>()
    private var lastAnnouncement: String? = null
    private var lastDetail: String? = null

    /** The screen came on or went off: the card over other apps shows only while the screen is on. */
    private val screenChanged = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = syncCard()
    }
    private val watchTick = object : Runnable {
        override fun run() {
            watch()
            main.postDelayed(this, WATCH_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        phone = Phone.get(this)
        alive = true
        app.minihub.phone.ui.look.Look.apply(this)
        overlay = Overlay(this, this)
        approvalCard = ApprovalCard(this)
        speaker = Speaker(this, SharedPrefs(this, "voice"))
        keeper = BrainKeeper(this, phone, SharedPrefs(this, "brain"), ::brainChanged)
        phone.keeper = keeper
        phone.link.stopFromPc.add(onStopFromPc)
        // A question for the owner shows over other apps whether or not the bot is shown.
        unlistenApprovals = Approvals.onChange { main.post { syncCard() } }
        // The Talk sheet listening: the bot shows it, and the notification says it first.
        unlistenTalk = TalkActivity.onListening { on -> main.post { talkChanged(on) } }
        registerReceiver(screenChanged, IntentFilter(Intent.ACTION_SCREEN_ON).apply { addAction(Intent.ACTION_SCREEN_OFF) }, Context.RECEIVER_NOT_EXPORTED)
        main.postDelayed(watchTick, WATCH_MS)
        syncCard()
        unlisten = phone.link.onChange { main.post { if (keep()) goForeground() } }
        unlistenRecord = phone.collectors.onChange { main.post { recordChanged() } }
        goForeground("Starting Mini")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        commanded = true
        if (phone.hubs.get() != null && !linkOn) {
            linkOn = true
            linkRunning = true
            phone.startLink()
        }
        phone.startRecording()
        when (intent?.action) {
            ACTION_STOP -> stopMini()
            ACTION_SHOW -> showBot()
            ACTION_LINK -> if (!keep()) stopSelf() else goForeground()
            ACTION_ASK -> {
                val text = intent.getStringExtra("text")?.trim().orEmpty()
                val spoken = intent.getBooleanExtra(EXTRA_SPOKEN, false)
                if (botOn && text.isNotEmpty()) {
                    if (spoken) {
                        // From the Talk sheet: a hidden bot stays hidden, and the reply waits in its panel.
                        if (overlay.isShown) overlay.openPanel()
                        ask(text, spoken = true)
                    } else {
                        showBot()
                        overlay.openPanel()
                        send(text)
                    }
                }
            }
            else -> {
                botOn = true
                running = true
                phone.stopped = false
                showBot()
                keeper.start()
            }
        }
        return START_NOT_STICKY
    }

    private fun showBot() {
        if (!botOn) return
        if (Settings.canDrawOverlays(this)) overlay.show()
        keeper.shown(overlay.isShown)
        goForeground()
    }

    /** The panel's Start Mini (shown while the brain is asleep or broken). */
    override fun startMini() {
        phone.stopped = false
        keeper.start()
    }

    override fun openClaudeCode() {
        val problem = Termux.openSession(this)
        if (problem == null) overlay.closePanel() else overlay.setStatus(problem)
    }

    /** What the brain's state looks like on the bot. Hide keeps the brain running; Stop ends it. */
    private fun brainChanged(s: BrainState) {
        overlay.setNeedsYou(s is BrainState.NeedsYou)
        when (s) {
            BrainState.Ready -> {
                overlay.setAsleep(false)
                overlay.setStatus("")
                // What Termux and Claude Code have set up, for the Brain screen (it only reads).
                phone.setup.check()
            }
            is BrainState.Starting -> {
                overlay.setAsleep(false)
                overlay.setState(SpriteView.State.Thinking)
                overlay.setStatus(s.note)
            }
            is BrainState.NeedsYou -> {
                overlay.setAsleep(false)
                overlay.setStatus(s.note)
                if (overlay.isShown) overlay.openPanel()
            }
            BrainState.Resting -> {
                overlay.setAsleep(false)
                overlay.setStatus(BrainKeeper.RESTING)
            }
            is BrainState.Asleep -> {
                stopMic()
                forgetRuntime()
                overlay.setAsleep(true)
                overlay.setStatus(s.reason)
            }
            is BrainState.Broken -> {
                stopMic()
                forgetRuntime()
                overlay.setAsleep(true)
                overlay.setStatus(s.reason)
            }
            BrainState.Off -> {
                stopMic()
                forgetRuntime()
            }
        }
        if (alive && keep()) goForeground()
    }

    override fun send(text: String) = ask(text, spoken = false)

    /**
     * The panel's Talk: the Talk sheet opens, the only place the microphone does (docs/08 > Voice). Not while Mini is
     * stopped or its brain is asleep; in "Start when asked" the sheet starts the brain.
     */
    override fun listen() {
        speaker.quiet()
        val refused = TalkActivity.refusal(phone)
        if (refused != null) {
            overlay.setStatus(refused)
            return
        }
        // The panel is drawn over apps; it goes so it never covers the sheet. The reply opens it again.
        overlay.closePanel()
        TalkActivity.open(this)
    }

    /** A tap on the bot: Mini stops speaking. */
    override fun quiet() = speaker.quiet()

    /** The Talk sheet started or stopped listening. */
    private fun talkChanged(on: Boolean) {
        if (!alive) return
        // While the sheet listens the bot shows it over whatever else it would show; then it shows that again.
        overlay.setListening(on)
        if (on) {
            speaker.quiet()
            // The panel is drawn over apps: it never covers the sheet while it listens.
            overlay.closePanel()
            overlay.setStatus(TalkActivity.LISTENING)
        } else {
            overlay.replaceStatus(
                TalkActivity.LISTENING,
                when (val s = keeper.state) {
                    is BrainState.Starting -> s.note
                    is BrainState.NeedsYou -> s.note
                    BrainState.Resting -> BrainKeeper.RESTING
                    else -> ""
                },
            )
        }
        if (keep()) goForeground(if (botOn && !overlay.isShown) HIDDEN else null)
    }

    private fun ask(text: String, spoken: Boolean) {
        if (phone.stopped) {
            overlay.setAsleep(true)
            overlay.setStatus("Mini is stopped. Tap Start Mini to resume.")
            return
        }
        speaker.quiet()
        overlay.setReply("You: $text")
        overlay.setStatus("Mini is thinking…")
        overlay.setState(SpriteView.State.Thinking)
        keeper.busy()
        // In "Start when asked" this starts the brain; the prompt waits for it (90 s at most).
        keeper.ensure { c -> if (c == null) notSent() else send(c, text, spoken) }
    }

    /** The brain was not there for the prompt: it was not sent, and the bot says why. */
    private fun notSent() {
        val s = keeper.state
        overlay.setStatus(
            when (s) {
                is BrainState.NeedsYou -> s.note
                is BrainState.Asleep -> s.reason
                is BrainState.Broken -> s.reason
                is BrainState.Starting -> "Mini's brain is still starting. Ask again in a moment."
                BrainState.Ready -> "Mini did not get that. Ask again."
                BrainState.Off, BrainState.Resting ->
                    if (phone.stopped) "Mini is stopped. Tap Start Mini to resume." else "Mini is asleep. Tap Start Mini."
            },
        )
        if (s is BrainState.Asleep || s is BrainState.Broken || s == BrainState.Off) overlay.setAsleep(true)
        else overlay.setState(SpriteView.State.Idle)
    }

    /** Sends one prompt to a runtime that is ready, after it proves itself again, and follows its reply. */
    private fun send(c: RuntimeClient, text: String, spoken: Boolean) {
        overlay.setStatus("Mini is thinking…")
        overlay.setState(SpriteView.State.Thinking)
        following = true
        worker.execute {
            if (!c.proves()) {
                main.post {
                    following = false
                    keeper.lost(c, PROOF_FAILED)
                    overlay.setStatus(PROOF_FAILED)
                }
                return@execute
            }
            val outcome = runCatching {
                val id = c.ask(text, spoken)
                asking = id
                val until = System.currentTimeMillis() + REPLY_WAIT_MS
                var last: Reply = Reply.Waiting
                while (System.currentTimeMillis() < until && asking == id) {
                    val raw = c.state()
                    val r = ReplyTracker.read(raw, id)
                    // The same state also says what Mini is doing and whether it has a question for the owner.
                    val report = StateReader.read(raw, null)
                    main.post { applyReport(c, report) }
                    if (r != last) {
                        last = r
                        main.post { showReply(c, text, r, spoken) }
                    }
                    if (r is Reply.Final || r is Reply.Asleep) return@runCatching
                    Thread.sleep(POLL_MS)
                }
                if (last !is Reply.Final) main.post {
                    overlay.setStatus(if (phone.setup.updating) "Mini is updating." else "No reply after 3 minutes. Mini may be busy; try again.")
                }
            }
            main.post { following = false }
            outcome.onFailure { main.post { keeper.lost(c, BrainKeeper.BRINGING_BACK) } }
        }
    }

    // ---- what the runtime says besides the reply: what Mini is doing, its questions, its reminders ----

    /** Every few seconds while the bot is shown and the screen is on: the runtime's state, for a question or a reminder that came by itself. */
    private fun watch() {
        if (watching || !botOn || !overlay.isShown || keeper.state != BrainState.Ready) return
        if (!getSystemService(PowerManager::class.java).isInteractive) return
        val c = keeper.client ?: return
        watching = true
        try {
            watcher.execute {
                val report = runCatching { StateReader.read(c.state(), null) }.getOrNull()
                main.post {
                    watching = false
                    if (report != null) applyReport(c, report)
                }
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            watching = false
        }
    }

    /** Shows what [r] says: Mini's phase on the bot, its open question in the panel, its latest reminder as the status. */
    private fun applyReport(c: RuntimeClient, r: BrainReport) {
        if (c !== keeper.client || keeper.state != BrainState.Ready || phone.stopped) return
        // A listening Talk sheet shows over this on the bot (Overlay.setListening).
        overlay.setState(
            when (r.phase) {
                "working" -> SpriteView.State.Working
                "sending", "thinking" -> SpriteView.State.Thinking
                else -> if (following) SpriteView.State.Thinking else SpriteView.State.Idle
            },
        )
        // Working: what Mini is doing is the status line, until it does something else.
        val detail = if (r.phase == "working") r.detail else null
        if (detail != lastDetail) {
            if (detail != null) overlay.setStatus(detail)
            else lastDetail?.let { overlay.replaceStatus(it, if (following) "Mini is thinking…" else "") }
            lastDetail = detail
        }
        r.announcement?.let {
            if (it != lastAnnouncement) {
                lastAnnouncement = it
                overlay.setAnnouncement(it)
            }
        }
        // Questions the owner just answered stay hidden until the runtime stops listing them.
        answeredCards.retainAll { it == r.card?.id }
        val open = r.card?.takeIf { it.id !in answeredCards }
        overlay.showCard(open) { choice -> if (open != null) answerCard(open, choice) }
    }

    /** The owner tapped an option on the runtime's question: it goes to the runtime, and the question leaves the panel. */
    private fun answerCard(card: RuntimeCard, choice: String) {
        val c = keeper.client
        if (c == null) {
            overlay.setStatus("Mini is not there to take that answer. Try again in a moment.")
            return
        }
        answeredCards.add(card.id)
        overlay.showCard(null) {}
        try {
            watcher.execute {
                val sent = runCatching { c.answerCard(card.id, choice) }
                main.post {
                    // 409: it is no longer open (it ran out, or was answered elsewhere): nothing to say. Anything else: ask again.
                    val failure = sent.exceptionOrNull() ?: return@post
                    if ((failure as? RuntimeRefused)?.code != 409) {
                        answeredCards.remove(card.id)
                        overlay.setStatus("Mini did not get that answer. Tap it again.")
                    }
                }
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            answeredCards.remove(card.id)
        }
    }

    /** The Talk sheet closes with its microphone, and the bot no longer shows a mic ring. */
    private fun stopMic() {
        TalkActivity.stopAll()
    }

    /** What belongs to a runtime that is gone: its open question and the bot's word about what it is doing. */
    private fun forgetRuntime() {
        following = false
        answeredCards.clear()
        lastAnnouncement = null
        lastDetail = null
        overlay.clearAnnouncement()
        overlay.showCard(null) {}
    }

    /** Shows the oldest waiting question over other apps, or nothing: only while the screen is on and Android allows it. */
    private fun syncCard() {
        val waiting = Approvals.pending()
        overlay.setAsking(waiting.any { it.who == "Mini" })
        val screenOn = getSystemService(PowerManager::class.java).isInteractive
        if (waiting.isEmpty() || !screenOn || !Settings.canDrawOverlays(this)) approvalCard.hide()
        else approvalCard.show(waiting.first(), waiting.size - 1)
    }

    private fun showReply(c: RuntimeClient, prompt: String, r: Reply, spoken: Boolean) {
        when (r) {
            is Reply.Partial -> {
                overlay.setReply("You: $prompt\n\n${r.text}")
                overlay.setStatus("Mini is writing…")
            }
            is Reply.Final -> {
                overlay.setReply("You: $prompt\n\n${r.text}")
                overlay.setStatus(if (r.isError) "Mini had a problem." else "")
                overlay.setState(SpriteView.State.Idle)
                keeper.busy()
                // Spoken when the owner chose Always, or When I spoke and this prompt was spoken; never an error.
                // Not while the Talk sheet listens: Mini's own voice would be heard as the owner's next prompt.
                val mode = speaker.speak
                if (!r.isError && !TalkActivity.listening && (mode == Speaker.ALWAYS || (mode == Speaker.SPOKEN && spoken))) speaker.say(r.text)
            }
            Reply.Asleep -> keeper.lost(c, BrainKeeper.BRINGING_BACK)
            Reply.Waiting -> {}
        }
    }

    override fun hide() {
        overlay.hideAll()
        keeper.shown(false)
        goForeground(HIDDEN)
    }

    /** Ends Mini's session in Termux (both tmux sessions), the hands, the Talk sheet and Mini's speaking. */
    private fun endSession() {
        asking = null
        stopMic()
        speaker.quiet()
        forgetRuntime()
        keeper.stop()
    }

    /**
     * Stop on the phone (the notification, the bot, Home, Permissions): Mini's session ends, the bot goes, and PC
     * commands are refused until Mini is started here (docs/03 > The stop button). The record keeps being collected.
     */
    override fun stopMini() {
        if (botOn) phone.audit.add("You", "stop Mini", outcome = "done")
        // Setting stopped ends Mini's open tickets as "stopped" first (the hands' stop hook); then every question is a no.
        phone.stopped = true
        Approvals.noAll(this)
        endSession()
        overlay.hideAll()
        botOn = false
        running = false
        // The record and the link go on without the bot: Stop Mini never ends recording.
        if (linkOn || phone.collectors.anyOn()) goForeground() else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    /** The service runs while the bot is on, a hub is paired, or a collect switch is on. */
    private fun keep() = botOn || linkOn || phone.collectors.anyOn()

    /** A collect switch or a permission changed: say what is recorded now, or stop when nothing is left to do. */
    private fun recordChanged() {
        if (!commanded) return
        if (keep()) goForeground() else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    /** Stop from the PC (docs/03 > The stop button): never refused. Mini stops here too, and says so. */
    private fun stopFromPc() {
        phone.stopFromPc()
        // A session from before this service started may still be running in Termux: the keeper's stop runs the stop
        // script whenever Termux can take it, not only while the bot is on here.
        endSession()
        if (botOn) {
            overlay.setAsleep(true)
            overlay.setStatus("Stopped from your PC. Tap Start Mini to resume here.")
            overlay.openPanel()
        }
        goForeground()
    }

    override fun onDestroy() {
        running = false
        linkRunning = false
        alive = false
        asking = null
        TalkActivity.stopAll()
        main.removeCallbacks(watchTick)
        keeper.stop()
        keeper.close()
        if (phone.keeper === keeper) phone.keeper = null
        phone.link.stopFromPc.remove(onStopFromPc)
        unlisten?.invoke()
        unlistenRecord?.invoke()
        unlistenApprovals?.invoke()
        unlistenTalk?.invoke()
        runCatching { unregisterReceiver(screenChanged) }
        phone.collectors.stop()
        // A question still waiting keeps its notification; its deadline answers no.
        approvalCard.hide()
        overlay.hideAll()
        speaker.close()
        worker.shutdownNow()
        watcher.shutdownNow()
        super.onDestroy()
    }

    private fun linkWords(): String? = if (!linkOn) null else when (val s = phone.link.status) {
        LinkStatus.Linked -> "linked to your PC"
        LinkStatus.Connecting -> "linking to your PC"
        LinkStatus.NotAtHome -> "not at home (recording)"
        is LinkStatus.Refused -> "removed from your PC"
        LinkStatus.NotPaired -> null
    }

    private fun botWords(): String? = if (!botOn) null else when (keeper.state) {
        BrainState.Ready, BrainState.Resting -> "bot on"
        is BrainState.Starting, is BrainState.NeedsYou -> "bot starting"
        else -> "bot asleep"
    }

    /** "recording calls and messages", from what the collectors are running now; null when nothing is. */
    private fun recordWords(): String? {
        val r = phone.collectors.recording()
        if (r.isEmpty()) return null
        return "recording " + if (r.size == 1) r[0] else r.dropLast(1).joinToString(", ") + " and " + r.last()
    }

    /**
     * The notification's text: "Mini is listening" first while the Talk sheet listens, "Stopped from your PC" while it
     * is so, then the record, the link and the bot.
     */
    private fun goForeground(override: String? = null) {
        val lead = if (phone.stoppedBy == "pc") "Stopped from your PC" else null
        val said = override ?: listOfNotNull(lead, recordWords(), linkWords(), botWords()).joinToString(" · ").ifEmpty { "Mini" }
        val text = if (TalkActivity.listening) "Mini is listening · $said" else said
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
        // Special use only: the service never holds the microphone. Only the Talk sheet, on screen, listens.
        startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    companion object {
        const val ACTION_STOP = "app.minihub.phone.STOP"
        const val ACTION_SHOW = "app.minihub.phone.SHOW"
        const val ACTION_LINK = "app.minihub.phone.LINK"
        const val ACTION_ASK = "app.minihub.phone.ASK"
        private const val EXTRA_SPOKEN = "spoken"
        private const val HIDDEN = "Mini is on, hidden. Tap Show to bring the bot back."
        private const val CHANNEL = "mini"
        private const val NOTIFICATION_ID = 1
        private const val POLL_MS = 500L
        /** How often the runtime's state is read while the bot is shown and the screen is on (a question or a reminder that came by itself). */
        private const val WATCH_MS = 3_000L
        private const val REPLY_WAIT_MS = 180_000L
        private const val PROOF_FAILED = "Mini's brain did not prove itself. Starting it again…"

        /** The bot is on. */
        @Volatile var running = false
            private set

        /** The link part is on. */
        @Volatile var linkRunning = false
            private set

        /** The service is up, for any of its parts. */
        @Volatile var alive = false
            private set

        fun start(context: Context) = context.startForegroundService(Intent(context, MiniService::class.java))
        fun stop(context: Context) = context.startService(Intent(context, MiniService::class.java).setAction(ACTION_STOP))

        /** Asks Mini from the app's Home box; the reply shows in the bot's panel. */
        fun ask(context: Context, text: String) = context.startService(Intent(context, MiniService::class.java).setAction(ACTION_ASK).putExtra("text", text))

        /** What the owner said in the Talk sheet; the reply shows in the panel and is spoken as the Voice settings say. */
        fun askSpoken(context: Context, text: String) {
            context.startService(Intent(context, MiniService::class.java).setAction(ACTION_ASK).putExtra("text", text).putExtra(EXTRA_SPOKEN, true))
        }

        /** Starts the link and record parts (not the bot): when a hub is paired or a collect switch is on. */
        fun startLink(context: Context) = context.startForegroundService(Intent(context, MiniService::class.java).setAction(ACTION_LINK))
    }
}

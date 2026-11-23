package app.minihub.phone.voice

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import app.minihub.phone.MiniService
import app.minihub.phone.Phone
import app.minihub.phone.brain.BrainKeeper
import app.minihub.phone.brain.BrainState
import app.minihub.phone.overlay.SpriteView
import app.minihub.phone.ui.look.ButtonKind
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.Tokens
import app.minihub.phone.ui.look.lookButton
import app.minihub.phone.ui.look.lookText
import app.minihub.phone.ui.look.shadowed
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The Talk sheet (docs/08 > Voice): the only place the microphone opens, and only after the owner tapped Talk (the
 * bot's panel, or Home). It is a card at the bottom of the screen with the bot listening, the words as they are heard
 * and Stop; it is not part of the bot, so hiding the bot leaves it. Leaving the screen in any way (Stop, Back, a tap
 * outside the card, another app, the phone locking) closes the microphone and the sheet. What was said goes to Mini,
 * and is never logged.
 */
class TalkActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var phone: Phone
    private lateinit var voice: Voice
    private lateinit var sprite: SpriteView
    private lateinit var line: TextView
    private lateinit var words: TextView
    private lateinit var buttons: LinearLayout
    /** Android's microphone question is on screen over the sheet: that pause is not the owner leaving. */
    private var askingPermission = false
    private var ended = false
    private var unlisten: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        phone = Phone.get(this)
        Look.apply(this)
        voice = Voice(applicationContext)
        setContentView(build())
        onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { end() }
        // Made again by Android (a rotation, a theme change), not by a tap: it does not listen.
        if (savedInstanceState != null) return end()
        // Never over the lock screen.
        if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) return end()
        // Stopped by any path (Permissions, the notification, the PC): the sheet goes at once.
        unlisten = phone.onChange { main.post { if (phone.stopped) end() } }
        val refused = refusal(phone)
        if (refused != null) return closeWith(refused)
        start()
    }

    override fun onPause() {
        super.onPause()
        if (!askingPermission) end()
    }

    /** Android's question is see-through, so only a pause is spared: no longer visible always ends the sheet. */
    override fun onStop() {
        super.onStop()
        end()
    }

    override fun onDestroy() {
        unlisten?.invoke()
        unlisten = null
        end()
        voice.close()
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        askingPermission = false
        if (ended) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) start() else closeWith(Voice.NO_MIC)
    }

    /** The microphone permission, then the speech model, then listening. */
    private fun start() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            show(HEARS_ONLY_HERE, null, listening = false)
            setButtons(STOP to { end() })
            askingPermission = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
            return
        }
        if (!voice.canListen) return noModel(false)
        show(GETTING_READY, null, listening = false)
        setButtons(STOP to { end() })
        voice.support { installed, downloadable ->
            if (ended) return@support
            when {
                installed -> listen(voice.language ?: Locale.getDefault())
                // The recognizer could not say what it has: it is asked to listen, and says itself if it has no model.
                voice.checkFailed -> listen(Locale.getDefault())
                else -> noModel(downloadable)
            }
        }
    }

    private fun listen(locale: Locale) {
        // Getting ready until the recognizer takes the microphone; the bot and the notification say listening already.
        show(GETTING_READY, null, listening = false)
        setButtons(STOP to { end() })
        setListening(true)
        wakeBrain()
        voice.listen(
            locale,
            onReady = { if (!ended) show(LISTENING, words.text.toString(), listening = true) },
            onPartial = { heard -> if (!ended) words.text = heard },
            onText = { text ->
                setListening(false)
                MiniService.askSpoken(this, text)
                end()
            },
            onError = { message ->
                setListening(false)
                closeWith(message)
            },
        )
    }

    /** "Start when asked": the brain starts now, so the words wait less for it. */
    private fun wakeBrain() {
        val keeper = phone.keeper ?: return
        if (keeper.mode != BrainKeeper.DEMAND) return
        val s = keeper.state
        // Only when nothing is starting it already: a prompt waiting for the brain keeps its place.
        if (s == BrainState.Resting || (s is BrainState.Asleep && !s.retrying)) keeper.ensure { }
    }

    /** No on-device model for the phone's language: typing only, with Download when Android can fetch one. */
    private fun noModel(downloadable: Boolean) {
        voice.stopListening()
        setListening(false)
        show(voice.noModel(), null, listening = false)
        if (downloadable) {
            setButtons("Download" to { voice.download(); end() }, "Close" to { end() })
            later(MODEL_WITH_DOWNLOAD_MS)
        } else {
            setButtons("Close" to { end() })
            later(MODEL_MS)
        }
    }

    /** [message] for 2 seconds, without the microphone, then the sheet closes. */
    private fun closeWith(message: String) {
        voice.stopListening()
        setListening(false)
        show(message, null, listening = false)
        setButtons("Close" to { end() })
        later(SAY_MS)
    }

    private fun later(ms: Long) {
        main.removeCallbacksAndMessages(null)
        main.postDelayed({ end() }, ms)
    }

    /** The microphone closes and the sheet goes. Safe to call again. */
    private fun end() {
        if (ended) return
        ended = true
        main.removeCallbacksAndMessages(null)
        voice.stopListening()
        setListening(false)
        if (!isFinishing) finish()
    }

    // ---- the card ----

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun build(): View {
        sprite = SpriteView(this).apply { contentDescription = "Mini" }
        line = lookText(this, "", 15f, 800)
        words = lookText(this, "", 14f, 500, Look.p.ink2, mono = true)
        buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val text = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(line)
            addView(words, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(sprite, LinearLayout.LayoutParams(dp(64), dp(80)))
            addView(text, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) })
        }
        val shadow = dp(Tokens.SHADOW_CARD_DP)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = shadowed(this@TalkActivity, Look.p.card, Tokens.SHADOW_CARD_DP)
            setPadding(dp(14), dp(12), dp(14) + shadow, dp(14) + shadow)
            // Taps on the card stay on the card; a tap outside it closes the sheet.
            isClickable = true
            addView(top)
            addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        }
        return FrameLayout(this).apply {
            setOnClickListener { end() }
            addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
                setMargins(dp(12), 0, dp(12), dp(12))
            })
            // Clear of the gesture bar and the status bar.
            setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
                v.setPadding(0, bars.top, 0, bars.bottom)
                insets
            }
        }
    }

    private fun show(head: String, heard: String?, listening: Boolean) {
        line.text = head
        words.text = heard.orEmpty()
        words.visibility = if (heard == null) View.GONE else View.VISIBLE
        sprite.state = if (listening) SpriteView.State.Listening else SpriteView.State.Idle
        sprite.label = if (listening) "listening" else null
    }

    private fun setButtons(vararg list: Pair<String, () -> Unit>) {
        buttons.removeAllViews()
        list.forEachIndexed { i, (label, onClick) ->
            val kind = if (label == STOP) ButtonKind.Danger else if (i == 0 && list.size > 1) ButtonKind.Primary else ButtonKind.Secondary
            buttons.addView(
                lookButton(this, label, kind, small = true, onClick = onClick),
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { if (i > 0) marginStart = dp(8) },
            )
        }
    }

    companion object {
        private const val REQUEST_MIC = 1
        private const val SAY_MS = 2_000L
        private const val MODEL_MS = 4_000L
        private const val MODEL_WITH_DOWNLOAD_MS = 10_000L
        private const val STOP = "Stop"
        const val LISTENING = "Listening…"
        private const val GETTING_READY = "Getting ready…"
        const val HEARS_ONLY_HERE = "Mini hears you only while this sheet is open."
        const val ASLEEP = "Mini is asleep. Tap Start Mini."
        const val STOPPED = "Mini is stopped. Tap Start Mini to resume."
        const val STOPPED_FROM_PC = "Stopped from your PC. Tap Start Mini to resume here."

        private var current: WeakReference<TalkActivity>? = null
        private val watchers = CopyOnWriteArrayList<(Boolean) -> Unit>()

        /** The sheet is listening: the microphone may be open. */
        @Volatile var listening = false
            private set

        /** Told when listening starts or ends; returns the way to stop being told. */
        fun onListening(fn: (Boolean) -> Unit): () -> Unit {
            watchers.add(fn)
            return { watchers.remove(fn) }
        }

        private fun setListening(on: Boolean) {
            if (listening == on) return
            listening = on
            watchers.forEach { it(on) }
        }

        /** The owner tapped Talk: the sheet opens (one at most). */
        fun open(context: Context) {
            context.startActivity(Intent(context, TalkActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }

        /** Mini stopped, or its brain went to sleep: the microphone closes and the sheet goes. */
        fun stopAll() {
            if (Looper.myLooper() != Looper.getMainLooper()) {
                Handler(Looper.getMainLooper()).post { stopAll() }
                return
            }
            current?.get()?.end()
            setListening(false)
        }

        /**
         * Why Talk does not listen now, or null when it may: Mini stopped, the bot off, or the brain asleep or broken.
         * In "Start when asked" an asleep brain that is not being brought back is started by Talk instead.
         */
        fun refusal(phone: Phone): String? {
            if (phone.stopped) return if (phone.stoppedBy == "pc") STOPPED_FROM_PC else STOPPED
            val keeper = phone.keeper
            if (keeper == null || !MiniService.running) return ASLEEP
            return when (val s = keeper.state) {
                is BrainState.Broken, BrainState.Off -> ASLEEP
                is BrainState.Asleep -> if (keeper.mode == BrainKeeper.DEMAND && !s.retrying) null else ASLEEP
                else -> null
            }
        }
    }
}

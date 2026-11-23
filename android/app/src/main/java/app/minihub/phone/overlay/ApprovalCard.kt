package app.minihub.phone.overlay

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.Question
import app.minihub.phone.ui.Kit
import app.minihub.phone.ui.Tone
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.Tokens
import app.minihub.phone.ui.look.shadowed

/**
 * Holds one button of a question and decides whether a click on it counts. A click counts only after [armedAt] plus
 * 600 ms (a question that has just replaced another is not pressed by a finger that was meant for the first). With
 * [touchOnly] (Yes), it also counts only if a real finger went down and up on the button within the last 500 ms:
 * an accessibility action or a programmatic click has no such touch, so it does nothing. No takes any click.
 * A touch while another app's window covers the button, or any part of this window ([touchOnly]: an overlay that hides
 * the question and leaves Yes showing), does not reach the button and does not count.
 */
class TapGuard(context: Context, private val touchOnly: Boolean, private val armedAt: Long) : FrameLayout(context) {
    private var down = false
    private var lastUp = 0L

    init {
        filterTouchesWhenObscured = true
    }

    override fun onFilterTouchEventForSecurity(e: MotionEvent): Boolean {
        if (touchOnly && (e.flags and MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0) return false
        return super.onFilterTouchEventForSecurity(e)
    }

    override fun dispatchTouchEvent(e: MotionEvent): Boolean {
        // A covered touch is dropped here, before it is noted, so it can never make a later click count.
        if (!onFilterTouchEventForSecurity(e)) {
            down = false
            if (e.actionMasked == MotionEvent.ACTION_UP) covered()
            return false
        }
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> down = true
            // Noted before the button sees it: its click is queued after this returns.
            MotionEvent.ACTION_UP -> {
                if (down) lastUp = SystemClock.uptimeMillis()
                down = false
            }
            MotionEvent.ACTION_CANCEL -> down = false
        }
        return super.dispatchTouchEvent(e)
    }

    /** Whether the click that just came counts. A touch counts once. */
    fun accepts(): Boolean {
        val now = SystemClock.uptimeMillis()
        if (now - armedAt < ARM_MS) return false
        if (!touchOnly) return true
        val touched = lastUp != 0L && now - lastUp <= TOUCH_MS
        lastUp = 0L
        return touched
    }

    /** The owner's tap did nothing because another app covers the question: they are told why, once in a while. */
    private fun covered() {
        val now = SystemClock.uptimeMillis()
        if (now - lastCoveredNote < COVERED_NOTE_MS) return
        lastCoveredNote = now
        Toast.makeText(context, COVERED, Toast.LENGTH_LONG).show()
    }

    companion object {
        const val ARM_MS = 600L
        const val TOUCH_MS = 500L
        private const val COVERED_NOTE_MS = 3000L
        private const val COVERED = "Another app's window covers this question, so the tap did not count. Close it and tap again."
        private var lastCoveredNote = 0L
    }
}

/**
 * Yes and No for [q], side by side, for the card and for Home. Yes answers only for a real touch (see [TapGuard]); both
 * ignore touches while another window covers them (Yes also while another window covers any part of this one), are
 * hidden from accessibility services that are not assistive tools (API 34+), and wait 600 ms from [armedAt]. Only these
 * taps answer a question with yes.
 */
fun answerRow(context: Context, q: Question, armedAt: Long, then: () -> Unit = {}): LinearLayout {
    val k = Kit(context)
    fun guarded(label: String, yes: Boolean): TapGuard {
        val guard = TapGuard(context, touchOnly = yes, armedAt = armedAt)
        val button = k.button(label, primary = yes, small = false) {
            if (guard.accepts()) {
                Approvals.answer(q.id, yes, context)
                then()
            }
        }
        button.filterTouchesWhenObscured = true
        if (Build.VERSION.SDK_INT >= 34) button.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
        guard.addView(button, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        return guard
    }
    return k.row().apply {
        addView(guarded("Yes", true), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = k.dp(8) })
        addView(guarded("No", false), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }
}

/** When the set of waiting questions last changed, for Home: its cards move when one goes, so they are armed again. */
object QuestionShift {
    private var ids: List<Int>? = null
    private var at = 0L

    fun since(now: List<Question>): Long {
        val list = now.map { it.id }
        if (list != ids) {
            ids = list
            at = SystemClock.uptimeMillis()
        }
        return at
    }
}

/** "No answer in 1:52 means no." for a question that ends at [until]. */
fun countdownText(until: Long, now: Long): String {
    val seconds = ((until - now).coerceAtLeast(0) + 999) / 1000
    return "No answer in ${seconds / 60}:${"%02d".format(seconds % 60)} means no."
}

/** The countdown line of a question: it ticks each second while it is on screen, and stops when it is not. */
class CountdownView(context: Context, private val until: Long, sp: Float = 12f) : TextView(context) {
    private val tick = object : Runnable {
        override fun run() {
            text = countdownText(until, System.currentTimeMillis())
            postDelayed(this, 1000)
        }
    }

    init {
        setTextColor(Look.p.ink2)
        textSize = sp
        typeface = Look.mono(context, 500)
        text = countdownText(until, System.currentTimeMillis())
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        removeCallbacks(tick)
        post(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }
}

/**
 * The question over whatever is on screen (docs/08 > Approvals on the phone): the bot asking, who is asking, the
 * question exactly as given, a countdown, Yes and No, and "1 more waiting" when others are queued. One card at a time,
 * oldest first; the service shows the next when this one is answered or runs out. It is not focusable, shows whether or
 * not the bot is hidden, and its buttons ignore touches while another window covers them. Only a tap on Yes or No
 * answers; the answer goes to [Approvals].
 */
class ApprovalCard(private val context: Context) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val k = Kit(context)
    private var view: LinearLayout? = null
    private var shownId = -1
    private var more: TextView? = null

    private val params = WindowManager.LayoutParams(
        context.resources.displayMetrics.widthPixels - 2 * k.dp(16),
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        y = k.dp(8)
    }

    /** Shows [q] with "[more] more waiting" under it; the same question again only updates that line. */
    fun show(q: Question, more: Int) {
        if (view != null && shownId == q.id) {
            setMore(more)
            return
        }
        hide()
        params.width = context.resources.displayMetrics.widthPixels - 2 * k.dp(16)
        val card = build(q)
        shownId = q.id
        view = card
        setMore(more)
        // Without "Display over other apps" Android refuses the window: the notification still shows.
        if (runCatching { wm.addView(card, params) }.isFailure) hide()
    }

    fun hide() {
        view?.let { runCatching { wm.removeView(it) } }
        view = null
        more = null
        shownId = -1
    }

    private fun setMore(n: Int) {
        more?.apply {
            text = "$n more waiting"
            visibility = if (n > 0) View.VISIBLE else View.GONE
        }
    }

    private fun build(q: Question): LinearLayout {
        val shadow = k.dp(Tokens.SHADOW_CARD_DP)
        val sprite = SpriteView(context).apply { state = SpriteView.State.NeedsYou }
        val head = k.row().apply {
            addView(sprite, LinearLayout.LayoutParams(k.dp(40), k.dp(40)))
            addView(k.label("${q.who} is asking", 12f, Tone.INK), k.fill().apply { marginStart = k.dp(10) })
        }
        // A card that has just appeared does not take a tap for 600 ms; Yes takes only a real finger.
        val buttons = answerRow(context, q, SystemClock.uptimeMillis())
        val moreLine = k.muted("", 11.5f)
        more = moreLine
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = shadowed(context, Look.p.card, Tokens.SHADOW_CARD_DP)
            if (Build.VERSION.SDK_INT >= 34) setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
            setPadding(k.dp(14), k.dp(12), k.dp(14) + shadow, k.dp(12) + shadow)
            addView(head)
            addView(k.text(q.text, 14.5f), k.gap(10))
            addView(CountdownView(context, q.until), k.gap(6))
            addView(buttons, k.gap(12))
            addView(moreLine, k.gap(8))
        }
    }
}

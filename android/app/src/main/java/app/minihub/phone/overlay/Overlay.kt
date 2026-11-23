package app.minihub.phone.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.minihub.phone.brain.RuntimeCard
import app.minihub.phone.ui.look.ButtonKind
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.Tokens
import app.minihub.phone.ui.look.box
import app.minihub.phone.ui.look.lookButton
import app.minihub.phone.ui.look.shadowed
import kotlin.math.abs

/**
 * The floating bot and its panel, drawn over other apps. The bot can be dragged and hidden; tapping it opens the
 * panel with the last reply, a text box, Talk, Hide and Stop. Talk opens the Talk sheet, which is not part of the bot:
 * hiding the bot never hides it.
 */
class Overlay(private val context: Context, private val actions: Actions) {
    interface Actions {
        fun send(text: String)
        /** Talk: opens the Talk sheet. */
        fun listen()
        /** A tap on the bot: Mini stops speaking. */
        fun quiet()
        fun hide()
        fun stopMini()
        fun startMini()
        /** Termux in front, attached to Mini's Claude Code session, for the owner to answer what waits there. */
        fun openClaudeCode()
    }

    private val wm = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    val sprite = SpriteView(context)
    private val bubbleParams = WindowManager.LayoutParams(
        dp(64), dp(80),
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = context.resources.displayMetrics.widthPixels - dp(76)
        y = context.resources.displayMetrics.heightPixels / 3
    }

    private val status = TextView(context).apply {
        setTextColor(Look.p.ink2)
        typeface = Look.sans(context, 600)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    }
    private val reply = TextView(context).apply {
        setTextColor(Look.p.ink)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        typeface = Look.mono(context, 500)
        setTextIsSelectable(true)
        text = "Ask Mini something."
    }
    private val replyScroll = ScrollView(context).apply { addView(reply) }
    private val input = EditText(context).apply {
        hint = "Ask Mini"
        setHintTextColor(Look.p.ink3)
        setTextColor(Look.p.ink)
        typeface = Look.mono(context, 500)
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        imeOptions = EditorInfo.IME_ACTION_SEND
        background = box(context, Look.p.card, Look.p.ink, 2)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_SEND) sendTyped()
            true
        }
    }
    // A question from Mini's runtime (a routine that runs a prompt, a bot preview): who asks, its text and one button per
    // option. The head says it is Mini's session asking, so it never reads like the phone's own "… is asking" card.
    private val cardHead = TextView(context).apply {
        setTextColor(Look.p.ink2)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        typeface = Look.sans(context, 800)
    }
    private val cardText = TextView(context).apply {
        setTextColor(Look.p.ink)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        typeface = Look.sans(context, 600)
    }
    private val cardButtons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    private val cardBox = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        visibility = View.GONE
        background = box(context, Look.p.card, Look.p.ink, 2)
        setPadding(dp(10), dp(8), dp(10), dp(8))
        if (Build.VERSION.SDK_INT >= 34) setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
        addView(cardHead)
        addView(cardText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        addView(cardButtons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
    }
    private val startButton = button("Start Mini", primary = true) { actions.startMini() }.apply { visibility = View.GONE }
    private val openButton = button("Open Claude Code", primary = true) { actions.openClaudeCode() }.apply { visibility = View.GONE }
    private val panel = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = shadowed(context, Look.p.card, Tokens.SHADOW_CARD_DP)
        setPadding(dp(14), dp(12), dp(14) + dp(Tokens.SHADOW_CARD_DP), dp(12) + dp(Tokens.SHADOW_CARD_DP))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(context).apply {
                text = "□□□  MINI"
                setTextColor(Look.p.ink)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                typeface = Look.sans(context, 900)
                letterSpacing = 0.07f
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(button("Close") { closePanel() })
        })
        addView(status)
        addView(cardBox, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        addView(replyScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(170)).apply { topMargin = dp(8) })
        addView(startButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        addView(openButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(button("Talk", primary = true) { actions.listen() }, weight())
            addView(button("Send") { sendTyped() }, weight())
            addView(button("Hide") { actions.hide() }, weight())
            addView(button("Stop", danger = true) { actions.stopMini() }, weight())
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
    }
    private val panelParams = WindowManager.LayoutParams(
        (context.resources.displayMetrics.widthPixels * 0.92f).toInt(),
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        0,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
    }

    private var bubbleShown = false
    private var panelShown = false

    /** What the service last said the bot is doing; a waiting question from Mini or its runtime shows over it. */
    private var base = SpriteView.State.Idle
    private var miniAsking = false
    private var listening = false
    private var card: RuntimeCard? = null
    private var announcement: String? = null
    private var statusText = ""

    val isShown: Boolean get() = bubbleShown

    fun show() {
        if (bubbleShown) return
        wm.addView(sprite, bubbleParams)
        bubbleShown = true
        bindDrag()
    }

    fun hideAll() {
        closePanel()
        if (bubbleShown) runCatching { wm.removeView(sprite) }
        bubbleShown = false
    }

    fun openPanel() {
        if (panelShown) return
        panelParams.y = (bubbleParams.y - dp(40)).coerceAtLeast(dp(24))
        wm.addView(panel, panelParams)
        panelShown = true
    }

    fun closePanel() {
        if (panelShown) runCatching { wm.removeView(panel) }
        panelShown = false
    }

    /** The panel's status line. Empty shows the last announcement, if there is one, until the next comes. */
    fun setStatus(text: String) {
        statusText = text
        status.text = text.ifEmpty { announcement.orEmpty() }
    }

    /** The status line becomes [next] only while it still says [was]. */
    fun replaceStatus(was: String, next: String) {
        if (statusText == was) setStatus(next)
    }

    /** A routine's reminder: the status line says it until the next one. */
    fun setAnnouncement(text: String) {
        announcement = text
        status.text = statusText.ifEmpty { text }
    }

    /** A reminder from a runtime that is gone is not the status any more. */
    fun clearAnnouncement() {
        announcement = null
        status.text = statusText
    }

    /** The small word under the bot, or nothing. */
    fun setLabel(text: String?) {
        sprite.label = text
    }

    /** What the bot is doing. A question from Mini (here or in its runtime) wins over it: the bot shows needs you. */
    fun setState(s: SpriteView.State) {
        base = s
        refreshSprite()
    }

    /** A question from Mini is waiting on this phone (an approval for what Mini wants to read). */
    fun setAsking(asking: Boolean) {
        miniAsking = asking
        refreshSprite()
    }

    /** The Talk sheet is listening: the bot shows it over every other state, and then shows that state again. */
    fun setListening(on: Boolean) {
        listening = on
        refreshSprite()
    }

    private fun refreshSprite() {
        val shown = when {
            listening -> SpriteView.State.Listening
            miniAsking || card != null -> SpriteView.State.NeedsYou
            else -> base
        }
        sprite.state = shown
        setLabel(
            when (shown) {
                SpriteView.State.Listening -> "listening"
                SpriteView.State.Thinking -> "thinking"
                SpriteView.State.Working -> "working"
                SpriteView.State.NeedsYou -> "needs you"
                SpriteView.State.Asleep -> "asleep"
                SpriteView.State.Idle -> null
            },
        )
    }

    /**
     * Shows the runtime's open question in the panel with one button per option (primary first), or takes it away
     * when [next] is null. The same question again changes nothing. [answer] gets the chosen option's id.
     * These are consent questions like the phone's own, with the same guards ([TapGuard]): no option takes a tap in its
     * first 600 ms (the card pushes the panel down, under a finger aimed at something else), and the primary one (the
     * yes) takes only a real finger on a window nothing else covers, never an accessibility action.
     */
    fun showCard(next: RuntimeCard?, answer: (String) -> Unit) {
        if (next?.id == card?.id) return
        card = next
        cardButtons.removeAllViews()
        if (next == null) {
            cardBox.visibility = View.GONE
        } else {
            cardHead.text = when (next.kind) {
                "routine" -> "Mini's session asks about a routine"
                "bot-preview" -> "Mini's session asks about a new look"
                else -> "Mini's session asks"
            }
            cardText.text = next.text
            val options = next.options.sortedByDescending { it.primary }
            // Up to three side by side; more are stacked so the labels stay readable on a narrow phone.
            val stacked = options.size > 3
            cardButtons.orientation = if (stacked) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            val armedAt = SystemClock.uptimeMillis()
            options.forEach { o ->
                val guard = TapGuard(context, touchOnly = o.primary, armedAt = armedAt)
                val b = button(o.label, primary = o.primary) { if (guard.accepts()) answer(o.id) }
                b.filterTouchesWhenObscured = true
                if (Build.VERSION.SDK_INT >= 34) b.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
                guard.addView(b, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
                val lp = if (stacked) LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(4) }
                else weight()
                cardButtons.addView(guard, lp)
            }
            cardBox.visibility = View.VISIBLE
        }
        refreshSprite()
    }

    fun setReply(text: String) {
        reply.text = text
        replyScroll.post { replyScroll.fullScroll(View.FOCUS_DOWN) }
    }

    fun setAsleep(asleep: Boolean) {
        startButton.visibility = if (asleep) View.VISIBLE else View.GONE
        setState(if (asleep) SpriteView.State.Asleep else SpriteView.State.Idle)
    }

    /** Claude Code waits for the owner in Termux: the panel offers to open it. */
    fun setNeedsYou(needsYou: Boolean) {
        openButton.visibility = if (needsYou) View.VISIBLE else View.GONE
    }

    private fun sendTyped() {
        val text = input.text.toString().trim()
        if (text.isEmpty()) return
        input.setText("")
        actions.send(text)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun bindDrag() {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        sprite.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    startX = bubbleParams.x
                    startY = bubbleParams.y
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (abs(dx) > dp(6) || abs(dy) > dp(6)) moved = true
                    if (moved) {
                        bubbleParams.x = startX + dx.toInt()
                        bubbleParams.y = startY + dy.toInt()
                        wm.updateViewLayout(sprite, bubbleParams)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        actions.quiet()
                        if (panelShown) closePanel() else openPanel()
                    } else {
                        // Snap to the nearest side so the bot never covers the middle of the screen.
                        val screen = context.resources.displayMetrics.widthPixels
                        bubbleParams.x = if (bubbleParams.x + dp(32) < screen / 2) dp(4) else screen - dp(68)
                        wm.updateViewLayout(sprite, bubbleParams)
                    }
                }
            }
            true
        }
    }

    private fun weight() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) }

    private fun button(label: String, primary: Boolean = false, danger: Boolean = false, onClick: () -> Unit) =
        lookButton(context, label, if (primary) ButtonKind.Primary else if (danger) ButtonKind.Danger else ButtonKind.Secondary, small = true, onClick = onClick)

    private fun rounded(color: String, radiusDp: Int) = GradientDrawable().apply {
        setColor(Color.parseColor(color))
        cornerRadius = radiusDp * density
    }
}

package app.minihub.phone.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs

/**
 * The floating bot and its panel, drawn over other apps. The bot can be dragged and hidden; tapping it opens the
 * panel with the last reply, a text box, the microphone, Hide and Stop.
 */
class Overlay(private val context: Context, private val actions: Actions) {
    interface Actions {
        fun send(text: String)
        fun listen()
        fun hide()
        fun stopMini()
        fun startMini()
    }

    private val wm = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    val sprite = SpriteView(context)
    private val bubbleParams = WindowManager.LayoutParams(
        dp(64), dp(64),
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = context.resources.displayMetrics.widthPixels - dp(76)
        y = context.resources.displayMetrics.heightPixels / 3
    }

    private val status = TextView(context).apply {
        setTextColor(Color.parseColor("#a3aab2"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    }
    private val reply = TextView(context).apply {
        setTextColor(Color.parseColor("#eceef0"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        setTextIsSelectable(true)
        text = "Ask Mini something."
    }
    private val replyScroll = ScrollView(context).apply { addView(reply) }
    private val input = EditText(context).apply {
        hint = "Ask Mini"
        setHintTextColor(Color.parseColor("#737a82"))
        setTextColor(Color.parseColor("#eceef0"))
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        imeOptions = EditorInfo.IME_ACTION_SEND
        background = rounded("#1d2024", 10)
        setPadding(dp(12), dp(10), dp(12), dp(10))
        setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_SEND) sendTyped()
            true
        }
    }
    private val startButton = button("Start Mini", primary = true) { actions.startMini() }.apply { visibility = View.GONE }
    private val panel = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded("#16181b", 16).apply { setStroke(dp(1), Color.parseColor("#2a2e33")) }
        setPadding(dp(14), dp(12), dp(14), dp(12))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(context).apply {
                text = "Mini"
                setTextColor(Color.parseColor("#eceef0"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                paint.isFakeBoldText = true
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(button("Close") { closePanel() })
        })
        addView(status)
        addView(replyScroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(170)).apply { topMargin = dp(8) })
        addView(startButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
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

    fun setStatus(text: String) {
        status.text = text
    }

    fun setReply(text: String) {
        reply.text = text
        replyScroll.post { replyScroll.fullScroll(View.FOCUS_DOWN) }
    }

    fun setAsleep(asleep: Boolean) {
        startButton.visibility = if (asleep) View.VISIBLE else View.GONE
        sprite.state = if (asleep) SpriteView.State.Asleep else SpriteView.State.Idle
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

    private fun button(label: String, primary: Boolean = false, danger: Boolean = false, onClick: () -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(Color.parseColor(if (primary) "#000000" else if (danger) "#e5534b" else "#eceef0"))
        background = rounded(if (primary) "#d77757" else "#1d2024", 10)
        minHeight = dp(40)
        minimumHeight = dp(40)
        setPadding(dp(8), 0, dp(8), 0)
        setOnClickListener { onClick() }
    }

    private fun rounded(color: String, radiusDp: Int) = GradientDrawable().apply {
        setColor(Color.parseColor(color))
        cornerRadius = radiusDp * density
    }
}

package app.minihub.phone.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

/** The default Mini character as pixel art, drawn in the bot's accent, with a gentle bob and a blink. */
class SpriteView(context: Context) : View(context) {
    enum class State { Idle, Listening, Thinking, Asleep }

    var state: State = State.Idle
        set(value) {
            field = value
            invalidate()
        }

    private val accent = Color.parseColor("#d77757")
    private val body = Paint().apply { color = accent }
    private val eye = Paint().apply { color = Color.parseColor("#111111") }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * resources.displayMetrics.density
    }
    private val disc = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#E616181B") }
    private var tick = 0

    private val ticker = object : Runnable {
        override fun run() {
            tick++
            invalidate()
            postDelayed(this, if (state == State.Idle || state == State.Asleep) 400L else 160L)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post(ticker)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(ticker)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        canvas.drawCircle(w / 2, h / 2, w / 2, disc)
        val unit = (w * 0.62f / 12f)
        val bob = when (state) {
            State.Thinking -> if (tick % 2 == 0) -unit * 0.5f else 0f
            State.Listening -> 0f
            State.Asleep -> unit * 0.5f
            State.Idle -> if (tick % 6 < 3) 0f else -unit * 0.3f
        }
        val ox = (w - 12 * unit) / 2
        val oy = (h - 10 * unit) / 2 + bob
        val blink = state == State.Asleep || tick % 14 == 0
        body.alpha = if (state == State.Asleep) 110 else 255
        ROWS.forEachIndexed { y, row ->
            row.forEachIndexed { x, ch ->
                val paint = when (ch) {
                    'A' -> body
                    'E' -> if (blink) body else eye
                    else -> null
                }
                if (paint != null) canvas.drawRect(ox + x * unit, oy + y * unit, ox + (x + 1) * unit, oy + (y + 1) * unit, paint)
            }
        }
        // Listening shows plainly: the microphone is open only while this ring is on.
        if (state == State.Listening) {
            ring.color = Color.parseColor("#e5534b")
            canvas.drawCircle(w / 2, h / 2, w / 2 - ring.strokeWidth, ring)
        }
    }

    private companion object {
        val ROWS = listOf(
            "............",
            "..AAAAAAAA..",
            ".AAAAAAAAAA.",
            "AAAEAAAAEAAA",
            "AAAEAAAAEAAA",
            "AAAAAAAAAAAA",
            ".AAAAAAAAAA.",
            "..A.A..A.A..",
            "..A.A..A.A..",
            "............",
        )
    }
}

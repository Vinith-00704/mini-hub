package app.minihub.phone.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.TypedValue
import android.view.View
import app.minihub.phone.ui.look.Look

/**
 * The default Mini character as pixel art, drawn in the bot's accent, with a gentle bob and a blink. The view is
 * taller than wide (64 × 80 dp for the bubble): the bot's disc is a square the width of the view, and the small
 * [label] sits under it.
 */
class SpriteView(context: Context) : View(context) {
    enum class State { Idle, Listening, Thinking, Working, NeedsYou, Asleep }

    var state: State = State.Idle
        set(value) {
            field = value
            invalidate()
        }

    /** The small word under the bot ("thinking"); nothing while it rests. */
    var label: String? = null
        set(value) {
            field = value
            invalidate()
        }

    private val density = resources.displayMetrics.density
    private val accent = Look.p.accent
    private val body = Paint().apply { color = accent }
    private val eye = Paint().apply { color = Look.p.cardBar }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * density
    }
    // The bubble: the look's card colour with its ink outline.
    private val disc = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Look.p.card }
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f * density
        color = Look.p.ink
    }
    private val tag = Paint().apply { color = Look.p.card }
    private val tagRim = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f * density
        color = Look.p.ink
    }
    private val words = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Look.p.ink
        textAlign = Paint.Align.CENTER
        typeface = Look.sans(context, 800)
    }
    private val tagBox = RectF()
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
        // The disc is a square as wide as the view; what is left below it is for the label.
        canvas.drawCircle(w / 2, w / 2, w / 2 - rim.strokeWidth, disc)
        canvas.drawCircle(w / 2, w / 2, w / 2 - rim.strokeWidth, rim)
        val unit = (w * 0.62f / 12f)
        var shake = 0f
        val bob = when (state) {
            State.Thinking -> if (tick % 2 == 0) -unit * 0.5f else 0f
            State.Working -> {
                shake = if (tick % 2 == 0) -unit * 0.4f else unit * 0.4f
                if (tick % 4 < 2) -unit * 0.3f else 0f
            }
            State.NeedsYou -> if (tick % 6 < 3) -unit * 0.5f else 0f
            State.Listening -> 0f
            State.Asleep -> unit * 0.5f
            State.Idle -> if (tick % 6 < 3) 0f else -unit * 0.3f
        }
        val ox = (w - 12 * unit) / 2 + shake
        val oy = (w - 10 * unit) / 2 + bob
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
            ring.color = Look.p.danger
            canvas.drawCircle(w / 2, w / 2, w / 2 - ring.strokeWidth, ring)
        }
        // A question is waiting: an orange ring that blinks.
        if (state == State.NeedsYou && tick % 6 < 4) {
            ring.color = accent
            canvas.drawCircle(w / 2, w / 2, w / 2 - ring.strokeWidth, ring)
        }
        drawLabel(canvas, w, h)
    }

    private fun drawLabel(canvas: Canvas, w: Float, h: Float) {
        val text = label?.takeIf { it.isNotEmpty() } ?: return
        val band = h - w
        if (band < 10 * density) return
        // 10 sp, made smaller when the word would not fit under the bot (a large system font).
        var size = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 10f, resources.displayMetrics)
        words.textSize = size
        val room = w - 4 * density
        val wide = words.measureText(text)
        if (wide > room) {
            size *= room / wide
            words.textSize = size
        }
        val half = words.measureText(text) / 2 + 3 * density
        val top = w + 1 * density
        tagBox.set(w / 2 - half, top, w / 2 + half, h - 1 * density)
        canvas.drawRect(tagBox, tag)
        canvas.drawRect(tagBox, tagRim)
        val metrics = words.fontMetrics
        canvas.drawText(text, w / 2, tagBox.centerY() - (metrics.ascent + metrics.descent) / 2, words)
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

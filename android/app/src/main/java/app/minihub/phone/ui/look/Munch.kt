package app.minihub.phone.ui.look

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View

/** Mini's pixel art, and the same with its mouth open for munching (as on the dashboard). */
object MiniPixels {
    val CLOSED = listOf("............", "..AAAAAAAA..", ".AAAAAAAAAA.", "AAAEAAAAEAAA", "AAAEAAAAEAAA", "AAAAAAAAAAAA", ".AAAAAAAAAA.", "..A.A..A.A..", "..A.A..A.A..", "............")
    val OPEN = listOf("............", "..AAAAAAAA..", ".AAAAAAAAAA.", "AAAEAAAAE...", "AAAEAAAA....", "AAAAAAAAA...", ".AAAAAAAAAA.", "..A.A..A.A..", "..A.A..A.A..", "............")

    fun draw(canvas: Canvas, rows: List<String>, x: Float, y: Float, unit: Float, body: Paint, eye: Paint) {
        rows.forEachIndexed { r, row ->
            row.forEachIndexed { c, ch ->
                val p = when (ch) {
                    'A' -> body
                    'E' -> eye
                    else -> null
                }
                if (p != null) canvas.drawRect(x + c * unit, y + r * unit, x + (c + 1) * unit, y + (r + 1) * unit, p)
            }
        }
    }
}

/**
 * The loader: Mini walks along a row of dots and munches them, in 8-bit steps. It only runs while it is on screen,
 * and holds still when the phone's animations are off.
 */
class MunchView(context: Context) : View(context) {
    private val body = Paint().apply { color = Look.p.accent }
    private val eye = Paint().apply { color = Look.p.card }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Look.p.ink2 }
    private var step = 0
    private val still = Look.stillness(context)
    private val tick = object : Runnable {
        override fun run() {
            step++
            invalidate()
            if (isShown && !still) postDelayed(this, 150)
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), context.dp(22))

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        removeCallbacks(tick)
        post(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        removeCallbacks(tick)
        if (visibility == VISIBLE && isAttachedToWindow) post(tick)
    }

    override fun onDraw(canvas: Canvas) {
        val gap = context.dp(16).toFloat()
        val cells = (width / gap).toInt().coerceAtLeast(4)
        val pos = if (still) 1 else step % (cells + 2)
        val unit = context.dp(1.8f).toFloat()
        val spriteW = 12 * unit
        val x = pos * gap - spriteW
        for (i in 0 until cells) {
            val cx = i * gap + gap / 2
            if (cx > x + spriteW * 0.6f) canvas.drawCircle(cx, height / 2f, context.dp(2.2f).toFloat(), dot)
        }
        MiniPixels.draw(canvas, if (step % 2 == 0) MiniPixels.CLOSED else MiniPixels.OPEN, x, (height - 10 * unit) / 2, unit, body, eye)
    }
}

/** Mini in a box, for the screens (not the floating bubble): idle bob, thinking fast bob, asleep dim with a "z". */
class PixelBotView(context: Context, var state: String = "idle") : View(context) {
    private val body = Paint()
    private val eye = Paint()
    private val z = Paint(Paint.ANTI_ALIAS_FLAG)
    private var step = 0
    private val still = Look.stillness(context)
    private val tick = object : Runnable {
        override fun run() {
            step++
            invalidate()
            if (isShown && !still) postDelayed(this, if (state == "thinking") 250 else 600)
        }
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

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        removeCallbacks(tick)
        if (visibility == VISIBLE && isAttachedToWindow) post(tick)
    }

    override fun onDraw(canvas: Canvas) {
        val p = Look.p
        body.color = p.accent
        body.alpha = if (state == "asleep") (if (step % 2 == 0) 120 else 80) else 255
        eye.color = p.cardBar
        val unit = minOf(width / 12f, height / 10f)
        val bob = when (state) {
            "thinking" -> if (step % 2 == 0) -unit * 0.5f else 0f
            "asleep" -> 0f
            else -> if (step % 2 == 0) 0f else -unit * 0.3f
        }
        val x = (width - 12 * unit) / 2
        val y = (height - 10 * unit) / 2 + bob
        MiniPixels.draw(canvas, MiniPixels.CLOSED, x, y, unit, body, eye)
        if (state == "asleep") {
            z.color = p.ink3
            z.textSize = unit * 3
            z.typeface = Look.mono(context, 700)
            val rise = (step % 4) * unit
            canvas.drawText("z", x + 12 * unit - unit, y + unit * 2 - rise, z)
        }
    }
}

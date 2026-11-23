package app.minihub.phone.ui.look

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.StateListDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView

/*
 * The parts of the Claude look on the phone, the same as the dashboard's (ui/src/components/look): square corners,
 * 2 dp ink outlines, hard offset shadows, uppercase Archivo labels, orange for the one main action.
 */

internal fun Context.dp(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()
internal fun Context.dp(v: Int): Int = dp(v.toFloat())

/** A rectangle: fill and an ink outline. */
fun box(context: Context, fill: Int, stroke: Int = Look.p.ink, strokeDp: Int = Tokens.OUTLINE_DP, dashed: Boolean = false, radiusDp: Int = 0): GradientDrawable =
    GradientDrawable().apply {
        setColor(fill)
        if (strokeDp > 0) {
            if (dashed) setStroke(context.dp(strokeDp), stroke, context.dp(6).toFloat(), context.dp(4).toFloat()) else setStroke(context.dp(strokeDp), stroke)
        }
        cornerRadius = context.dp(radiusDp).toFloat()
    }

/** A box with the hard offset shadow under it (no blur). The view needs end/bottom padding of the shadow's size. */
fun shadowed(context: Context, fill: Int, shadowDp: Int, stroke: Int = Look.p.ink, radiusDp: Int = 0): Drawable {
    val s = context.dp(shadowDp)
    val shadow = GradientDrawable().apply {
        setColor(Look.p.shadow)
        cornerRadius = context.dp(radiusDp).toFloat()
    }
    return LayerDrawable(arrayOf(shadow, box(context, fill, stroke, radiusDp = radiusDp))).apply {
        setLayerInset(0, s, s, 0, 0)
        setLayerInset(1, 0, 0, s, s)
    }
}

/** Text in the look: Archivo (or JetBrains Mono), uppercase for labels. */
fun lookText(context: Context, s: CharSequence, sp: Float = Tokens.BODY_SP, weight: Int = 500, color: Int = Look.p.ink, mono: Boolean = false, upper: Boolean = false, lines: Int = 0): TextView =
    TextView(context).apply {
        text = if (upper) s.toString().uppercase() else s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        typeface = if (mono) Look.mono(context, weight) else Look.sans(context, weight)
        if (upper) letterSpacing = 0.06f
        includeFontPadding = false
        if (lines > 0) {
            maxLines = lines
            ellipsize = TextUtils.TruncateAt.END
        }
    }

enum class ButtonKind { Primary, Secondary, Danger, Stop }

/** A button with the hard shadow; pressing moves it into its shadow. */
@SuppressLint("ClickableViewAccessibility")
fun lookButton(context: Context, label: String, kind: ButtonKind = ButtonKind.Secondary, small: Boolean = false, enabled: Boolean = true, onClick: () -> Unit): TextView {
    val p = Look.p
    val (fill, text, stroke) = when (kind) {
        ButtonKind.Primary -> Triple(p.accent, p.onAccent, p.ink)
        ButtonKind.Secondary -> Triple(p.card, p.ink, p.ink)
        ButtonKind.Danger -> Triple(p.card, p.danger, p.danger)
        ButtonKind.Stop -> Triple(p.danger, Color.BLACK, p.ink)
    }
    val shadow = Tokens.SHADOW_BUTTON_DP
    return lookText(context, label, if (small) 11.5f else 12.5f, 800, text, upper = true).apply {
        gravity = Gravity.CENTER
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_pressed), shadowed(context, fill, 1, stroke))
            addState(intArrayOf(), shadowed(context, fill, shadow, stroke))
        }
        val padH = context.dp(if (small) 10 else 14)
        setPadding(padH, 0, padH + context.dp(shadow), context.dp(shadow))
        minHeight = context.dp((if (small) 30 else 38) + shadow)
        isEnabled = enabled
        alpha = if (enabled) 1f else 0.5f
        isClickable = true
        isFocusable = true
        setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    v.translationX = context.dp(2).toFloat()
                    v.translationY = context.dp(2).toFloat()
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.translationX = 0f
                    v.translationY = 0f
                }
            }
            false
        }
        setOnClickListener { if (isEnabled) onClick() }
    }
}

enum class TagTone { Plain, Ok, Danger, Warn, Muted, Fill, Accent }

/** A small bordered uppercase label; `pill` rounds it. */
fun lookTag(context: Context, label: String, tone: TagTone = TagTone.Plain, pill: Boolean = false): TextView {
    val p = Look.p
    val (fg, bg, stroke) = when (tone) {
        TagTone.Plain -> Triple(p.ink, p.card, p.ink)
        TagTone.Ok -> Triple(p.ok, p.card, p.ok)
        TagTone.Danger -> Triple(p.danger, p.card, p.danger)
        TagTone.Warn -> Triple(p.warn, p.card, p.warn)
        TagTone.Muted -> Triple(p.ink3, p.card, p.ink3)
        TagTone.Fill -> Triple(p.card, p.ink, p.ink)
        TagTone.Accent -> Triple(p.onAccent, p.accent, p.ink)
    }
    return lookText(context, label, 10.5f, 800, fg, upper = true).apply {
        background = box(context, bg, stroke, 2, radiusDp = if (pill) 99 else 0)
        setPadding(context.dp(if (pill) 9 else 6), context.dp(2), context.dp(if (pill) 9 else 6), context.dp(2))
    }
}

/**
 * A card drawn as a little window: a title bar with three hollow squares and an uppercase title, an optional tag,
 * and a body. Views added to it after it is built go into the body.
 */
class WindowCard(context: Context, title: String?, tag: View? = null) : LinearLayout(context) {
    val body: LinearLayout = LinearLayout(context).apply {
        orientation = VERTICAL
        val pad = context.dp(Tokens.PAD_CARD_DP)
        setPadding(pad, pad, pad, pad)
    }
    private var built = false

    init {
        orientation = VERTICAL
        val s = context.dp(Tokens.SHADOW_CARD_DP)
        background = shadowed(context, Look.p.card, Tokens.SHADOW_CARD_DP)
        setPadding(0, 0, s, s)
        if (title != null) {
            val bar = LinearLayout(context).apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = LayerDrawable(arrayOf(box(context, Look.p.cardBar, Look.p.ink, 2))).apply { setLayerInset(0, 0, -context.dp(2), 0, 0) }
                setPadding(context.dp(10), context.dp(7), context.dp(10), context.dp(7))
                minimumHeight = context.dp(32)
                addView(Squares(context), LayoutParams(context.dp(36), context.dp(10)).apply { marginEnd = context.dp(8) })
                addView(lookText(context, title, 12f, 800, upper = true, lines = 1), LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
                if (tag != null) addView(tag)
            }
            super.addView(bar, -1, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
            // The outline of the whole card is drawn by the background; the bar's own box gives the line under it.
            bar.background = box(context, Look.p.cardBar, Look.p.ink, 2)
        }
        super.addView(body, -1, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        built = true
    }

    override fun addView(child: View, index: Int, params: ViewGroup.LayoutParams) {
        if (built) body.addView(child, index, params) else super.addView(child, index, params)
    }
}

/** The three hollow squares of a window's title bar. */
class Squares(context: Context) : View(context) {
    private val paint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = context.dp(1.6f).toFloat()
        color = Look.p.ink
    }

    override fun onDraw(canvas: Canvas) {
        val s = height.toFloat() - paint.strokeWidth
        val gap = context.dp(4).toFloat()
        for (i in 0 until 3) {
            val x = paint.strokeWidth / 2 + i * (s + gap)
            canvas.drawRect(x, paint.strokeWidth / 2, x + s, paint.strokeWidth / 2 + s, paint)
        }
    }
}

/** OFF · ASK · ON (any few values) as a pill; the chosen one filled (grey when it is the quiet "off"). */
class ChoiceView(context: Context, label: String, options: List<Pair<String, String>>, value: String, quiet: String? = "off", onChange: (String) -> Unit) : LinearLayout(context) {
    init {
        orientation = HORIZONTAL
        contentDescription = label
        background = box(context, Look.p.card, Look.p.ink, 2, radiusDp = 99)
        setPadding(context.dp(2), context.dp(2), context.dp(2), context.dp(2))
        for ((v, text) in options) {
            val chosen = v == value
            val p = Look.p
            addView(lookText(context, text, 10.5f, 800, if (chosen) (if (v == quiet) p.card else p.onAccent) else p.ink3, upper = true).apply {
                gravity = Gravity.CENTER
                background = if (chosen) box(context, if (v == quiet) p.ink3 else p.accent, p.ink, 0, radiusDp = 99) else null
                setPadding(context.dp(10), context.dp(5), context.dp(10), context.dp(5))
                contentDescription = "$label: $text"
                isSelected = chosen
                isClickable = true
                setOnClickListener { if (!chosen) onChange(v) }
            })
        }
    }
}

/** The collect switch: a square track, orange when on, with ON / OFF beside it. */
class LookSwitch(context: Context, label: String, on: Boolean, private val onChange: (Boolean) -> Unit) : LinearLayout(context) {
    private var state = on

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        contentDescription = label
        isClickable = true
        draw()
        setOnClickListener {
            state = !state
            draw()
            onChange(state)
        }
    }

    private fun draw() {
        removeAllViews()
        val p = Look.p
        val track = object : View(context) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)
            override fun onDraw(canvas: Canvas) {
                val o = context.dp(2).toFloat()
                paint.style = Paint.Style.FILL
                paint.color = p.shadow
                canvas.drawRect(o, o, width.toFloat(), height.toFloat(), paint)
                paint.color = if (state) p.accent else p.card
                canvas.drawRect(0f, 0f, width - o, height - o, paint)
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = context.dp(2).toFloat()
                paint.color = p.ink
                canvas.drawRect(paint.strokeWidth / 2, paint.strokeWidth / 2, width - o - paint.strokeWidth / 2, height - o - paint.strokeWidth / 2, paint)
                paint.style = Paint.Style.FILL
                paint.color = if (state) p.onAccent else p.ink3
                val k = (height - o) - context.dp(8)
                val x = if (state) width - o - context.dp(4) - k else context.dp(4).toFloat()
                canvas.drawRect(x, context.dp(4).toFloat(), x + k, context.dp(4) + k, paint)
            }
        }
        addView(track, LayoutParams(context.dp(40), context.dp(22)))
        addView(lookText(context, if (state) "ON" else "OFF", 11f, 700, mono = true), LayoutParams(context.dp(30), LayoutParams.WRAP_CONTENT).apply { marginStart = context.dp(8) })
    }
}

/** An outlined bar with an orange fill. */
class BarView(context: Context, private var value: Float, private val max: Float = 100f) : View(context) {
    private val paint = Paint()

    fun set(v: Float) {
        value = v
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), context.dp(18))

    override fun onDraw(canvas: Canvas) {
        val p = Look.p
        val s = context.dp(2).toFloat()
        paint.style = Paint.Style.FILL
        paint.color = p.card
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        val w = (width - 2 * s) * (value / max).coerceIn(0f, 1f)
        paint.color = p.accent
        canvas.drawRect(s, s, s + w, height - s, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = s
        paint.color = p.ink
        canvas.drawRect(s / 2, s / 2, width - s / 2, height - s / 2, paint)
        if (w > 0 && w < width - 2 * s) canvas.drawLine(s + w, 0f, s + w, height.toFloat(), paint)
    }
}

/** A row of square cells filled orange up to a value; dashed cells for what is not there. */
class SegmentsView(context: Context, private val filled: Int, private val total: Int, private val dark: Int = 0) : View(context) {
    private val paint = Paint()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), context.dp(16))

    override fun onDraw(canvas: Canvas) {
        val p = Look.p
        val gap = context.dp(4).toFloat()
        val n = total.coerceAtLeast(1)
        val w = (width - gap * (n - 1)) / n
        val s = context.dp(1.6f).toFloat()
        for (i in 0 until n) {
            val x = i * (w + gap)
            val r = RectF(x + s / 2, s / 2, x + w - s / 2, height - s / 2)
            paint.style = Paint.Style.FILL
            paint.color = when {
                i < filled -> p.accent
                i < filled + dark -> p.ink
                else -> p.card
            }
            canvas.drawRect(r, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = s
            paint.color = if (i < filled + dark) p.ink else p.ink3
            paint.pathEffect = if (i < filled + dark) null else DashPathEffect(floatArrayOf(s * 2, s * 2), 0f)
            canvas.drawRect(r, paint)
            paint.pathEffect = null
        }
    }
}

/** A semicircle gauge: orange arc up to the value and the number in the middle. */
class GaugeView(context: Context, private val value: Int?, private val max: Int = 100) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(context.dp(170), context.dp(96))

    override fun onDraw(canvas: Canvas) {
        val p = Look.p
        val thick = context.dp(18).toFloat()
        val r = RectF(thick / 2 + context.dp(4), thick / 2 + context.dp(4), width - thick / 2 - context.dp(4), (width - thick / 2 - context.dp(4)).toFloat())
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = thick
        paint.strokeCap = Paint.Cap.BUTT
        paint.color = p.soft
        canvas.drawArc(r, 180f, 180f, false, paint)
        val frac = ((value ?: 0).toFloat() / max).coerceIn(0f, 1f)
        if (frac > 0) {
            paint.color = p.accent
            canvas.drawArc(r, 180f, 180f * frac, false, paint)
        }
        paint.strokeWidth = context.dp(2).toFloat()
        paint.color = p.ink
        val outer = RectF(r.left - thick / 2, r.top - thick / 2, r.right + thick / 2, r.bottom + thick / 2)
        val inner = RectF(r.left + thick / 2, r.top + thick / 2, r.right - thick / 2, r.bottom - thick / 2)
        canvas.drawArc(outer, 180f, 180f, false, paint)
        canvas.drawArc(inner, 180f, 180f, false, paint)
        paint.style = Paint.Style.FILL
        paint.textAlign = Paint.Align.CENTER
        paint.textSize = context.dp(30).toFloat()
        paint.typeface = Look.sans(context, 900)
        canvas.drawText(if (value == null) "—" else "$value%", width / 2f, r.centerY() - context.dp(6), paint)
    }
}

/** The ground: the look's background colour with the dotted-paper grid. */
class DotsDrawable(private val context: Context) : Drawable() {
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Look.p.dots }

    override fun draw(canvas: Canvas) {
        canvas.drawColor(Look.p.ground)
        val gap = context.dp(Tokens.DOTS_GAP_DP).toFloat()
        val r = context.dp(1.2f).toFloat()
        var y = gap / 2
        while (y < bounds.height()) {
            var x = gap / 2
            while (x < bounds.width()) {
                canvas.drawCircle(x, y, r, dot)
                x += gap
            }
            y += gap
        }
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = android.graphics.PixelFormat.OPAQUE
}

/** The dashed placeholder box. */
fun dashBox(context: Context, label: String, onClick: (() -> Unit)? = null): TextView =
    lookText(context, label, 12f, 800, Look.p.ink3, upper = true).apply {
        gravity = Gravity.CENTER
        background = box(context, Color.TRANSPARENT, Look.p.ink3, 2, dashed = true)
        setPadding(0, context.dp(12), 0, context.dp(12))
        if (onClick != null) {
            isClickable = true
            setOnClickListener { onClick() }
        }
    }

/** The striped "limit" / "not connected" bar with its word on a black label. */
class StripesView(context: Context, private val word: String) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), context.dp(34))

    override fun onDraw(canvas: Canvas) {
        val p = Look.p
        paint.style = Paint.Style.FILL
        paint.color = p.card
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.color = p.ink
        paint.strokeWidth = context.dp(6).toFloat()
        var x = -height.toFloat()
        while (x < width + height) {
            canvas.drawLine(x, height.toFloat(), x + height, 0f, paint)
            x += context.dp(14)
        }
        paint.textSize = context.dp(11).toFloat()
        paint.typeface = Look.sans(context, 900)
        paint.letterSpacing = 0.08f
        val tw = paint.measureText(word.uppercase())
        val pad = context.dp(10)
        paint.color = p.ink
        canvas.drawRect(width / 2f - tw / 2 - pad, height / 2f - context.dp(10), width / 2f + tw / 2 + pad, height / 2f + context.dp(10), paint)
        paint.color = p.card
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText(word.uppercase(), width / 2f, height / 2f + context.dp(4), paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = context.dp(2).toFloat()
        paint.color = p.ink
        canvas.drawRect(context.dp(1).toFloat(), context.dp(1).toFloat(), width - context.dp(1).toFloat(), height - context.dp(1).toFloat(), paint)
    }
}

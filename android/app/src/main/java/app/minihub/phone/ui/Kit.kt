package app.minihub.phone.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** The dashboard's dark tokens (docs/07 > Tokens), for the phone's screens built in code. */
object Tone {
    const val BG = "#0e0f11"
    const val SURFACE = "#16181b"
    const val SURFACE2 = "#1d2024"
    const val LINE = "#2a2e33"
    const val INK = "#eceef0"
    const val INK2 = "#a3aab2"
    const val INK3 = "#737a82"
    const val ACCENT = "#d77757"
    const val OK = "#3fb37f"
    const val WARN = "#d9a441"
    const val DANGER = "#e5534b"
}

/** Small pieces every screen uses: text, buttons, cards, rows and gaps. */
class Kit(private val c: Context) {
    private val density = c.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    fun rounded(color: String, radiusDp: Int, stroke: String? = null) = GradientDrawable().apply {
        setColor(Color.parseColor(color))
        cornerRadius = radiusDp * density
        stroke?.let { setStroke(dp(1), Color.parseColor(it)) }
    }

    fun text(s: String, sp: Float = 15f, bold: Boolean = false, color: String = Tone.INK, lines: Int = 0) = TextView(c).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(Color.parseColor(color))
        if (bold) paint.isFakeBoldText = true
        if (lines > 0) {
            maxLines = lines
            ellipsize = TextUtils.TruncateAt.END
        }
    }

    fun muted(s: String, sp: Float = 13f) = text(s, sp, color = Tone.INK2)

    fun button(label: String, primary: Boolean = false, danger: Boolean = false, small: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) =
        Button(c).apply {
            text = label
            isAllCaps = false
            isEnabled = enabled
            alpha = if (enabled) 1f else 0.5f
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (small) 13f else 15f)
            setTextColor(Color.parseColor(if (primary) "#000000" else if (danger) Tone.DANGER else Tone.INK))
            background = rounded(if (primary) Tone.ACCENT else Tone.SURFACE2, 10)
            setPadding(dp(14), 0, dp(14), 0)
            minHeight = dp(if (small) 36 else 46)
            minimumHeight = dp(if (small) 36 else 46)
            stateListAnimator = null
            setOnClickListener { onClick() }
        }

    fun column(padding: Int = 0) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        if (padding > 0) setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
    }

    fun row() = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    /** A card with a title, like a tile on the dashboard. */
    fun card(title: String? = null): LinearLayout = column(14).apply {
        background = rounded(Tone.SURFACE, 14)
        if (title != null) addView(text(title, 16f, bold = true), gap(0))
    }

    fun gap(top: Int) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    fun wrap(top: Int = 0, end: Int = 0) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(top)
        marginEnd = dp(end)
    }

    fun fill() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

    fun divider() = View(c).apply { setBackgroundColor(Color.parseColor(Tone.LINE)) }

    /** Three choices, one selected: Off, Ask, On. The selected Off is grey, not the accent, so it never reads as on. */
    fun segmented(label: String, value: String, enabled: Boolean = true, onChange: (String) -> Unit): LinearLayout = row().apply {
        contentDescription = label
        background = rounded(Tone.BG, 9, Tone.LINE)
        setPadding(dp(2), dp(2), dp(2), dp(2))
        for (v in listOf("off", "ask", "on")) {
            val selected = v == value
            addView(TextView(c).apply {
                text = v.replaceFirstChar { it.uppercase() }
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setTextColor(Color.parseColor(if (selected) (if (v == "off") Tone.INK else "#000000") else Tone.INK3))
                background = if (selected) rounded(if (v == "off") Tone.SURFACE2 else Tone.ACCENT, 7) else null
                setPadding(dp(10), dp(6), dp(10), dp(6))
                contentDescription = "$label: ${text}"
                isSelected = selected
                isEnabled = enabled
                setOnClickListener { if (!selected) onChange(v) }
            }, LinearLayout.LayoutParams(dp(44), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
    }
}

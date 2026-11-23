package app.minihub.phone.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import app.minihub.phone.ui.look.ButtonKind
import app.minihub.phone.ui.look.ChoiceView
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.Tokens
import app.minihub.phone.ui.look.WindowCard
import app.minihub.phone.ui.look.box
import app.minihub.phone.ui.look.lookButton
import app.minihub.phone.ui.look.lookText

/** The look's colours as text, for the screens built in code (they come from the palette chosen in Look). */
object Tone {
    private fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and c)
    val BG get() = hex(Look.p.ground)
    val SURFACE get() = hex(Look.p.card)
    val SURFACE2 get() = hex(Look.p.cardBar)
    val LINE get() = hex(Look.p.soft)
    val INK get() = hex(Look.p.ink)
    val INK2 get() = hex(Look.p.ink2)
    val INK3 get() = hex(Look.p.ink3)
    val ACCENT get() = hex(Look.p.accent)
    val OK get() = hex(Look.p.ok)
    val WARN get() = hex(Look.p.warn)
    val DANGER get() = hex(Look.p.danger)
}

/** Small pieces every screen uses, drawn with the Claude look's parts (ui/look). */
class Kit(private val c: Context) {
    private val density = c.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    fun rounded(color: String, radiusDp: Int, stroke: String? = null): GradientDrawable =
        box(c, Color.parseColor(color), stroke?.let { Color.parseColor(it) } ?: Look.p.ink, if (stroke != null) 2 else 0, radiusDp = if (radiusDp >= 99) 99 else 0)

    fun text(s: String, sp: Float = 15f, bold: Boolean = false, color: String = Tone.INK, lines: Int = 0, mono: Boolean = false): TextView =
        lookText(c, s, sp, if (bold) 800 else 500, Color.parseColor(color), mono = mono, lines = lines)

    /** A heading or label: heavy, uppercase, spaced. */
    fun label(s: String, sp: Float = 12f, color: String = Tone.INK2): TextView = lookText(c, s, sp, 800, Color.parseColor(color), upper = true)

    fun muted(s: String, sp: Float = 13f) = text(s, sp, color = Tone.INK2)

    fun button(label: String, primary: Boolean = false, danger: Boolean = false, small: Boolean = false, enabled: Boolean = true, onClick: () -> Unit): TextView =
        lookButton(c, label, if (primary) ButtonKind.Primary else if (danger) ButtonKind.Danger else ButtonKind.Secondary, small, enabled, onClick)

    fun column(padding: Int = 0) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        if (padding > 0) setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
    }

    fun row() = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    /** A card drawn as a window, with its title bar when titled; views added to it go into its body. */
    fun card(title: String? = null, tag: View? = null): LinearLayout = WindowCard(c, title, tag)

    fun gap(top: Int) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    fun wrap(top: Int = 0, end: Int = 0) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        topMargin = dp(top)
        marginEnd = dp(end)
    }

    fun fill() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

    fun divider() = View(c).apply { setBackgroundColor(Look.p.soft) }

    /** Off · Ask · On: the look's pill choice; the chosen "off" is grey, never orange. */
    fun segmented(label: String, value: String, enabled: Boolean = true, onChange: (String) -> Unit): LinearLayout =
        ChoiceView(c, label, listOf("off" to "Off", "ask" to "Ask", "on" to "On"), value) { v -> if (enabled) onChange(v) }

    val bodySp get() = Tokens.BODY_SP
}

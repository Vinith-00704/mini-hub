package app.minihub.phone.ui.look

import android.content.Context
import android.content.res.Configuration
import android.graphics.Typeface
import android.provider.Settings

/** Which look the owner chose for the phone app: Dark (default), Light, or follow the phone's own setting. */
enum class LookChoice(val wire: String, val label: String) {
    Dark("dark", "Dark"), Light("light", "Light"), Phone("phone", "Follow the phone");

    companion object {
        fun parse(s: String?): LookChoice = entries.firstOrNull { it.wire == s } ?: Dark
    }
}

/** The current palette and fonts for the phone app (docs/superpowers/specs/2026-11-22-claude-look-design.md). */
object Look {
    @Volatile var p: Palette = Tokens.DARK
        private set

    fun choice(context: Context): LookChoice =
        LookChoice.parse(context.getSharedPreferences("look", Context.MODE_PRIVATE).getString("look", null))

    fun choose(context: Context, c: LookChoice) {
        context.getSharedPreferences("look", Context.MODE_PRIVATE).edit().putString("look", c.wire).apply()
        apply(context)
    }

    /** Sets [p] from the owner's choice; call before building views. */
    fun apply(context: Context): Palette {
        val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        p = when (choice(context)) {
            LookChoice.Dark -> Tokens.DARK
            LookChoice.Light -> Tokens.LIGHT
            LookChoice.Phone -> if (night) Tokens.DARK else Tokens.LIGHT
        }
        return p
    }

    /** Animations off when the phone's "remove animations" is on. */
    fun stillness(context: Context): Boolean =
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

    private val cache = HashMap<String, Typeface>()

    /** Archivo at a weight (400–900), from the bundled variable font. */
    fun sans(context: Context, weight: Int = 500): Typeface = font(context, "fonts/archivo.ttf", weight)

    /** JetBrains Mono at a weight, for commands, codes, times and numbers that line up. */
    fun mono(context: Context, weight: Int = 500): Typeface = font(context, "fonts/jetbrains_mono.ttf", weight)

    @Synchronized
    private fun font(context: Context, file: String, weight: Int): Typeface = cache.getOrPut("$file@$weight") {
        runCatching {
            Typeface.Builder(context.assets, file).setFontVariationSettings("'wght' $weight").setWeight(weight).build()
        }.getOrElse { Typeface.create(Typeface.DEFAULT, weight, false) }
    }
}

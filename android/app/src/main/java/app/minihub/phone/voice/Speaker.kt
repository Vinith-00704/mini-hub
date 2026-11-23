package app.minihub.phone.voice

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice as TtsVoice
import app.minihub.phone.consent.Prefs
import java.util.Locale

/**
 * Speech out (docs/08 > Voice): Android's text to speech, with the owner's choice of when, which voice and how fast,
 * kept in [prefs] (SharedPrefs "voice"). Only voices that need no network are offered or used: with none, nothing is
 * spoken and replies stay as text. The voice and the speed are read at each [say], so a change applies to the next
 * reply. Call from the main thread.
 */
class Speaker(
    context: Context,
    private val prefs: Prefs,
    /** Text to speech has started (or could not): [status] says which. Always called later, never during the constructor. */
    private val onReady: (() -> Unit)? = null,
) {
    private var tts: TextToSpeech? = null

    /** [STARTING] until text to speech answers, then [READY], or [NONE] when the phone has none. */
    var status = STARTING
        private set

    init {
        val main = Handler(Looper.getMainLooper())
        tts = TextToSpeech(context.applicationContext) { s ->
            if (status == STARTING) status = if (s == TextToSpeech.SUCCESS) READY else NONE
            // Android answers at once, inside this constructor, when it has no engine: the caller hears later.
            onReady?.let { main.post(it) }
        }
    }

    /** "spoken" (the default: when the prompt was spoken), "always" or "never". */
    var speak: String
        get() = prefs.get(SPEAK).takeIf { it in SPEAK_CHOICES } ?: SPOKEN
        set(value) = prefs.put(SPEAK, value.takeIf { it in SPEAK_CHOICES && it != SPOKEN })

    /** A voice name from [voices]; null is the phone's default voice. */
    var voice: String?
        get() = prefs.get(VOICE)
        set(value) = prefs.put(VOICE, value)

    /** 0.8, 1.0 (the default), 1.2 or 1.5. */
    var rate: Float
        get() = prefs.get(RATE)?.toFloatOrNull()?.takeIf { it in RATES } ?: 1.0f
        set(value) = prefs.put(RATE, if (value in RATES && value != 1.0f) value.toString() else null)

    /** The installed voices for the phone's language that need no network, by name. */
    fun voices(): List<String> = offline().map { it.name }.sorted()

    /** Text to speech is ready and has a voice for the phone's language that works without the network. */
    val canSpeak: Boolean
        get() = status == READY && offline().isNotEmpty()

    /** Says [text] as a reply: without its formatting, links and code, at most 600 characters. */
    fun say(text: String) {
        val t = tts ?: return
        if (status != READY) return
        val words = forSpeech(text)
        if (words.isEmpty()) return
        val voices = offline()
        // No voice works without the network: nothing is spoken, so the reply never goes to an online engine.
        if (voices.isEmpty()) return
        val chosen = voice?.let { name -> voices.firstOrNull { it.name == name } }
        runCatching {
            if (chosen != null) {
                t.voice = chosen
            } else {
                t.language = Locale.getDefault()
                // The phone's default for the language, unless it needs the network (or is unknown): then the first
                // that does not.
                val now = t.voice
                if (now == null || now.isNetworkConnectionRequired || voices.none { it.name == now.name }) t.voice = voices.first()
            }
            if (t.voice?.isNetworkConnectionRequired != false) return
            t.setSpeechRate(rate)
            t.speak(words, TextToSpeech.QUEUE_FLUSH, null, "mini-reply")
        }
    }

    /** Stops speaking now. */
    fun quiet() {
        runCatching { tts?.stop() }
    }

    fun close() {
        quiet()
        runCatching { tts?.shutdown() }
        tts = null
        status = NONE
    }

    private fun offline(): List<TtsVoice> {
        val t = tts ?: return emptyList()
        if (status != READY) return emptyList()
        val language = Locale.getDefault().language
        return runCatching { t.voices.orEmpty() }.getOrDefault(emptySet()).filter { v ->
            !v.isNetworkConnectionRequired &&
                v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true &&
                v.locale.language == language
        }
    }

    companion object {
        const val SPOKEN = "spoken"
        const val ALWAYS = "always"
        const val NEVER = "never"
        const val STARTING = "starting"
        const val READY = "ready"
        const val NONE = "none"
        val RATES = listOf(0.8f, 1.0f, 1.2f, 1.5f)
        private val SPEAK_CHOICES = setOf(SPOKEN, ALWAYS, NEVER)
        private const val SPEAK = "speak"
        private const val VOICE = "voice"
        private const val RATE = "rate"
        private const val MAX_SPOKEN = 600

        private val CODE_BLOCK = Regex("(?s)(```|~~~).*?(?:\\1|\\z)")
        private val LINK = Regex("!?\\[([^\\]]*)]\\([^)]*\\)")
        private val MARKS = Regex("[*_#`>]")
        private val SPACE = Regex("\\s+")

        /**
         * What is said for a reply: code blocks left out, `[words](link)` as "words", the marks `*`, `_`, `#`, backticks
         * and `>` dropped, cut to 600 characters at the last sentence end within them.
         */
        fun forSpeech(text: String): String {
            val plain = text
                .replace(CODE_BLOCK, " ")
                .replace(LINK, "\$1")
                .replace(MARKS, "")
                .replace(SPACE, " ")
                .trim()
            if (plain.length <= MAX_SPOKEN) return plain
            val head = plain.substring(0, MAX_SPOKEN)
            for (i in head.indices.reversed()) {
                val end = head[i] == '.' || head[i] == '!' || head[i] == '?'
                if (end && (i + 1 >= plain.length || plain[i + 1].isWhitespace())) return head.substring(0, i + 1)
            }
            // No sentence ends in the first 600 characters: cut at the last word.
            return head.substringBeforeLast(' ', head).trim()
        }
    }
}

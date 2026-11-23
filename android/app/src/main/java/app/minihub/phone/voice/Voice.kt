package app.minihub.phone.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * Speech in, on the phone (docs/08 > Voice). Only Android's on-device recognizer is used, so the voice does not leave
 * the phone; a phone without one, or without a model for its language, gets typing only, said plainly. Listening is
 * started only by the Talk sheet ([TalkActivity]), while it is on screen. Call from the main thread.
 */
class Voice(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null

    /** The phone has an on-device recognizer at all (it may still lack a model for the language). */
    val canListen: Boolean
        get() = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    /** The installed model [support] found for the phone's language, to listen with; null until it found one. */
    var language: Locale? = null
        private set

    /** The last [support] could not ask the recognizer (it did not say): neither yes nor no is known. */
    var checkFailed = false
        private set

    /** The model [support] found that Android can download for the phone's language. */
    private var downloadTag: String? = null

    /** The phone's language, in its own words ("English"), for what the screens say. */
    val languageName: String
        get() = Locale.getDefault().getDisplayLanguage(Locale.getDefault()).ifEmpty { Locale.getDefault().toLanguageTag() }

    /**
     * Asks the on-device recognizer whether it has a model for the phone's language ([installed]), or can download one
     * ([downloadable]). Called back on the main thread. A phone with no on-device recognizer gets (false, false).
     */
    fun support(onResult: (installed: Boolean, downloadable: Boolean) -> Unit) {
        checkFailed = false
        if (!canListen) return onResult(false, false)
        val r = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }.getOrNull()
            ?: return onResult(false, false)
        val wanted = Locale.getDefault()
        var answered = false
        val deadline = Runnable {
            if (answered) return@Runnable
            answered = true
            checkFailed = true
            runCatching { r.destroy() }
            onResult(false, false)
        }
        fun answer(installed: Boolean, downloadable: Boolean) {
            if (answered) return
            answered = true
            main.removeCallbacks(deadline)
            runCatching { r.destroy() }
            onResult(installed, downloadable)
        }
        // A recognizer that never answers is treated as one that could not say.
        main.postDelayed(deadline, SUPPORT_WAIT_MS)
        try {
            r.checkRecognitionSupport(
                intent(wanted),
                context.mainExecutor,
                object : RecognitionSupportCallback {
                    override fun onSupportResult(s: RecognitionSupport) {
                        val installed = best(s.installedOnDeviceLanguages, wanted)
                        val offered = best(s.pendingOnDeviceLanguages + s.supportedOnDeviceLanguages, wanted)
                        language = installed?.let(Locale::forLanguageTag)
                        downloadTag = if (installed == null) offered else null
                        answer(installed != null, installed == null && offered != null)
                    }

                    override fun onError(error: Int) {
                        checkFailed = true
                        answer(false, false)
                    }
                },
            )
        } catch (e: RuntimeException) {
            checkFailed = true
            answer(false, false)
        }
    }

    /**
     * Asks Android to download the model for the phone's language (the owner tapped Download). Android shows its own
     * question or progress; nothing here grants or downloads anything by itself.
     */
    fun download() {
        val tag = downloadTag ?: Locale.getDefault().toLanguageTag()
        val r = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }.getOrNull() ?: return
        runCatching { r.triggerModelDownload(intent(Locale.forLanguageTag(tag))) }
        // The request goes to the recognizer service over its connection; let it get there before letting go.
        main.postDelayed({ runCatching { r.destroy() } }, DOWNLOAD_HOLD_MS)
    }

    /**
     * Listens once for [locale]: [onReady] when the microphone is open, [onPartial] with the words as they are heard,
     * then [onText] with what was said or [onError] with a line to show. The microphone closes with either.
     */
    fun listen(
        locale: Locale,
        onReady: () -> Unit,
        onPartial: (String) -> Unit,
        onText: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        if (!canListen) return onError(noModel())
        stopListening()
        val r = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(context) }.getOrNull()
            ?: return onError(noModel())
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            // A recognizer that was stopped says nothing more.
            private fun live() = recognizer === r

            override fun onReadyForSpeech(params: Bundle?) {
                if (live()) onReady()
            }

            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                if (!live()) return
                val words = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                if (words.isNotEmpty()) onPartial(words)
            }

            override fun onError(error: Int) {
                if (!live()) return
                stopListening()
                onError(
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> NOT_CAUGHT
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> NO_MIC
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> noModel()
                        else -> "Listening did not work (code $error)."
                    },
                )
            }

            override fun onResults(results: Bundle?) {
                if (!live()) return
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                stopListening()
                if (text.isEmpty()) onError(NOT_CAUGHT) else onText(text)
            }
        })
        try {
            r.startListening(intent(locale).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true))
        } catch (e: RuntimeException) {
            stopListening()
            onError("Listening did not work.")
        }
    }

    /** The microphone closes now. */
    fun stopListening() {
        val r = recognizer ?: return
        recognizer = null
        runCatching {
            r.cancel()
            r.destroy()
        }
    }

    fun close() = stopListening()

    /** "This phone has no on-device speech model for English, so Mini takes typing only." */
    fun noModel() = "This phone has no on-device speech model for $languageName, so Mini takes typing only."

    private fun intent(locale: Locale) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale.toLanguageTag())
        .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)

    /** The tag in [tags] for [wanted]: the same tag, or else the same language ("en-US" for a phone in "en-GB"). */
    private fun best(tags: List<String>, wanted: Locale): String? =
        tags.firstOrNull { it.equals(wanted.toLanguageTag(), ignoreCase = true) }
            ?: tags.firstOrNull { Locale.forLanguageTag(it).language == wanted.language }

    companion object {
        const val NOT_CAUGHT = "I did not catch that. Tap Talk and try again."
        const val NO_MIC = "Mini needs the microphone to hear you. You can type instead."
        private const val DOWNLOAD_HOLD_MS = 60_000L
        private const val SUPPORT_WAIT_MS = 5_000L
    }
}

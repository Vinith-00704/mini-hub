package app.minihub.phone.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Speech in and out, on the phone. Listening uses Android's on-device recognizer, so the voice does not leave the
 * phone; a phone without one gets typing only, said plainly. The microphone is open only between the tap and the
 * end of speech. Call from the main thread.
 */
class Voice(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    val canListen: Boolean
        get() = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    init {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.getDefault()
        }
    }

    fun listen(onListening: (Boolean) -> Unit, onText: (String) -> Unit, onError: (String) -> Unit) {
        if (!canListen) return onError("This phone has no on-device speech recognizer, so Mini takes typing only.")
        stopListening()
        tts?.stop()
        val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = onListening(true)
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() = onListening(false)
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onError(error: Int) {
                onListening(false)
                stopListening()
                onError(
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I did not catch that. Tap the microphone and try again."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mini needs the microphone permission. Open the Mini app to allow it."
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                            "The on-device speech model for your language is not installed."
                        else -> "Listening did not work (code $error)."
                    },
                )
            }

            override fun onResults(results: Bundle?) {
                onListening(false)
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                stopListening()
                if (text.isEmpty()) onError("I did not catch that. Tap the microphone and try again.") else onText(text)
            }
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true),
        )
    }

    fun stopListening() {
        recognizer?.run {
            cancel()
            destroy()
        }
        recognizer = null
    }

    fun say(text: String) {
        if (!ttsReady) return
        tts?.speak(text.take(MAX_SPOKEN), TextToSpeech.QUEUE_FLUSH, null, "mini-reply")
    }

    fun quiet() {
        tts?.stop()
    }

    fun close() {
        stopListening()
        tts?.shutdown()
        tts = null
    }

    private companion object {
        const val MAX_SPOKEN = 600
    }
}

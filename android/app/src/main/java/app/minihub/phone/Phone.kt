package app.minihub.phone

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import app.minihub.phone.brain.BrainKeeper
import app.minihub.phone.brain.BrainSetup
import app.minihub.phone.brain.BrainState
import app.minihub.phone.collect.Collectors
import app.minihub.phone.collect.DeviceStateCollector
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.MiniGate
import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.consent.SharedPrefs
import app.minihub.phone.consent.Switches
import app.minihub.phone.data.Record
import app.minihub.phone.data.RecordDb
import app.minihub.phone.hands.HandsServer
import app.minihub.phone.hands.PhoneTools
import app.minihub.phone.link.Commands
import app.minihub.phone.link.Frame
import app.minihub.phone.link.HubLink
import app.minihub.phone.link.HubStore
import app.minihub.phone.link.Runner
import app.minihub.phone.link.ThisPhone
import java.util.Calendar
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject

/**
 * Everything the phone app holds, made once: the switches, the encrypted record and the phone's log, the phone's
 * state, and the link to the hub. The screens and the service read from here.
 */
class Phone private constructor(context: Context) {
    private val app = context.applicationContext
    private val prefs = SharedPrefs(app, "phone")
    val switches = Switches(SharedPrefs(app, "switches"))
    private val db = RecordDb(app)
    val record = Record(db, switches)
    val audit = Audit(db)
    val hubs = HubStore(app)
    val appVersion: String = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "0"
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    /** What must end when Mini is stopped: the hands' open tickets. */
    private val stopHooks = CopyOnWriteArrayList<() -> Unit>()
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /** Mini's brain as the hub sees it: "ok" while Mini's session answers, "broken" while Claude Code needs repair, "asleep" otherwise. */
    @Volatile var brain: String = "asleep"
        set(value) {
            field = value
            link.sendState()
        }

    /** The brain keeper's state (set by the service's keeper only), for the screens; the hub's [brain] follows it. */
    @Volatile var brainState: BrainState = BrainState.Off
        set(value) {
            field = value
            val word = when (value) {
                BrainState.Ready -> "ok"
                is BrainState.Broken -> "broken"
                else -> "asleep"
            }
            if (brain != word) brain = word
            told()
        }

    /** The brain's setup for the Brain screen: the last Check Termux and Update Mini Bot (docs/08 > Setting it up, once). */
    val setup = BrainSetup(app, SharedPrefs(app, "brain")) { told() }

    /** The service's brain keeper while the service is up (set by the service only), for the Brain screen's mode and details. */
    @Volatile var keeper: BrainKeeper? = null

    /**
     * Stopped on this phone, or from the PC, until the owner starts Mini again here (docs/03 > The stop button).
     * Setting it is a stop on the phone; only [stopFromPc] makes it the PC's. Starting Mini clears who stopped it.
     */
    var stopped: Boolean
        get() = prefs.get("stopped") == "1"
        set(value) = setStopped(value, "phone")

    /** Who stopped Mini: "pc" or "phone", null while it is not stopped. */
    val stoppedBy: String?
        get() = if (stopped) prefs.get("stoppedBy") ?: "phone" else null

    /** The hub's Stop reached this phone. */
    fun stopFromPc() = setStopped(true, "pc")

    private fun setStopped(value: Boolean, by: String) {
        prefs.put("stopped", if (value) "1" else null)
        prefs.put("stoppedBy", if (value) by else null)
        if (value) endForStop()
        link.sendState()
        told()
    }

    // The phone's own state shows on its Home whether or not a PC is linked; the PC gets it only while linked.
    val deviceState = DeviceStateCollector(app, record) {
        link.sendState()
        told()
    }

    private val commands by lazy {
        Commands(
            switches = switches,
            audit = audit,
            askOwner = { question, until, answer -> Approvals.ask(app, "Your PC", question, until, answer) },
            now = System::currentTimeMillis,
            runners = mapOf(
                "status" to Runner("phone.usage.read", "read", "check this phone's battery and network") {
                    val r = deviceState.current
                    JSONObject().apply {
                        r?.battery?.let { put("battery", it) }
                        put("charging", r?.charging ?: false)
                        put("network", r?.network ?: deviceState.networkKind())
                    }.toString()
                },
            ),
            stopped = { stopped },
            // Mini's open tickets end as "stopped" before their questions are answered no.
            clearQuestions = { endForStop(); Approvals.noAll(app) },
        )
    }

    /** The record's collectors: each source runs only while its switch is on and Android allows it. */
    val collectors = Collectors(app, record, switches, SharedPrefs(app, "collect"))

    init {
        // The questions waiting for the owner show on Home: it is told when one comes or goes.
        Approvals.onChange { told() }
        // A collect switch turned on while the service is down starts it: the service is what keeps recording.
        collectors.onChange {
            // What is missing changed: the hub's need lines follow the phone (only while linked).
            link.sendState()
            if (collectors.anyOn() && !MiniService.alive) {
                runCatching { MiniService.startLink(app) }.onFailure { Log.w("MiniPhone", "record: ${it.javaClass.simpleName}") }
            }
        }
    }

    val link: HubLink = HubLink(app, hubs, record, switches, audit, prefs, { commands }, ::stateFrame, appVersion)

    /** The judge of every tool call Mini's session makes on this phone. */
    val gate = MiniGate(switches, audit, record, { stopped })

    /** Mini's tools on this phone: phone_status and phone_read. */
    val tools = PhoneTools(this)

    /** The hands endpoint Mini's session calls (made once; the service's brain keeper starts and stops it with the brain). */
    val hands = HandsServer(
        tools = tools,
        gate = gate,
        askOwner = { question, until, answer ->
            // Both run on the main thread, in order: a take-down always finds the question it takes down, if it is up.
            var id = 0
            var gone = false
            main.post { if (!gone) id = Approvals.ask(app, "Mini", question, until, answer) }
            val takeDown: () -> Unit = {
                main.post {
                    gone = true
                    if (id != 0) Approvals.answer(id, false, app)
                }
            }
            takeDown
        },
        audit = audit,
        onStop = { fn -> stopHooks.add(fn) },
    )

    private fun endForStop() = stopHooks.forEach { runCatching { it() }.onFailure { e -> Log.w("MiniPhone", "stop: ${e.javaClass.simpleName}") } }

    val thisPhone: ThisPhone
        get() = ThisPhone(
            name = Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME) ?: Build.MODEL,
            model = "${Build.MANUFACTURER} ${Build.MODEL}",
            appVersion = appVersion,
        )

    private fun stateFrame(): Frame.State {
        val usage = switches.collect("phone.usage.read")
        val r = deviceState.current
        val (mini, pc) = switches.lists()
        return Frame.State(
            // Battery, charging and network go to the hub only while "Battery and app use" is collected.
            battery = if (usage) r?.battery else null,
            charging = if (usage) r?.charging else null,
            network = if (usage) r?.network else null,
            brain = brain,
            controlling = false,
            stopped = stopped,
            // The phone's own collect switches: the hub's copy follows them (docs/04 > Whose switches win).
            collect = PhoneScopes.ALL.filter { it.collectable }.associate { it.id to switches.collect(it.id) },
            mini = mini,
            pc = pc,
            // What is still missing for each collect switch that is on, so the PC can say so.
            needs = collectors.needs(),
        )
    }

    /** Counts of what was recorded since midnight, by kind. */
    fun today(): Map<String, Int> {
        val midnight = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
        return record.countsSince(midnight)
    }

    /** Starts what runs while the app is linked: the phone's state and the link. Safe to call again. */
    fun startLink() {
        deviceState.start()
        link.start()
    }

    /** Starts the record's collectors (each runs only while allowed). Safe to call again. */
    fun startRecording() = collectors.start()

    fun onChange(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    private fun told() = listeners.forEach { it() }

    companion object {
        @Volatile private var one: Phone? = null

        fun get(context: Context): Phone = one ?: synchronized(this) { one ?: Phone(context).also { one = it } }
    }
}

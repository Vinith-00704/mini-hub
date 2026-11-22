package app.minihub.phone

import android.content.Context
import android.os.Build
import android.provider.Settings
import app.minihub.phone.collect.DeviceStateCollector
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.Audit
import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.consent.SharedPrefs
import app.minihub.phone.consent.Switches
import app.minihub.phone.data.Record
import app.minihub.phone.data.RecordDb
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

    /** Mini's brain as the hub sees it: "ok" while Mini's session answers, "asleep" otherwise. */
    @Volatile var brain: String = "asleep"
        set(value) {
            field = value
            link.sendState()
        }

    /** Stopped on this phone, or from the PC, until the owner starts Mini again here (docs/03 > The stop button). */
    var stopped: Boolean
        get() = prefs.get("stopped") == "1"
        set(value) {
            prefs.put("stopped", if (value) "1" else null)
            link.sendState()
            told()
        }

    val deviceState = DeviceStateCollector(app, record) { link.sendState() }

    private val commands by lazy {
        Commands(
            switches = switches,
            audit = audit,
            askOwner = { question, until, answer -> Approvals.ask(app, question, until, answer) },
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
            clearQuestions = { Approvals.noAll(app) },
        )
    }

    val link: HubLink = HubLink(app, hubs, record, switches, audit, { commands }, ::stateFrame, appVersion)

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

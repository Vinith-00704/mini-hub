package app.minihub.phone

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.TextView
import app.minihub.phone.link.PairingInfo
import app.minihub.phone.link.PairingLink
import app.minihub.phone.link.Pairer
import app.minihub.phone.ui.ActivityScreen
import app.minihub.phone.ui.BrainScreen
import app.minihub.phone.ui.HomeScreen
import app.minihub.phone.ui.HubScreen
import app.minihub.phone.ui.Kit
import app.minihub.phone.ui.PermissionsScreen
import app.minihub.phone.ui.RecordScreen
import app.minihub.phone.ui.Screen
import app.minihub.phone.ui.Tone
import com.google.zxing.integration.android.IntentIntegrator

/**
 * The phone app (docs/08 > The app's own screens): Home, Activity, Record and Permissions at the bottom; Your PC (the
 * hub) and Mini's brain under the menu. Every permission is the owner's own tap; the app only opens the right screen.
 */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var phone: Phone
    private lateinit var k: Kit
    private lateinit var content: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var nav: LinearLayout
    private var current = "home"
    private val screens = HashMap<String, Screen>()
    private val unlisten = ArrayList<() -> Unit>()

    /** A pairing under way: its words once shown, or what went wrong. */
    class Pairing(val pairer: Pairer) {
        var words: List<String>? = null
        var error: String? = null
    }

    var pairing: Pairing? = null
        private set

    private val tabs = listOf("home" to "Home", "activity" to "Activity", "record" to "Record", "permissions" to "Permissions")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        phone = Phone.get(this)
        k = Kit(this)
        current = savedInstanceState?.getString("screen") ?: "home"

        val root = k.column().apply { setBackgroundColor(Color.parseColor(Tone.BG)) }
        val bar = k.row().apply { setPadding(k.dp(20), k.dp(14), k.dp(8), k.dp(10)) }
        titleView = k.text("Mini", 24f, bold = true)
        bar.addView(titleView, k.fill())
        val menu = k.text("⋮", 24f, color = Tone.INK2).apply {
            setPadding(k.dp(16), k.dp(4), k.dp(16), k.dp(4))
            contentDescription = "More"
            setOnClickListener { v ->
                PopupMenu(this@MainActivity, v).apply {
                    menu.add(0, 1, 0, "Your PC")
                    menu.add(0, 2, 1, "Mini's brain")
                    setOnMenuItemClickListener { item -> open(if (item.itemId == 1) "hub" else "brain"); true }
                }.show()
            }
        }
        bar.addView(menu)
        root.addView(bar)

        content = k.column().apply { setPadding(k.dp(16), k.dp(4), k.dp(16), k.dp(24)) }
        root.addView(ScrollView(this).apply { addView(content); isFillViewport = true }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        nav = k.row().apply {
            setBackgroundColor(Color.parseColor(Tone.SURFACE))
            setPadding(0, k.dp(6), 0, k.dp(6))
        }
        root.addView(nav)

        // Keep the content clear of the status bar and the gesture bar.
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
            v.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }
        setContentView(root)

        // A paired phone keeps its link and record going (the bot is started only by the owner).
        if (phone.hubs.get() != null) MiniService.startLink(this)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("screen", current)
    }

    override fun onResume() {
        super.onResume()
        val again = { main.post { refresh() }; Unit }
        unlisten += phone.link.onChange(again)
        unlisten += phone.onChange(again)
        unlisten += phone.audit.onChange(again)
        refresh()
    }

    override fun onPause() {
        unlisten.forEach { it() }
        unlisten.clear()
        super.onPause()
    }

    fun open(screen: String) {
        current = screen
        refresh()
    }

    /** Builds the current screen again a moment later (after a service has had time to change). */
    fun later(ms: Long) {
        main.postDelayed({ refresh() }, ms)
    }

    fun refresh() {
        if (isFinishing) return
        val s = screens.getOrPut(current) {
            when (current) {
                "activity" -> ActivityScreen(this, phone)
                "record" -> RecordScreen(this, phone)
                "permissions" -> PermissionsScreen(this, phone)
                "hub" -> HubScreen(this, phone)
                "brain" -> BrainScreen(this, phone)
                else -> HomeScreen(this, phone)
            }
        }
        // The record screen keeps its search box while typing; it refreshes its own list.
        if (current == "record" && content.childCount > 0 && content.findFocus() != null) return
        titleView.text = s.title
        content.removeAllViews()
        s.build(content)
        drawNav()
    }

    private fun drawNav() {
        nav.removeAllViews()
        for ((id, label) in tabs) {
            val on = id == current
            nav.addView(TextView(this).apply {
                text = label
                gravity = Gravity.CENTER
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setTextColor(Color.parseColor(if (on) Tone.ACCENT else Tone.INK2))
                if (on) paint.isFakeBoldText = true
                setPadding(0, k.dp(10), 0, k.dp(10))
                contentDescription = label
                isSelected = on
                setOnClickListener { open(id) }
            }, k.fill())
        }
    }

    override fun onBackPressed() {
        if (current != "home") open("home") else super.onBackPressed()
    }

    // --- Pairing ---

    fun scan() {
        IntentIntegrator(this)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt("Scan the code on your PC: Mini Hub > Devices > Add device")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
            .initiateScan()
    }

    @Deprecated("Activity results")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val scanned = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (scanned == null) return super.onActivityResult(requestCode, resultCode, data)
        val text = scanned.contents ?: return
        runCatching { PairingLink.parse(text) }
            .onSuccess { pair(it) }
            .onFailure { failPairing(it.message ?: "That is not a Mini Hub pairing code.") }
    }

    fun pairTyped(address: String, code: String) {
        runCatching { PairingLink.typed(address, code) }
            .onSuccess { pair(it) }
            .onFailure { failPairing(it.message ?: "That address is not right.") }
    }

    private fun failPairing(message: String) {
        pairing = Pairing(Pairer(PairingInfo("", 0, null, "", null), phone.thisPhone, {}, {}, {}, {})).apply { error = message }
        open("hub")
    }

    private fun pair(info: PairingInfo) {
        pairing?.pairer?.cancel()
        lateinit var p: Pairing
        val pairer = Pairer(
            info,
            phone.thisPhone,
            save = { hub -> phone.hubs.save(hub) },
            onWords = { w -> if (pairing === p) { p.words = w; refresh() } },
            onDone = { name ->
                if (pairing === p) {
                    pairing = null
                    phone.audit.add("You", "pair with $name", outcome = "done")
                    phone.link.relink()
                    MiniService.startLink(this)
                    refresh()
                }
            },
            onError = { e -> if (pairing === p) { p.error = e; refresh() } },
        )
        p = Pairing(pairer)
        pairing = p
        open("hub")
        pairer.start()
    }

    fun endPairing() {
        pairing?.pairer?.cancel()
        pairing = null
        refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }
}

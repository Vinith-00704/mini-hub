package app.minihub.phone

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import app.minihub.phone.consent.SharedPrefs
import app.minihub.phone.ui.AppsScreen
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
import android.graphics.drawable.LayerDrawable
import android.view.View
import app.minihub.phone.ui.look.DotsDrawable
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.LookChoice
import app.minihub.phone.ui.look.PixelBotView
import app.minihub.phone.ui.look.box
import app.minihub.phone.ui.look.lookText
import app.minihub.phone.ui.look.shadowed

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

    companion object {
        const val OPEN_HOME = "openHome"
    }

    private val tabs = listOf("home" to "Home", "activity" to "Activity", "record" to "Record", "permissions" to "Perms")

    /** A question's notification comes here: Home, where the question waits at the top. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(OPEN_HOME, false)) open("home")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        phone = Phone.get(this)
        // Battery and network for this phone's own Home, linked or not.
        phone.deviceState.start()
        Look.apply(this)
        k = Kit(this)
        current = savedInstanceState?.getString("screen") ?: "home"

        val root = k.column().apply { background = DotsDrawable(this@MainActivity) }
        val bar = k.row().apply { setPadding(k.dp(16), k.dp(12), k.dp(12), k.dp(10)) }
        bar.addView(PixelBotView(this, "idle"), LinearLayout.LayoutParams(k.dp(26), k.dp(22)).apply { marginEnd = k.dp(8) })
        titleView = lookText(this, "Mini", 24f, 900, upper = true)
        bar.addView(titleView, k.fill())
        bar.addView(iconButton(if (Look.p.dark) "☀" else "☾", if (Look.p.dark) "Switch to light" else "Switch to dark") {
            Look.choose(this, if (Look.p.dark) LookChoice.Light else LookChoice.Dark)
            recreate()
        }, LinearLayout.LayoutParams(k.dp(38), k.dp(38)).apply { marginEnd = k.dp(8) })
        bar.addView(iconButton("⋮", "More") { v ->
            PopupMenu(this@MainActivity, v).apply {
                menu.add(0, 1, 0, "Your PC")
                menu.add(0, 2, 1, "Mini's brain")
                menu.add(0, 3, 2, "Look")
                setOnMenuItemClickListener { item ->
                    when (item.itemId) {
                        1 -> open("hub")
                        2 -> open("brain")
                        else -> chooseLook()
                    }
                    true
                }
            }.show()
        }, LinearLayout.LayoutParams(k.dp(38), k.dp(38)))
        root.addView(bar)

        content = k.column().apply { setPadding(k.dp(16), k.dp(4), k.dp(16), k.dp(24)) }
        root.addView(ScrollView(this).apply { addView(content); isFillViewport = true }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        nav = k.row().apply {
            background = LayerDrawable(arrayOf(box(this@MainActivity, Look.p.card, Look.p.ink, 2))).apply { setLayerInset(0, -k.dp(2), 0, -k.dp(2), -k.dp(2)) }
            setPadding(k.dp(10), k.dp(10), k.dp(10), k.dp(12))
        }
        root.addView(nav)

        // Keep the content clear of the status bar and the gesture bar.
        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
            v.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }
        setContentView(root)

        // A paired phone keeps its link going, and a collect switch that is on keeps the record going (the bot is
        // started only by the owner).
        if (phone.hubs.get() != null || phone.collectors.anyOn()) MiniService.startLink(this)
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
        unlisten += phone.collectors.onChange(again)
        // A permission granted or taken away in Android's settings shows when the owner comes back.
        forgetGranted()
        phone.collectors.refresh()
        refresh()
    }

    override fun onPause() {
        unlisten.forEach { it() }
        unlisten.clear()
        // Text shown in full for now (a one-time code) is hidden again when the owner leaves the app.
        screens[current]?.left()
        super.onPause()
    }

    fun open(screen: String) {
        if (screen != current) screens[current]?.left()
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
                "apps" -> AppsScreen(this, phone)
                "hub" -> HubScreen(this, phone)
                "brain" -> BrainScreen(this, phone)
                else -> HomeScreen(this, phone)
            }
        }
        // The record and apps screens keep their search box while typing; they refresh their own list.
        if ((current == "record" || current == "apps") && content.childCount > 0 && content.findFocus() != null) return
        titleView.text = s.title
        content.removeAllViews()
        s.build(content)
        drawNav()
    }

    private fun drawNav() {
        nav.removeAllViews()
        tabs.forEachIndexed { i, (id, label) ->
            val on = id == current
            nav.addView(lookText(this, label, 10.5f, 800, if (on) Look.p.onAccent else Look.p.ink, upper = true).apply {
                gravity = Gravity.CENTER
                background = if (on) shadowed(this@MainActivity, Look.p.accent, 2) else box(this@MainActivity, Look.p.card)
                setPadding(0, k.dp(9), if (on) k.dp(2) else 0, k.dp(if (on) 11 else 9))
                contentDescription = label
                isSelected = on
                setOnClickListener { open(id) }
            }, k.fill().apply { if (i > 0) marginStart = k.dp(6) })
        }
    }

    /** A square icon button with the hard shadow. */
    private fun iconButton(glyph: String, label: String, onClick: (View) -> Unit): TextView =
        lookText(this, glyph, 17f, 800).apply {
            gravity = Gravity.CENTER
            background = shadowed(this@MainActivity, Look.p.card, 2)
            setPadding(0, 0, k.dp(2), k.dp(2))
            contentDescription = label
            setOnClickListener { onClick(it) }
        }

    private fun chooseLook() {
        val choices = LookChoice.entries
        android.app.AlertDialog.Builder(this, if (Look.p.dark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
            .setTitle("Look")
            .setSingleChoiceItems(choices.map { it.label }.toTypedArray(), choices.indexOf(Look.choice(this))) { d, which ->
                d.dismiss()
                Look.choose(this, choices[which])
                recreate()
            }
            .show()
    }

    override fun onBackPressed() {
        if (current == "apps") open("permissions") else if (current != "home") open("home") else super.onBackPressed()
    }

    // --- The record's permissions: each only from a button the owner presses; nothing is granted by code ---

    private val asked by lazy { SharedPrefs(this, "asked") }
    private val askable = listOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_SMS, Manifest.permission.READ_CONTACTS)

    /** Asks Android for one permission (the owner pressed Allow). Android shows its own question. */
    fun askFor(permission: String) {
        asked.put("asked:$permission", "1")
        requestPermissions(arrayOf(permission), 10 + askable.indexOf(permission).coerceAtLeast(0))
    }

    /** Asked before, refused, and Android will not show its question again: only the app's settings can allow it now. */
    fun refusedForGood(permission: String): Boolean {
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            asked.put("asked:$permission", null)
            return false
        }
        return asked.get("asked:$permission") != null && !shouldShowRequestPermissionRationale(permission)
    }

    /**
     * A permission granted now was not refused: forgotten as asked, so if it is taken away later in Android's
     * settings, the screen offers the button again instead of saying Android will not ask.
     */
    private fun forgetGranted() {
        for (p in askable) if (checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) asked.put("asked:$p", null)
    }

    fun openAppSettings() = openSetting(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))

    /** Android's own notification access screen, on Mini's row when this Android has one. */
    fun openNotificationAccess() {
        val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, phone.collectors.notesComponent().flattenToString())
        try {
            startActivity(detail)
        } catch (e: RuntimeException) {
            openSetting(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    private fun openSetting(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: RuntimeException) {
            Toast.makeText(this, "Could not open Android's settings. Open them yourself and find Mini.", Toast.LENGTH_LONG).show()
        }
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
            // A new pairing is a new device on the hub, whose settings are numbered from the start again.
            save = { hub ->
                phone.hubs.save(hub)
                phone.switches.forgetHub()
            },
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
        forgetGranted()
        phone.collectors.refresh()
        refresh()
    }
}

package app.minihub.phone.ui

import android.Manifest
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.Toast
import app.minihub.phone.MainActivity
import app.minihub.phone.MiniService
import app.minihub.phone.Phone
import app.minihub.phone.brain.Termux
import app.minihub.phone.consent.Grant
import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.link.Frame
import app.minihub.phone.link.LinkStatus
import app.minihub.phone.overlay.SpriteView

/** A screen of the phone app (docs/08 > The app's own screens). Built in code, rebuilt when what it shows changes. */
abstract class Screen(protected val a: MainActivity, protected val phone: Phone) {
    protected val k = Kit(a)
    abstract val title: String
    abstract fun build(into: LinearLayout)

    protected fun field(hint: String, type: Int = InputType.TYPE_CLASS_TEXT) = EditText(a).apply {
        this.hint = hint
        inputType = type
        setHintTextColor(Color.parseColor(Tone.INK3))
        setTextColor(Color.parseColor(Tone.INK))
        background = k.rounded(Tone.SURFACE2, 10)
        setPadding(k.dp(12), k.dp(10), k.dp(12), k.dp(10))
    }

    protected fun hubLine(): String = Lines.hub(phone.link.status, phone.link.lastSync, phone.link.waiting(), System.currentTimeMillis())

    protected fun confirm(title: String, message: String, yes: String, action: () -> Unit) {
        AlertDialog.Builder(a, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(title).setMessage(message)
            .setPositiveButton(yes) { _, _ -> action() }
            .setNegativeButton("Cancel", null)
            .show()
    }
}

/** Home: the bot and its state, a box to ask Mini, today's counts, and the hub's state. */
class HomeScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Mini"

    override fun build(into: LinearLayout) {
        val bot = k.card()
        val top = k.row()
        top.addView(SpriteView(a).apply { state = if (MiniService.running && phone.brain == "ok") SpriteView.State.Idle else SpriteView.State.Asleep }, LinearLayout.LayoutParams(k.dp(56), k.dp(56)))
        val words = k.column()
        val (head, sub) = when {
            phone.stopped -> "Mini is stopped" to "Stopped here or from your PC. Start Mini to resume."
            MiniService.running && phone.brain == "ok" -> "Mini is on" to "Tap the bot to talk, or ask here."
            MiniService.running -> "Mini is starting" to "Mini's Claude Code is starting in Termux."
            else -> "Mini is off" to "Start Mini to talk to it."
        }
        words.addView(k.text(head, 17f, bold = true))
        words.addView(k.muted(sub), k.gap(2))
        top.addView(words, k.fill().apply { marginStart = k.dp(12) })
        bot.addView(top)
        val ready = Termux.isInstalled(a) && Termux.hasPermission(a) && Settings.canDrawOverlays(a)
        val buttons = k.row()
        if (MiniService.running) {
            buttons.addView(k.button("Show the bot", small = true) { MiniService.start(a) }, k.wrap(end = 8))
            buttons.addView(k.button("Stop Mini", danger = true, small = true) { MiniService.stop(a); a.later(400) }, k.wrap())
        } else {
            buttons.addView(k.button("Start Mini", primary = true, small = true, enabled = ready) { MiniService.start(a); a.later(400) }, k.wrap(end = 8))
            if (!ready) buttons.addView(k.button("Finish setup", small = true) { a.open("brain") }, k.wrap())
        }
        bot.addView(buttons, k.gap(12))
        if (MiniService.running && phone.brain == "ok") {
            val ask = field("Ask Mini").apply { imeOptions = EditorInfo.IME_ACTION_SEND; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES }
            val send = {
                val t = ask.text.toString().trim()
                if (t.isNotEmpty()) {
                    ask.setText("")
                    MiniService.ask(a, t)
                }
            }
            ask.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) send(); true }
            val askRow = k.row()
            askRow.addView(ask, k.fill())
            askRow.addView(k.button("Send", primary = true, small = true) { send() }, k.wrap().apply { marginStart = k.dp(8) })
            bot.addView(askRow, k.gap(12))
            bot.addView(k.muted("The reply shows in the bot's panel.", 12f), k.gap(6))
        }
        into.addView(bot, k.gap(0))

        val today = k.card("Today on this phone")
        val counts = k.row()
        for ((label, n) in Lines.today(phone.today())) {
            val cell = k.column()
            cell.addView(k.text(n.toString(), 24f, bold = true))
            cell.addView(k.muted(label, 12f))
            counts.addView(cell, k.fill())
        }
        today.addView(counts, k.gap(10))
        into.addView(today, k.gap(12))

        val hub = k.card("Your PC")
        val linked = phone.link.status == LinkStatus.Linked
        hub.addView(k.row().apply {
            addView(View(a).apply { background = k.rounded(if (linked) Tone.OK else Tone.INK3, 4) }, LinearLayout.LayoutParams(k.dp(8), k.dp(8)).apply { marginEnd = k.dp(8) })
            addView(k.text(hubLine(), 15f), k.fill())
        }, k.gap(8))
        val hubs = phone.hubs.get()
        if (hubs == null) hub.addView(k.button("Pair with your PC", primary = true, small = true) { a.open("hub") }, k.wrap(top = 10))
        else hub.addView(k.button("Sync now", small = true) { phone.link.syncNow() }, k.wrap(top = 10))
        into.addView(hub, k.gap(12))
    }
}

/** Activity: the phone's own log, newest first: what the PC asked, stops, pairing, and (Phase 3) what Mini did here. */
class ActivityScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Activity"

    override fun build(into: LinearLayout) {
        val rows = phone.audit.recent(200)
        if (rows.isEmpty()) {
            into.addView(k.muted("Nothing yet. What your PC asks this phone, and what you stop or allow, shows up here.", 14f))
            return
        }
        val card = k.card()
        rows.forEachIndexed { i, r ->
            if (i > 0) card.addView(k.divider(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply { topMargin = k.dp(8) })
            val line = k.row()
            val words = k.column()
            val label = PhoneScopes.find(r.scope ?: "")?.label?.lowercase()
            words.addView(k.text("${r.who}: ${r.action}${if (label != null) " ($label)" else ""}", 14f))
            words.addView(k.muted(listOfNotNull(DateUtils.getRelativeTimeSpanString(r.at).toString(), r.detail).joinToString(" · "), 12f), k.gap(2))
            line.addView(words, k.fill())
            val tone = when (r.outcome) { "done" -> Tone.OK; "refused", "failed" -> Tone.DANGER; else -> Tone.WARN }
            line.addView(k.text(r.outcome, 12f, color = tone))
            card.addView(line, k.gap(8))
        }
        into.addView(card)
    }
}

/** Record: what has been recorded on this phone, searchable, with delete. */
class RecordScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Record"
    private var query = ""

    override fun build(into: LinearLayout) {
        val search = field("Search the record").apply {
            setText(query)
            setSelection(query.length)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, aft: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    query = s?.toString() ?: ""
                    list.removeAllViews()
                    fill(list)
                }
            })
        }
        into.addView(search)
        list = k.column()
        into.addView(list, k.gap(12))
        fill(list)
    }

    private lateinit var list: LinearLayout

    private fun fill(list: LinearLayout) {
        val rows = phone.record.search(query, 200)
        if (rows.isEmpty()) {
            list.addView(k.muted(if (query.isBlank()) "Nothing recorded yet. Turn on what to collect in Permissions." else "Nothing matches.", 14f))
            return
        }
        val card = k.card()
        rows.forEachIndexed { i, r ->
            if (i > 0) card.addView(k.divider(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply { topMargin = k.dp(8) })
            val line = k.row()
            val words = k.column()
            val e = r.event
            words.addView(k.text(Lines.recordTitle(e.type, e.who, e.title), 14f, lines = 1))
            val detail = e.body ?: e.data?.let { d -> d.replace(Regex("[{}\"]"), "").replace(",", ", ").replace(":", ": ") }
            if (!detail.isNullOrBlank()) words.addView(k.muted(detail, 12f).apply { maxLines = 2 }, k.gap(2))
            words.addView(k.text(DateUtils.getRelativeTimeSpanString(e.occurredAt).toString(), 11f, color = Tone.INK3), k.gap(2))
            line.addView(words, k.fill())
            line.addView(k.button("Delete", small = true) {
                confirm("Delete this?", "It is deleted from this phone. If it already went to your PC, delete it there too.", "Delete") {
                    phone.record.delete(listOf(r.seq))
                    phone.link.syncNow()
                    a.refresh()
                }
            }, k.wrap().apply { marginStart = k.dp(8) })
            card.addView(line, k.gap(8))
        }
        list.addView(card)
    }
}

/** Permissions: per kind of thing, Collect, Mini on this phone and From my PC; the lock; and Stop. */
class PermissionsScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Permissions"

    /** What this version can collect so far; the rest arrives with the next part (Phase 2b). */
    private val collectedNow = setOf("phone.usage.read")

    override fun build(into: LinearLayout) {
        val s = phone.switches
        into.addView(k.muted("Everything starts off. This phone's switches always win: your PC can only ask.", 14f))
        for (scope in PhoneScopes.ALL) {
            val card = k.card(scope.label)
            if (scope.kind == "important") card.addView(k.text("Always asks first, every time.", 12f, color = Tone.WARN), k.gap(2))
            if (scope.collectable) {
                val row = k.row()
                row.addView(k.text("Collect", 14f), k.fill())
                row.addView(Switch(a).apply {
                    isChecked = s.collect(scope.id)
                    contentDescription = "Collect ${scope.label}"
                    setOnCheckedChangeListener { _, on -> s.setCollect(scope.id, on) }
                })
                card.addView(row, k.gap(10))
                if (scope.id !in collectedNow) card.addView(k.muted("Not collected by this version yet; it comes with the next update.", 12f), k.gap(2))
            }
            fun grantRow(label: String, value: Grant, set: (Grant) -> Unit) {
                val row = k.row()
                row.addView(k.text(label, 14f), k.fill())
                row.addView(k.segmented("$label: ${scope.label}", value.wire) { v -> set(Grant.parse(v)); a.refresh() })
                card.addView(row, k.gap(10))
            }
            grantRow("Mini on this phone", s.mini(scope.id)) { s.setMini(scope.id, it) }
            grantRow("From my PC", s.pc(scope.id)) { s.setPc(scope.id, it) }
            into.addView(card, k.gap(12))
        }

        val lock = k.card("Only change these on the phone")
        val row = k.row()
        row.addView(k.muted("When on, your PC cannot change what this phone collects.", 13f), k.fill())
        row.addView(Switch(a).apply {
            isChecked = s.lockedOnPhone
            contentDescription = "Only change these on the phone"
            setOnCheckedChangeListener { _, on -> s.lockedOnPhone = on }
        })
        lock.addView(row, k.gap(8))
        into.addView(lock, k.gap(12))

        val stop = k.card("Stop")
        stop.addView(k.muted("Stops Mini on this phone at once, and anything your PC is doing here. What is recorded keeps being recorded.", 13f), k.gap(4))
        val buttons = k.row()
        buttons.addView(k.button("Stop Mini", danger = true, small = true) {
            phone.stopped = true
            app.minihub.phone.consent.Approvals.noAll(a)
            if (MiniService.running) MiniService.stop(a)
            phone.audit.add("You", "stop", outcome = "done")
            a.later(300)
        }, k.wrap(end = 8))
        if (phone.link.status == LinkStatus.Linked) buttons.addView(k.button("Stop on my PC too", danger = true, small = true) {
            phone.link.send(Frame.StopRequest)
            phone.stopped = true
            app.minihub.phone.consent.Approvals.noAll(a)
            if (MiniService.running) MiniService.stop(a)
            phone.audit.add("You", "stop on the PC too", outcome = "done")
            Toast.makeText(a, "Stopped here and on your PC.", Toast.LENGTH_LONG).show()
            a.later(300)
        }, k.wrap())
        stop.addView(buttons, k.gap(10))
        into.addView(stop, k.gap(12))
    }
}

/** Hub: pair (scan, or type the address and code), the paired hub, Sync now, Forget this hub. */
class HubScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Your PC"

    override fun build(into: LinearLayout) {
        val pairing = a.pairing
        if (pairing != null) return showPairing(into, pairing)
        val hub = phone.hubs.get()
        val status = phone.link.status
        if (hub == null || status is LinkStatus.Refused) return showPair(into, (status as? LinkStatus.Refused)?.reason)

        val card = k.card(hub.name)
        card.addView(k.text(hubLine(), 15f), k.gap(6))
        card.addView(k.muted("${hub.host}:${hub.port}", 12f), k.gap(4))
        card.addView(k.muted("The phone links only on your home Wi-Fi, and only to this PC. What it records meanwhile arrives when you are home.", 12f), k.gap(8))
        val buttons = k.row()
        buttons.addView(k.button("Sync now", small = true) { phone.link.syncNow(); a.later(800) }, k.wrap(end = 8))
        buttons.addView(k.button("Forget this hub", danger = true, small = true) {
            confirm("Forget ${hub.name}?", "This phone stops syncing with it. To link again you pair again. Remove the phone on your PC too.", "Forget") {
                phone.link.forget()
                a.later(300)
            }
        }, k.wrap())
        card.addView(buttons, k.gap(12))
        into.addView(card)

        // Trial T3 (docs/10 > Phase 0), in the trial build only: made-up events to hand over, never in the owner's app.
        if (a.packageName.endsWith(".trial")) {
            val trial = k.card("Trial T3")
            trial.addView(k.muted("Adds 10,000 made-up events to send. Switch Wi-Fi off and on while they go; the PC should end with exactly 10,000.", 12f), k.gap(4))
            trial.addView(k.button("Add 10,000 made-up events", small = true) {
                Thread {
                    for (i in 1..10_000) phone.record.add(app.minihub.phone.data.NewEvent(type = "mini_action", occurredAt = System.currentTimeMillis(), title = "Trial event $i"))
                    a.runOnUiThread { Toast.makeText(a, "Added 10,000 made-up events.", Toast.LENGTH_LONG).show(); a.refresh() }
                }.start()
            }, k.wrap(top = 8))
            into.addView(trial, k.gap(12))
        }
    }

    private fun showPair(into: LinearLayout, refused: String?) {
        if (refused != null) {
            val note = k.card()
            note.addView(k.text(refused, 14f, color = Tone.WARN))
            note.addView(k.button("Pair again", small = true) { phone.link.forget(); a.later(300) }, k.wrap(top = 10))
            into.addView(note, k.gap(0))
            return
        }
        val card = k.card("Pair with your PC")
        card.addView(k.muted("On your PC, open Mini Hub, then Devices, then Add device. Then scan the code it shows.", 14f), k.gap(6))
        card.addView(k.button("Scan the code", primary = true) { a.scan() }, k.gap(12))
        card.addView(k.muted("Or type what your PC shows under the code:", 13f), k.gap(16))
        val address = field("Address, like 192.168.1.20:47800", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val code = field("Code", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        card.addView(address, k.gap(8))
        card.addView(code, k.gap(8))
        card.addView(k.button("Pair") { a.pairTyped(address.text.toString(), code.text.toString()) }, k.gap(10))
        into.addView(card)
    }

    private fun showPairing(into: LinearLayout, p: MainActivity.Pairing) {
        val card = k.card("Pairing")
        when {
            p.error != null -> {
                card.addView(k.text(p.error!!, 14f, color = Tone.DANGER), k.gap(6))
                card.addView(k.button("Try again", small = true) { a.endPairing() }, k.wrap(top = 10))
            }
            p.words != null -> {
                card.addView(k.text("Check these match the words on your PC", 15f, bold = true), k.gap(6))
                val words = k.column()
                for (w in p.words!!) words.addView(k.text(w, 26f, bold = true).apply { gravity = Gravity.CENTER_HORIZONTAL }, k.gap(6))
                card.addView(words, k.gap(8))
                card.addView(k.muted("If they match, press Pair on your PC. If not, press Cancel there and here.", 13f), k.gap(10))
                card.addView(k.button("Cancel", small = true) { a.endPairing() }, k.wrap(top = 10))
            }
            else -> {
                card.addView(k.muted("Reaching your PC…", 14f), k.gap(6))
                card.addView(k.button("Cancel", small = true) { a.endPairing() }, k.wrap(top = 10))
            }
        }
        into.addView(card)
    }
}

/** Brain: the setup steps for Mini on this phone and their checks (v1's setup screen), with Start and Stop. */
class BrainScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Mini's brain"

    override fun build(into: LinearLayout) {
        into.addView(k.muted("Mini on this phone runs on Claude Code in Termux. Every permission here is your own tap.", 14f))
        val termux = Termux.isInstalled(a)
        val runPermission = Termux.hasPermission(a)
        val overlay = Settings.canDrawOverlays(a)
        val mic = a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notify = a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val battery = a.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(a.packageName)

        step(into, "Termux is installed", termux, null)
        step(into, "Mini may run commands in Termux", runPermission, "Allow") { a.requestPermissions(arrayOf(Termux.PERMISSION), 1) }
        step(into, "Termux accepts commands from Mini", null, "Copy the line", "Once: open Termux, paste this line and press Enter.\n${Termux.ALLOW_LINE}") {
            a.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Termux setting", Termux.ALLOW_LINE))
            Toast.makeText(a, "Copied. Paste it in Termux and press Enter.", Toast.LENGTH_LONG).show()
            a.packageManager.getLaunchIntentForPackage(Termux.PACKAGE)?.let { a.startActivity(it) }
        }
        step(into, "Mini may appear over other apps", overlay, "Open setting") {
            a.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${a.packageName}")))
        }
        step(into, "Microphone, for talking to Mini", mic, "Allow") { a.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2) }
        step(into, "Notifications, to show Mini is on", notify, "Allow") { a.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3) }
        step(into, "Android does not pause Mini", battery, "Allow") {
            a.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${a.packageName}")))
        }

        val ready = termux && runPermission && overlay
        into.addView(k.muted(if (MiniService.running) "Mini is on. Tap the bot to talk; Hide and Stop are in its panel." else if (ready) "Ready to start." else "Finish the setup above first.", 14f), k.gap(18))
        into.addView(k.button(if (MiniService.running) "Show the bot" else "Start Mini", primary = true, enabled = ready) { MiniService.start(a); a.later(400) }, k.gap(10))
        if (MiniService.running) into.addView(k.button("Stop Mini", danger = true) { MiniService.stop(a); a.later(400) }, k.gap(8))
        into.addView(k.muted("Stop ends Mini's session in Termux and closes the bot. Your other Termux sessions are left alone.", 12f), k.gap(12))
    }

    private fun step(into: LinearLayout, label: String, done: Boolean?, action: String?, detail: String? = null, onClick: (() -> Unit)? = null) {
        val row = k.row().apply {
            setPadding(k.dp(14), k.dp(12), k.dp(14), k.dp(12))
            background = k.rounded(Tone.SURFACE, 12)
        }
        val words = k.column()
        words.addView(k.text((if (done == true) "✓  " else if (done == false) "•  " else "?  ") + label, 15f, color = if (done == true) Tone.OK else Tone.INK))
        if (detail != null && done != true) words.addView(k.muted(detail, 12f).apply { setTextIsSelectable(true) }, k.gap(4))
        row.addView(words, k.fill())
        if (done != true && action != null && onClick != null) row.addView(k.button(action, small = true, onClick = onClick))
        into.addView(row, k.gap(8))
    }
}

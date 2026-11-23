package app.minihub.phone.ui

import android.Manifest
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
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
import android.widget.Toast
import app.minihub.phone.MainActivity
import app.minihub.phone.MiniService
import app.minihub.phone.Phone
import app.minihub.phone.brain.BrainKeeper
import app.minihub.phone.brain.BrainState
import app.minihub.phone.brain.Termux
import app.minihub.phone.brain.TermuxCheck
import app.minihub.phone.brain.pluginKnowsThePhone
import app.minihub.phone.consent.SharedPrefs
import app.minihub.phone.ui.look.ChoiceView
import app.minihub.phone.collect.Need
import app.minihub.phone.consent.Approvals
import app.minihub.phone.consent.Grant
import app.minihub.phone.consent.PhoneScopes
import app.minihub.phone.link.Frame
import app.minihub.phone.overlay.CountdownView
import app.minihub.phone.overlay.QuestionShift
import app.minihub.phone.overlay.answerRow
import app.minihub.phone.link.LinkStatus
import android.widget.FrameLayout
import app.minihub.phone.ui.look.BarView
import app.minihub.phone.ui.look.Look
import app.minihub.phone.ui.look.LookSwitch
import app.minihub.phone.ui.look.MunchView
import app.minihub.phone.ui.look.PixelBotView
import app.minihub.phone.ui.look.SegmentsView
import app.minihub.phone.ui.look.TagTone
import app.minihub.phone.ui.look.box
import app.minihub.phone.ui.look.lookTag
import app.minihub.phone.voice.Speaker
import app.minihub.phone.voice.TalkActivity
import app.minihub.phone.voice.Voice

/** A screen of the phone app (docs/08 > The app's own screens). Built in code, rebuilt when what it shows changes. */
abstract class Screen(protected val a: MainActivity, protected val phone: Phone) {
    protected val k = Kit(a)
    abstract val title: String
    abstract fun build(into: LinearLayout)

    /** The owner has gone to another screen (or out of the app): what was only shown for now is hidden again. */
    open fun left() {}

    protected fun field(hint: String, type: Int = InputType.TYPE_CLASS_TEXT) = EditText(a).apply {
        this.hint = hint
        inputType = type
        setHintTextColor(Color.parseColor(Tone.INK3))
        setTextColor(Color.parseColor(Tone.INK))
        background = android.graphics.drawable.StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), app.minihub.phone.ui.look.box(a, Look.p.card, Look.p.accent, 2))
            addState(intArrayOf(), app.minihub.phone.ui.look.box(a, Look.p.card, Look.p.ink, 2))
        }
        typeface = Look.mono(a, 500)
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
        // Questions waiting for the owner come first: who is asking, the question, Yes and No, and the countdown.
        val asks = Approvals.pending()
        val shifted = QuestionShift.since(asks)
        for ((i, q) in asks.withIndex()) {
            val ask = k.card("${q.who} is asking")
            if (Build.VERSION.SDK_INT >= 34) ask.setAccessibilityDataSensitive(View.ACCESSIBILITY_DATA_SENSITIVE_YES)
            ask.addView(k.text(q.text, 14.5f), k.gap(4))
            // Yes takes only a real finger; the cards move when a question goes, so a tap right after is ignored.
            ask.addView(answerRow(a, q, shifted), k.gap(10))
            ask.addView(CountdownView(a, q.until), k.gap(8))
            into.addView(ask, k.gap(if (i == 0) 0 else 12))
        }
        val on = MiniService.running && phone.brain == "ok"
        val botTag = when {
            phone.stopped -> lookTag(a, "Stopped", TagTone.Danger, pill = true)
            on -> lookTag(a, "● On", TagTone.Ok, pill = true)
            MiniService.running -> lookTag(a, "Starting", TagTone.Warn, pill = true)
            else -> lookTag(a, "Off", TagTone.Muted, pill = true)
        }
        val bot = k.card("Mini · this phone", botTag)
        val top = k.row()
        val face = FrameLayout(a).apply {
            background = box(a, Look.p.cardBar)
            addView(PixelBotView(a, if (on) "idle" else if (MiniService.running) "thinking" else "asleep"), FrameLayout.LayoutParams(k.dp(40), k.dp(34), Gravity.CENTER))
        }
        top.addView(face, LinearLayout.LayoutParams(k.dp(56), k.dp(56)))
        val words = k.column()
        val (head, sub) = when {
            phone.stoppedBy == "pc" -> "Stopped from your PC" to "Mini on this phone is stopped. Start Mini to resume here."
            phone.stopped -> "Mini is stopped" to "Start Mini to resume."
            on -> "Mini is on" to "Tap the bot to talk, or ask here."
            MiniService.running -> "Mini is starting" to "Mini's Claude Code is starting in Termux."
            else -> "Mini is off" to "Start Mini to talk to it."
        }
        words.addView(k.label(head, 16f, Tone.INK))
        words.addView(k.muted(sub, 12.5f), k.gap(3))
        top.addView(words, k.fill().apply { marginStart = k.dp(12) })
        bot.addView(top)
        if (MiniService.running && !on) bot.addView(MunchView(a), k.gap(12))
        val ready = Termux.isInstalled(a) && Termux.hasPermission(a) && Settings.canDrawOverlays(a)
        if (on) {
            val ask = field("ask mini…").apply { imeOptions = EditorInfo.IME_ACTION_SEND; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES }
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
            // Talk opens the Talk sheet, the only place the microphone opens.
            askRow.addView(k.button("Talk", small = true) { TalkActivity.open(a) }, k.wrap().apply { marginStart = k.dp(8) })
            bot.addView(askRow, k.gap(12))
            bot.addView(k.muted("The reply shows in the bot's panel.", 11.5f), k.gap(6))
        }
        val buttons = k.row()
        if (MiniService.running) {
            buttons.addView(k.button("Show bot", small = true) { MiniService.start(a) }, k.wrap(end = 8))
            buttons.addView(k.button("Stop Mini", danger = true, small = true) { MiniService.stop(a); a.later(400) }, k.wrap())
        } else {
            buttons.addView(k.button("Start Mini", primary = true, small = true, enabled = ready) { MiniService.start(a); a.later(400) }, k.wrap(end = 8))
            if (!ready) buttons.addView(k.button("Finish setup", small = true) { a.open("brain") }, k.wrap())
        }
        bot.addView(buttons, k.gap(12))
        into.addView(bot, k.gap(if (asks.isEmpty()) 0 else 12))

        // Today's numbers, each in its own small card.
        val counts = k.row()
        Lines.today(phone.today()).filter { it.first != "Notifications" }.forEachIndexed { i, (label, n) ->
            val cell = k.card()
            cell.addView(k.label(label, 10.5f))
            cell.addView(k.text(n.toString(), 28f, bold = true, color = if (label == "Mini" && n > 0) Tone.ACCENT else Tone.INK).apply { typeface = Look.sans(a, 900) }, k.gap(2))
            counts.addView(cell, k.fill().apply { if (i > 0) marginStart = k.dp(8) })
        }
        into.addView(counts, k.gap(14))

        // This phone: battery and network, as the PC sees them.
        val reading = phone.deviceState.current
        val charging = reading?.charging == true
        val me = k.card("This phone", if (charging) lookTag(a, "Charging", TagTone.Fill) else null)
        val row = k.row()
        row.addView(k.label("Battery", 12f), k.fill())
        row.addView(k.text(reading?.battery?.let { "$it%" } ?: "—", 30f, bold = true).apply { typeface = Look.sans(a, 900) })
        me.addView(row)
        me.addView(BarView(a, (reading?.battery ?: 0).toFloat()), k.gap(6))
        val net = k.row()
        net.addView(k.text("NETWORK", 11.5f, color = Tone.INK3, mono = true), k.fill())
        val kind = when (reading?.network ?: phone.deviceState.networkKind()) {
            "wifi" -> "WI-FI"
            "mobile" -> "MOBILE DATA"
            else -> "NO NETWORK"
        }
        net.addView(k.text(kind, 11.5f, mono = true))
        me.addView(net, k.gap(8))
        into.addView(me, k.gap(14))

        // Your PC: the link, what is waiting to go, Sync now.
        val status = phone.link.status
        val hubTag = when (status) {
            LinkStatus.Linked -> lookTag(a, "● Linked", TagTone.Ok, pill = true)
            LinkStatus.Connecting -> lookTag(a, "Linking", TagTone.Warn, pill = true)
            LinkStatus.NotPaired -> lookTag(a, "Not paired", TagTone.Muted, pill = true)
            is LinkStatus.Refused -> lookTag(a, "Removed", TagTone.Danger, pill = true)
            LinkStatus.NotAtHome -> lookTag(a, "Not at home", TagTone.Muted, pill = true)
        }
        val hub = k.card("Your PC", hubTag)
        if (status == LinkStatus.Connecting) hub.addView(MunchView(a))
        else if (phone.hubs.get() != null) {
            // Twelve cells: orange for what is through, dashed for what still waits to go.
            val waiting = phone.link.waiting().toInt()
            val cells = 12
            val left = if (waiting == 0) 0 else waiting.coerceIn(1, cells - 1)
            hub.addView(SegmentsView(a, cells - left, cells))
        }
        val line = k.row()
        line.addView(k.text(hubLine(), 13.5f, bold = true), k.fill())
        if (phone.hubs.get() == null) line.addView(k.button("Pair", primary = true, small = true) { a.open("hub") })
        else line.addView(k.button("Sync now", small = true) { phone.link.syncNow(); a.later(800) })
        hub.addView(line, k.gap(10))
        into.addView(hub, k.gap(14))
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

/** Record: what has been recorded on this phone, searchable, with delete. One-time codes show masked until the row is tapped. */
class RecordScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Record"
    private var query = ""

    // Rows (by their number in the record) the owner tapped to read in full; forgotten when the screen is left.
    private val shown = HashSet<Long>()

    override fun left() = shown.clear()

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
            words.addView(k.text(Lines.recordHead(e), 14f, lines = 1))
            val full = Lines.recordDetail(e)
            val open = r.seq in shown
            if (full != null) words.addView(k.muted(if (open) full else Lines.mask(full), 12f).apply { if (!open) maxLines = 2 }, k.gap(2))
            if (full != null && !open && Lines.mask(full) != full) {
                words.addView(k.text("Tap to show the full text", 11f, color = Tone.INK3), k.gap(2))
                words.isClickable = true
                words.setOnClickListener {
                    shown.add(r.seq)
                    list.removeAllViews()
                    fill(list)
                }
            }
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

    /** What this version can collect; Location is not collected yet. */
    private val collectedNow = setOf("phone.usage.read", "phone.calls.read", "phone.messages.read", "phone.notifications.read")

    /** Under a collect switch that is on: one line per source, and the button for the first thing it is missing. */
    private fun sources(card: LinearLayout, scope: String) {
        val list = phone.collectors.status(scope)
        for (st in list) {
            val perm = st.permission
            when (st.need) {
                null -> when {
                    !st.running -> card.addView(k.muted("Starting…", 12.5f), k.gap(8))
                    perm == Manifest.permission.READ_CALL_LOG -> card.addView(k.muted("Recording calls.", 12.5f), k.gap(8))
                    perm == Manifest.permission.READ_SMS -> card.addView(k.muted("Recording SMS.", 12.5f), k.gap(8))
                    else -> {
                        val n = phone.collectors.apps.chosen().size
                        card.addView(k.muted("Recording from $n app${if (n == 1) "" else "s"}.", 12.5f), k.gap(8))
                        card.addView(k.button("Choose apps", small = true) { a.open("apps") }, k.wrap(top = 6))
                    }
                }
                Need.Permission -> if (perm != null) {
                    val thing = if (perm == Manifest.permission.READ_CALL_LOG) "the call log" else "your SMS"
                    ask(card, perm, "Android has not allowed Mini to read $thing yet.", "Allow", why = true)
                }
                Need.NotificationAccess -> {
                    card.addView(k.muted("Notification access is off. Turn on Mini in Android's list.", 12.5f), k.gap(8))
                    card.addView(k.muted(WHY, 11.5f), k.gap(2))
                    card.addView(k.button("Open notification access", small = true) { a.openNotificationAccess() }, k.wrap(top = 6))
                    card.addView(k.text("If Android says this setting is restricted: open Mini's app info, tap ⋮, Allow restricted settings, then try again.", 11f, color = Tone.INK3), k.gap(6))
                }
                Need.Apps -> {
                    card.addView(k.muted("No apps chosen yet. Mini reads notifications only from apps you choose.", 12.5f), k.gap(8))
                    card.addView(k.muted(WHY, 11.5f), k.gap(2))
                    card.addView(k.button("Choose apps", small = true) { a.open("apps") }, k.wrap(top = 6))
                }
            }
        }
        // Names for SMS come from contacts, only if the owner allows them.
        if (scope == "phone.messages.read" && list.any { it.running && it.permission == Manifest.permission.READ_SMS } &&
            a.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED
        ) {
            ask(card, Manifest.permission.READ_CONTACTS, "To show names for SMS, allow contacts. They are used only on this phone.", "Allow contacts", why = false)
        }
    }

    /** A line about a missing Android permission and its button: Allow, or (when Android will not ask again) the app's settings. */
    private fun ask(card: LinearLayout, permission: String, line: String, button: String, why: Boolean) {
        if (a.refusedForGood(permission)) {
            card.addView(k.muted("Android will not ask again. Allow it in Mini's app settings, under Permissions.", 12.5f), k.gap(8))
            card.addView(k.button("Open app settings", small = true) { a.openAppSettings() }, k.wrap(top = 6))
            return
        }
        card.addView(k.muted(line, 12.5f), k.gap(8))
        if (why) card.addView(k.muted(WHY, 11.5f), k.gap(2))
        card.addView(k.button(button, small = true) { a.askFor(permission) }, k.wrap(top = 6))
    }

    override fun build(into: LinearLayout) {
        val s = phone.switches
        into.addView(k.muted("Everything starts off. This phone's switches always win: your PC can only ask.", 14f))
        into.addView(k.muted("Mini on this phone is what Mini's session in Termux may read here. Ask means a question on this phone each time.", 14f), k.gap(6))
        for (scope in PhoneScopes.ALL) {
            val card = k.card(scope.label)
            if (scope.kind == "important") card.addView(k.text("Always asks first, every time.", 12f, color = Tone.WARN), k.gap(2))
            if (scope.collectable) {
                val row = k.row()
                row.addView(k.text("Collect", 14f), k.fill())
                row.addView(LookSwitch(a, "Collect ${scope.label}", s.collect(scope.id)) { on -> s.setCollect(scope.id, on) })
                card.addView(row, k.gap(10))
                if (scope.id !in collectedNow) card.addView(k.muted("Not collected by this version yet; it comes with the next update.", 12f), k.gap(2))
                else if (s.collect(scope.id)) sources(card, scope.id)
            }
            fun grantRow(label: String, value: Grant, set: (Grant) -> Unit) {
                val row = k.row()
                row.addView(k.text(label, 14f), k.fill())
                row.addView(k.segmented("$label: ${scope.label}", value.wire) { v -> set(Grant.parse(v)); a.refresh() })
                card.addView(row, k.gap(10))
            }
            scope.collectedBy?.let { PhoneScopes.find(it) }?.let { by ->
                card.addView(k.muted("Also needs Collect on for ${by.label}.", 12f), k.gap(2))
            }
            grantRow("Mini on this phone", s.mini(scope.id)) { s.setMini(scope.id, it) }
            if (scope.id in MINI_READS) {
                if (!s.collect(scope.id)) card.addView(k.muted("Collect is off, so there is nothing for Mini to read.", 12f), k.gap(2))
            } else if (scope.id != PhoneScopes.STATUS) {
                card.addView(k.muted("Mini cannot use this on the phone yet.", 12f), k.gap(2))
            }
            if (!scope.phoneOnly) grantRow("From my PC", s.pc(scope.id)) { s.setPc(scope.id, it) }
            into.addView(card, k.gap(12))
        }

        val lock = k.card("Only change these on the phone")
        val row = k.row()
        row.addView(k.muted("When on, your PC cannot change what this phone collects.", 13f), k.fill())
        row.addView(LookSwitch(a, "Only change these on the phone", s.lockedOnPhone) { on -> s.lockedOnPhone = on })
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

/** What Mini's phone_read can read now; Phone status has its own tool (phone_status). */
private val MINI_READS = setOf("phone.calls.read", "phone.messages.read", "phone.notifications.read")

private const val WHY = "Mini reads this only while Collect is on, and keeps it on this phone until it goes to your PC."

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
                for (w in p.words!!) words.addView(lookTag(a, w, TagTone.Accent).apply { textSize = 22f; gravity = Gravity.CENTER; setPadding(k.dp(12), k.dp(8), k.dp(12), k.dp(8)) }, k.gap(8))
                card.addView(words, k.gap(8))
                card.addView(k.muted("If they match, press Pair on your PC. If not, press Cancel there and here.", 13f), k.gap(10))
                card.addView(k.button("Cancel", small = true) { a.endPairing() }, k.wrap(top = 10))
            }
            else -> {
                card.addView(k.muted("Reaching your PC…", 14f), k.gap(6))
                card.addView(MunchView(a), k.gap(10))
                card.addView(k.button("Cancel", small = true) { a.endPairing() }, k.wrap(top = 10))
            }
        }
        into.addView(card)
    }
}

/**
 * Brain: what Mini on this phone needs, step by step (docs/08 > Setting it up, once), the brain's state, and its mode.
 * Every step is the owner's own tap. The app only reads what Termux and Claude Code have set (through Check Termux) to
 * say what is missing; it never writes it, and never answers Claude Code's questions.
 */
class BrainScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Mini's brain"

    // The speech model check (asked once each time the screen is opened) and the voice for Try it, while it is shown.
    private val voice by lazy { Voice(a.applicationContext) }
    private var speechAsked = false
    private var speechInstalled: Boolean? = null
    private var speechDownloadable = false
    private var speaker: Speaker? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var redrawPosted = false

    /** Builds the screen again after the current build, never inside it, and once for several callbacks. */
    private fun redraw() {
        if (redrawPosted) return
        redrawPosted = true
        main.post {
            redrawPosted = false
            a.refresh()
        }
    }

    override fun left() {
        speaker?.close()
        speaker = null
        speechAsked = false
    }

    override fun build(into: LinearLayout) {
        val setup = phone.setup
        val termux = Termux.isInstalled(a)
        // An answer from before Termux was uninstalled (as step 2 asks) is not an answer about the Termux that is there now.
        val check = if (termux) setup.last else null
        val runPermission = Termux.hasPermission(a)
        val overlay = Settings.canDrawOverlays(a)
        val mic = a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val notify = a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val power = a.getSystemService(PowerManager::class.java)
        val battery = power.isIgnoringBatteryOptimizations(a.packageName)
        val termuxBattery = termux && power.isIgnoringBatteryOptimizations(Termux.PACKAGE)
        val tap = "Tap Check Termux."
        val busy = setup.updating

        into.addView(k.muted("Mini on this phone runs on Claude Code in Termux. Every step here is your own tap; Mini never changes Termux's or Claude Code's settings for you.", 14f))

        if (termux) {
            val row = k.row()
            val checked = when {
                setup.checking -> "Checking…"
                setup.error != null -> setup.error!!
                check != null -> "Checked " + DateUtils.getRelativeTimeSpanString(setup.checkedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
                else -> "Not checked yet."
            }
            row.addView(k.button(if (setup.checking) "Checking…" else "Check Termux", small = true, enabled = !setup.checking && !busy) { setup.check() }, k.wrap(end = 10))
            row.addView(k.muted(checked, 12f), k.fill())
            into.addView(row, k.gap(12))
        }

        // 1 and 2: Termux, and which build it is (advice only; it never blocks Start).
        step(into, "Termux is installed", termux, "Get Termux", "Install Termux from F-Droid, then open it once.") {
            try {
                a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(GET_TERMUX)))
            } catch (e: RuntimeException) {
                Toast.makeText(a, "No browser to open. Go to $GET_TERMUX yourself.", Toast.LENGTH_LONG).show()
            }
        }
        val debug = Termux.isDebugBuild(a)
        step(into, "Termux is the F-Droid build", if (debug == null) null else !debug, null, if (debug == true) DEBUG_BUILD else null)

        // 3 to 9: what Termux and Claude Code need.
        step(into, "Mini may run commands in Termux", if (termux) runPermission else false, if (termux) "Allow" else null) {
            a.requestPermissions(arrayOf(Termux.PERMISSION), 1)
        }
        val accepted = check != null && setup.error != Termux.REFUSED
        step(
            into, "Termux accepts commands from Mini", accepted, if (termux) "Copy the line" else null,
            (if (setup.error == Termux.REFUSED) Termux.REFUSED + "\n" else "") + "Once: open Termux, paste this line and press Enter.\n${Termux.ALLOW_LINE}",
        ) { copyAndOpenTermux("Termux setting", Termux.ALLOW_LINE) }
        step(
            into, "Node.js, tmux and git in Termux", check?.let { it.node && it.tmux && it.git }, if (termux) "Copy the line" else null,
            if (check == null) tap else "In Termux, run: $PACKAGES",
        ) { copyAndOpenTermux("Termux command", PACKAGES) }
        // Installed but silent (claude --version gave nothing) is unknown, not "not installed".
        val signedIn = check?.let { if (it.claude != null) it.signedIn else if (it.claudeFound) null else false }
        step(
            into, "Claude Code is installed and signed in", signedIn, null,
            if (check == null) tap else if (check.claude != null) "In Termux, run claude and sign in." else if (check.claudeFound)
                "Mini could not check Claude Code: it did not answer claude --version. In Termux, run claude to see why."
            else "Claude Code is not installed in Termux. Install it there, then run claude and sign in.",
            note = check?.claude?.let { "Version: $it" },
        )
        val pluginKnown = check != null && check.read
        step(
            into, "Mini Bot 0.8.0 or later on this phone",
            if (pluginKnown) pluginKnowsThePhone(check?.plugin) else null,
            if (termux) "Update Mini Bot" else null,
            if (check == null) tap else if (!check.read) "Mini could not check this. Tap Check Termux again." else "Tap Update Mini Bot to download the latest Mini Bot into Termux. Mini stops while it updates, and starts again if it was on.",
            note = setup.updateNote ?: if (busy) "Updating Mini Bot…" else pluginNote(check),
            enabled = !busy && runPermission,
            // Always there: a newer Mini Bot (with its fixes) reaches the phone only this way.
            always = true,
        ) { setup.update() }
        val runs = runsNow(phone.brainState)
        step(
            into, "Claude Code trusts Mini's folder", if (check == null) null else check.trusted,
            if (runs) "Open Claude Code" else null,
            if (check == null) tap else "Start Mini, tap Open Claude Code, and answer Yes to Claude Code's question about trusting ~/.mini/work. Mini never answers it for you.",
        ) { openClaudeCode() }
        step(
            into, "Your Claude Code settings keep Mini's limits", if (check == null || !check.read || !check.widenedKnown) null else check.widened.isEmpty(), null,
            if (check == null) tap else if (!check.read || !check.widenedKnown)
                "Mini could not read your Claude Code settings (~/.claude/settings.json), so it cannot say whether they keep Mini's limits. Tap Check Termux again." else
                "Mini on the phone runs with commands refused and files only in ~/.mini/work. Your own Claude Code settings in Termux allow more: " +
                    "${check.widened.joinToString(", ")}. They apply to Mini's session too. To keep the phone's limits, remove them in Termux yourself.",
        )

        // 10 to 14: Android's own questions, each opened by the owner.
        step(into, "Mini may appear over other apps", overlay, "Open setting") {
            a.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${a.packageName}")))
        }
        step(into, "Notifications, to show Mini is on", notify, "Allow") { a.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3) }
        val micForGood = !mic && a.refusedForGood(Manifest.permission.RECORD_AUDIO)
        step(
            into, "Microphone, for talking to Mini", mic, if (micForGood) "Open app settings" else "Allow",
            if (micForGood) "Android will not ask again. Allow it in Mini's app settings, under Permissions." else MIC_WHY,
        ) { if (micForGood) a.openAppSettings() else a.askFor(Manifest.permission.RECORD_AUDIO) }
        speechStep(into)
        step(into, "Android does not pause Mini", battery, "Allow") {
            a.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${a.packageName}")))
        }
        step(into, "Android does not pause Termux", if (termux) termuxBattery else null, if (termux) "Open Termux's settings" else null, "Choose Battery, then Unrestricted.") {
            try {
                a.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${Termux.PACKAGE}")))
            } catch (e: RuntimeException) {
                Toast.makeText(a, "Could not open Android's settings. Open them yourself and find Termux.", Toast.LENGTH_LONG).show()
            }
        }

        // Termux's own logs and notifications can hold what Mini sent it (docs/03 > Keys). Amber only for the log level,
        // which the owner set on purpose; the notifications are Termux's default, so that is advice.
        if (check != null) {
            val level = check.logMore
            val notes = check.errorNotes == true
            if (level != false || notes) {
                val card = k.card("Termux's logs and notifications")
                if (level == true) card.addView(k.text(LOG_MORE, 13.5f, color = Tone.WARN), k.gap(4))
                if (level == null) card.addView(k.muted(LOG_UNKNOWN, 12.5f), k.gap(4))
                if (notes) card.addView(k.muted(ERROR_REPORTS, 12.5f), k.gap(if (level != false) 8 else 4))
                into.addView(card, k.gap(14))
            }
        }

        brainCard(into, termux && runPermission && overlay, busy)
        voiceCard(into)
    }

    /** Whether the phone's on-device recognizer has a model for its language; Download opens Android's own download. */
    private fun speechStep(into: LinearLayout) {
        if (!speechAsked) {
            speechAsked = true
            speechInstalled = null
            voice.support { installed, downloadable ->
                speechInstalled = installed
                speechDownloadable = downloadable
                redraw()
            }
        }
        val installed = speechInstalled
        val label = "Speech for ${voice.languageName} on this phone"
        when {
            installed == null -> step(into, label, null, null, "Checking…")
            installed -> step(into, label, true, null)
            voice.checkFailed -> step(into, label, null, null, "Mini could not ask this phone's speech recognizer. Talk tries it anyway.")
            speechDownloadable -> step(into, label, false, "Download", "Android downloads it. Mini hears speech only on this phone.") {
                voice.download()
            }
            else -> step(into, label, false, null, "Not offered on this phone")
        }
    }

    /** How Mini answers out loud: when, in which voice, how fast, and Try it. */
    private fun voiceCard(into: LinearLayout) {
        val sp = speaker ?: Speaker(a, SharedPrefs(a, "voice")) { redraw() }.also { speaker = it }
        val card = k.card("Voice")
        card.addView(k.label("Speak replies", 11.5f))
        card.addView(
            ChoiceView(a, "Speak replies", listOf(Speaker.SPOKEN to "When I spoke", Speaker.ALWAYS to "Always", Speaker.NEVER to "Never"), sp.speak, quiet = Speaker.NEVER) { v ->
                sp.speak = v
                a.refresh()
            },
            k.wrap(top = 6),
        )
        card.addView(k.label("Voice", 11.5f), k.gap(14))
        when (sp.status) {
            Speaker.STARTING -> card.addView(k.muted("Loading this phone's voices…", 12.5f), k.gap(6))
            Speaker.NONE -> card.addView(k.muted("This phone has no text to speech, so Mini answers in writing only.", 12.5f), k.gap(6))
            else -> {
                val voices = sp.voices()
                val chosen = sp.voice?.takeIf { it in voices }
                val row = k.row()
                row.addView(k.text(chosen ?: DEFAULT_VOICE, 14f, mono = chosen != null, lines = 1), k.fill())
                row.addView(k.button("Choose", small = true) { chooseVoice(sp, voices, chosen) }, k.wrap().apply { marginStart = k.dp(8) })
                card.addView(row, k.gap(6))
                if (voices.isEmpty()) card.addView(k.muted("No voice on this phone works offline; replies are shown as text.", 12f), k.gap(4))
            }
        }
        card.addView(k.label("Speed", 11.5f), k.gap(14))
        val rates = Speaker.RATES.map { r -> r.toString() to (if (r == 1.0f) "1" else r.toString()) }
        card.addView(
            ChoiceView(a, "Speed", rates, sp.rate.toString(), quiet = null) { v ->
                sp.rate = v.toFloat()
                a.refresh()
            },
            k.wrap(top = 6),
        )
        card.addView(k.button("Try it", small = true, enabled = sp.canSpeak) { sp.say("This is how Mini sounds.") }, k.wrap(top = 14))
        card.addView(k.muted("Replies are read without their formatting, links and code, and at most 600 characters. A tap on the bot, Talk or Stop stops Mini speaking.", 12f), k.gap(8))
        into.addView(card, k.gap(14))
    }

    private fun chooseVoice(sp: Speaker, voices: List<String>, chosen: String?) {
        val names = listOf(DEFAULT_VOICE) + voices
        AlertDialog.Builder(a, if (Look.p.dark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
            .setTitle("Voice")
            .setSingleChoiceItems(names.toTypedArray(), if (chosen == null) 0 else names.indexOf(chosen).coerceAtLeast(0)) { d, which ->
                d.dismiss()
                sp.voice = if (which == 0) null else names[which]
                a.refresh()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun pluginNote(check: TermuxCheck?): String? = when {
        check == null || !check.read -> null
        check.plugin != null -> "Mini Bot ${check.plugin} is on this phone."
        else -> "Mini Bot is not downloaded yet (Start Mini downloads it)."
    }

    /** Below the steps: the brain's state, Start and Stop, its mode, and what it will not do. */
    private fun brainCard(into: LinearLayout, ready: Boolean, busy: Boolean) {
        val state = phone.brainState
        val on = MiniService.running
        val (tag, words) = when {
            busy -> lookTag(a, "Updating", TagTone.Warn, pill = true) to "Mini is updating."
            phone.stopped -> lookTag(a, "Stopped", TagTone.Danger, pill = true) to
                (if (phone.stoppedBy == "pc") "Stopped from your PC. Start Mini to resume here." else "Mini is off.")
            else -> when (state) {
                BrainState.Off -> lookTag(a, "Off", TagTone.Muted, pill = true) to "Mini is off."
                is BrainState.Starting -> lookTag(a, "Starting", TagTone.Warn, pill = true) to state.note
                BrainState.Ready -> lookTag(a, "● On", TagTone.Ok, pill = true) to "Mini is awake."
                is BrainState.NeedsYou -> lookTag(a, "Needs you", TagTone.Warn, pill = true) to state.note
                BrainState.Resting -> lookTag(a, "Resting", TagTone.Muted, pill = true) to BrainKeeper.RESTING
                is BrainState.Asleep -> lookTag(a, "Asleep", TagTone.Danger, pill = true) to state.reason
                is BrainState.Broken -> lookTag(a, "Broken", TagTone.Danger, pill = true) to state.reason
            }
        }
        val card = k.card("Mini's brain", tag)
        card.addView(k.text(words, 14f), k.gap(4))
        if (state is BrainState.Starting && !busy) card.addView(MunchView(a), k.gap(10))

        val buttons = k.row()
        if (on) {
            buttons.addView(k.button("Show the bot", primary = true, small = true, enabled = !busy) { MiniService.start(a); a.later(400) }, k.wrap(end = 8))
            buttons.addView(k.button("Stop Mini", danger = true, small = true, enabled = !busy) { MiniService.stop(a); a.later(400) }, k.wrap(end = 8))
            buttons.addView(k.button("Restart", small = true, enabled = !busy) { phone.setup.restart(); a.later(400) }, k.wrap())
        } else {
            buttons.addView(k.button("Start Mini", primary = true, small = true, enabled = ready && !busy) { MiniService.start(a); a.later(400) }, k.wrap())
        }
        card.addView(buttons, k.gap(12))
        if (!on && !ready) card.addView(k.muted("Finish the first steps above (Termux, its permission and showing Mini over other apps) to start Mini.", 12f), k.gap(8))
        if (runsNow(state)) card.addView(k.button("Open Claude Code", small = true) { openClaudeCode() }, k.wrap(top = 8))

        val keeper = phone.keeper
        val mode = keeper?.mode ?: if (SharedPrefs(a, "brain").get("mode") == BrainKeeper.DEMAND) BrainKeeper.DEMAND else BrainKeeper.KEEP
        card.addView(
            ChoiceView(a, "Mini's brain", listOf(BrainKeeper.KEEP to "Keep running", BrainKeeper.DEMAND to "Start when asked"), mode, quiet = null) { chosen ->
                if (keeper != null) keeper.mode = chosen else SharedPrefs(a, "brain").put("mode", if (chosen == BrainKeeper.DEMAND) BrainKeeper.DEMAND else null)
                a.refresh()
            },
            k.wrap(top = 14),
        )
        card.addView(k.muted("Start when asked saves battery; the first answer then takes a little longer.", 12f), k.gap(6))
        card.addView(k.muted("Mini on this phone cannot run commands, and reads and writes files only in ~/.mini/work (docs: D14).", 12f), k.gap(10))
        val runtimePort = keeper?.client?.port
        val toolsPort = phone.hands.port
        if (runsNow(state) && runtimePort != null && toolsPort != null) {
            card.addView(k.text("Runtime port $runtimePort · tools port $toolsPort", 11.5f, color = Tone.INK3, mono = true), k.gap(8))
        }
        card.addView(k.muted("Stop ends Mini's session in Termux and closes the bot. Your other Termux sessions are left alone.", 12f), k.gap(8))
        into.addView(card, k.gap(18))
    }

    private fun runsNow(s: BrainState) = s is BrainState.Ready || s is BrainState.NeedsYou || s is BrainState.Starting

    private fun openClaudeCode() {
        Termux.openSession(a)?.let { Toast.makeText(a, it, Toast.LENGTH_LONG).show() }
    }

    /** Puts a line for Termux on the clipboard and opens Termux, for the owner to paste it and press Enter. */
    private fun copyAndOpenTermux(label: String, line: String) {
        a.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(label, line))
        Toast.makeText(a, "Copied. Paste it in Termux and press Enter.", Toast.LENGTH_LONG).show()
        a.packageManager.getLaunchIntentForPackage(Termux.PACKAGE)?.let { a.startActivity(it) }
    }

    /**
     * One step: ✓ done, • not done, ? not known yet. Its button shows only while it is not done, or always with
     * [always]; [note] always shows.
     */
    private fun step(
        into: LinearLayout, label: String, done: Boolean?, action: String?, detail: String? = null,
        note: String? = null, enabled: Boolean = true, always: Boolean = false, onClick: (() -> Unit)? = null,
    ) {
        val row = k.row().apply {
            setPadding(k.dp(14), k.dp(12), k.dp(14), k.dp(12))
            background = k.rounded(Tone.SURFACE, 12)
        }
        val words = k.column()
        words.addView(k.text((if (done == true) "✓  " else if (done == false) "•  " else "?  ") + label, 15f, color = if (done == true) Tone.OK else Tone.INK))
        if (note != null) words.addView(k.muted(note, 12f), k.gap(4))
        if (detail != null && done != true) words.addView(k.muted(detail, 12f).apply { setTextIsSelectable(true) }, k.gap(4))
        row.addView(words, k.fill())
        if ((done != true || always) && action != null && onClick != null) {
            row.addView(k.button(action, small = true, enabled = enabled, onClick = onClick), k.wrap().apply { marginStart = k.dp(8) })
        }
        into.addView(row, k.gap(8))
    }

    private companion object {
        const val DEFAULT_VOICE = "Phone's default"
        const val MIC_WHY = "Mini hears you only while the Talk sheet is open, after you tap Talk."
        const val LOG_MORE = "Termux is set to log more than usual, which can include Mini's keys. In Termux's settings, set the log level to Normal."
        const val LOG_UNKNOWN = "Mini could not read Termux's log level. In Termux's settings, check that it is Normal."
        const val ERROR_REPORTS = "Termux shows error reports by default. If a start ever fails to report back, the report can include Mini's keys; you can turn these off in Termux's settings."
        const val GET_TERMUX = "https://f-droid.org/packages/com.termux/"
        const val PACKAGES = "pkg install nodejs-lts tmux git"
        const val DEBUG_BUILD = "This is Termux's GitHub build. A PC on USB with debugging on can read its files, where your Claude sign-in lives. " +
            "The plan is to move to the F-Droid build: uninstall Termux, install it from F-Droid, then do these steps again (about ten minutes). " +
            "Keep USB debugging off when you are not using it."
    }
}

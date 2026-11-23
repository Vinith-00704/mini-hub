package app.minihub.phone.ui

import android.content.Intent
import android.content.pm.PackageManager
import android.text.Editable
import android.text.TextWatcher
import android.widget.LinearLayout
import app.minihub.phone.MainActivity
import app.minihub.phone.Phone
import app.minihub.phone.ui.look.LookSwitch
import app.minihub.phone.ui.look.MunchView

/**
 * Apps to include (docs/08 > The record): the apps whose notifications Mini reads. Nothing is ticked at first.
 * Opened from Choose apps on the Permissions screen; Back returns there.
 */
class AppsScreen(a: MainActivity, phone: Phone) : Screen(a, phone) {
    override val title = "Apps to include"

    /** A launchable app: its package and the name the launcher shows. */
    private class Entry(val pkg: String, val name: String)

    private var apps: List<Entry>? = null
    private var loading = false
    private var query = ""
    private lateinit var list: LinearLayout

    override fun left() {
        apps = null
        query = ""
    }

    override fun build(into: LinearLayout) {
        into.addView(k.button("Back", small = true) { a.open("permissions") }, k.wrap())
        into.addView(k.muted("Mini reads notifications only from the apps you tick. Chat apps' messages count as Messages; the rest as Other notifications.", 14f), k.gap(12))
        val loaded = apps
        if (loaded == null) {
            load()
            into.addView(MunchView(a), k.gap(16))
            return
        }
        val search = field("Search apps").apply {
            setText(query)
            setSelection(query.length)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, aft: Int) {}
                override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    query = s?.toString() ?: ""
                    list.removeAllViews()
                    fill(loaded)
                }
            })
        }
        into.addView(search, k.gap(12))
        list = k.column()
        into.addView(list, k.gap(12))
        fill(loaded)
    }

    private fun fill(all: List<Entry>) {
        val shown = all.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
        if (shown.isEmpty()) {
            list.addView(k.muted("No apps found.", 14f))
            return
        }
        val chosen = phone.collectors.apps.chosen()
        // The phone app cannot be ticked: calls are read from the call log, so its notifications would record them twice.
        val dialer = phone.collectors.dialer()
        val card = k.card()
        shown.forEachIndexed { i, app ->
            if (i > 0) card.addView(k.divider(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply { topMargin = k.dp(8) })
            val row = k.row()
            if (app.pkg == dialer) {
                val words = k.column()
                words.addView(k.text(app.name, 14f, lines = 2))
                words.addView(k.muted("Calls come from Call history", 12.5f), k.gap(2))
                row.addView(words, k.fill())
            } else {
                row.addView(k.text(app.name, 14f, lines = 2), k.fill())
                row.addView(LookSwitch(a, "Include ${app.name}", app.pkg in chosen) { on -> phone.collectors.apps.set(app.pkg, on) })
            }
            card.addView(row, k.gap(8))
        }
        list.addView(card)
    }

    /** Reads the launchable apps off the main thread, then builds the screen again. */
    private fun load() {
        if (loading) return
        loading = true
        Thread {
            val pm = a.packageManager
            val found = try {
                pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), PackageManager.ResolveInfoFlags.of(0))
                    .map { Entry(it.activityInfo.packageName, it.loadLabel(pm).toString().trim().ifEmpty { it.activityInfo.packageName }) }
                    .filter { it.pkg != a.packageName }
                    .distinctBy { it.pkg }
                    .sortedBy { it.name.lowercase() }
            } catch (e: RuntimeException) {
                emptyList()
            }
            a.runOnUiThread {
                loading = false
                apps = found
                if (!a.isFinishing && !a.isDestroyed) a.refresh()
            }
        }.start()
    }
}

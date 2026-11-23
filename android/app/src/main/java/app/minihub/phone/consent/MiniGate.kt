package app.minihub.phone.consent

import app.minihub.phone.data.NewEvent
import app.minihub.phone.data.Record
import app.minihub.phone.hands.Plan
import org.json.JSONArray
import org.json.JSONObject

/** What the judge says about one tool call. */
sealed interface Gate {
    /** Runs now with the `allowed` scopes; `skipped` are left out, each with its code. */
    data class Go(val allowed: List<String>, val skipped: Map<String, String>) : Gate

    /** Not run at all. */
    data class Refuse(val code: String, val error: String) : Gate

    /** One approval for the whole call: the scopes neither allowed nor skipped are the ones asked about. */
    data class Ask(val allowed: List<String>, val skipped: Map<String, String>) : Gate
}

/**
 * The judge of every tool call Mini's session makes on this phone (docs/03 > Mini's own tools on the phone, docs/08 >
 * The hands endpoint). It is the only place that decides: stopped refuses all; for each scope, Collect off leaves it
 * out as `not-collected`, "Mini on this phone" off leaves it out as `not-allowed`, ask asks the owner, on allows.
 * Every finished call is written once to the phone's log and once to the record as a `mini_action`, with counts only.
 */
class MiniGate(
    private val switches: Switches,
    private val audit: Audit,
    private val record: Record,
    private val stopped: () -> Boolean,
    private val now: () -> Long = System::currentTimeMillis,
) {
    fun check(plan: Plan.Run): Gate {
        if (stopped()) return Gate.Refuse("stopped", STOPPED)
        val allowed = ArrayList<String>()
        val skipped = LinkedHashMap<String, String>()
        var asked = false
        for (scope in plan.scopes.distinct()) {
            val collect = PhoneScopes.collectScope(scope)
            when {
                collect != null && !switches.collect(collect) -> skipped[scope] = "not-collected"
                else -> when (switches.mini(scope)) {
                    Grant.Off -> skipped[scope] = "not-allowed"
                    Grant.Ask -> asked = true
                    Grant.On -> allowed.add(scope)
                }
            }
        }
        if (plan.scopes.isNotEmpty() && skipped.size == plan.scopes.distinct().size) {
            val (scope, code) = skipped.entries.first()
            return Gate.Refuse(code, refusal(scope, code))
        }
        // `important` always asks; "Always allow this" is never offered for a read.
        return if (asked || plan.risk == "important") Gate.Ask(allowed, skipped) else Gate.Go(allowed, skipped)
    }

    /** A finished call of a known tool: one audit row and one `mini_action`. */
    fun finish(plan: Plan.Run, outcome: String, reason: String?, count: Int, approvalId: String?, title: String) =
        finish(plan.tool, plan.action, plan.scopes, plan.risk, outcome, reason, count, approvalId, title)

    /**
     * A finished call, also one with no plan (`unknown-tool`, `bad-args`). `outcome` is "done", "refused" or "failed";
     * `title` and `action` carry counts and kinds only, never a name, a number or a text from the record.
     */
    fun finish(
        tool: String,
        action: String,
        scopes: List<String>,
        risk: String,
        outcome: String,
        reason: String?,
        count: Int,
        approvalId: String?,
        title: String,
    ) {
        val one = scopes.distinct().singleOrNull()
        val detail = when {
            reason != null -> WORDS[reason] ?: reason
            outcome == "done" && tool == "phone_read" -> countWords(count)
            else -> null
        }
        audit.add("Mini", action, one, outcome, detail)
        val data = JSONObject()
            .put("tool", tool)
            .put("risk", risk)
            .put("outcome", outcome)
            .put("on", "phone")
        if (one != null) data.put("scope", one) else if (scopes.isNotEmpty()) data.put("scopes", JSONArray(scopes.distinct()))
        reason?.let { data.put("reason", it) }
        approvalId?.let { data.put("approvalId", it) }
        if (outcome == "done") data.put("count", count)
        record.add(NewEvent(type = "mini_action", occurredAt = now(), app = "Mini", title = title, data = data.toString()))
    }

    companion object {
        const val STOPPED = "Mini is stopped on this phone. The owner starts it again in the Mini app."
        const val SAID_NO = "The owner said no on the phone."
        const val EXPIRED = "No answer on the phone in 2 minutes, so the answer is no."
        const val UNKNOWN_TOOL = "That is not on this phone yet."
        const val FAILED = "The phone could not read that."

        /** The reason words of the phone's log and of `mini_action` titles. */
        val WORDS = mapOf(
            "not-allowed" to "switched off",
            "not-collected" to "not recorded",
            "said-no" to "you said no",
            "expired" to "no answer",
            "stopped" to "stopped",
            "unknown-tool" to "not on this phone",
            "bad-args" to "not understood",
        )

        private fun label(scope: String) = PhoneScopes.find(scope)?.label ?: scope

        /** The exact refusal text for a scope that is left out. */
        fun refusal(scope: String, code: String): String = when (code) {
            // The Collect switch to turn on may be another scope's (Phone status needs Battery and app use).
            "not-collected" -> "${label(PhoneScopes.collectScope(scope) ?: scope)} is not recorded on this phone (Collect is off), so there is nothing to read. The owner can turn it on in the Mini app, under Perms."
            else -> "That is switched off: Mini on this phone is off for ${label(scope)}. The owner can change it in the Mini app, under Perms."
        }

        /** The text for a code that is not about one scope. */
        fun text(code: String): String = when (code) {
            "stopped" -> STOPPED
            "said-no" -> SAID_NO
            "expired" -> EXPIRED
            "unknown-tool" -> UNKNOWN_TOOL
            else -> FAILED
        }

        /** "Refused: read call history (switched off)", "Refused: Mini is stopped". */
        fun refusedTitle(action: String, code: String): String = when (code) {
            "stopped" -> "Refused: Mini is stopped"
            "unknown-tool" -> "Refused: a tool this phone does not have"
            else -> "Refused: $action (${WORDS[code] ?: code})"
        }

        fun countWords(n: Int): String = when (n) {
            0 -> "none found"
            1 -> "1 item"
            else -> "$n items"
        }
    }
}

# Phase 2b: the phone's record — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 2 of `docs/10-build-plan.md`. The phone records calls, SMS, chat messages and other
notifications into its encrypted record, only while the owner has switched each kind on and Android has allowed it,
and hands them to the hub over the link built in Phase 2a. On the hub they fill the Inbox and the calls, messages,
notifications and device-status tiles. Stop Mini on the dashboard reads "Stopped from your PC" on the phone, and
removing the phone stops its sync at once, on both sides. The owner then runs trial T4 and the Phase 2 "Done when"
list on their own devices.

**Architecture:** Three new sources on the phone, all event-driven (no timers, `docs/08` > Staying light): a
`ContentObserver` on the call log, a `ContentObserver` on the SMS store, and a `NotificationListenerService` for
chat apps and other notifications. One coordinator, `Collectors`, starts a source only while its collect switch is
on and its Android permission or access is granted, and stops it when either goes. Every item goes through
`Record` (the only door in), which checks the switch again, trims to the protocol's limits, and folds repeats by a
fingerprint. The link from 2a carries them unchanged: `events` batches with acks. The hub needs no new event path;
it gets small hardening (refusal codes, state replaced not merged, live updates coalesced) and the dashboard gets
the notifications tile, tile states that name the switch or permission that is missing, and small Inbox fixes.

**Tech Stack:** As in 2a. No new libraries on either side.

**Spec:** `docs/08-android-app.md` (What it asks Android for, The record, The app's own screens),
`docs/04-data-and-sync.md` (Event types, What is kept, The link protocol, Whose switches win),
`docs/03-security-and-permissions.md` (Two switches, tests 5, 9, 12, the stop button, logs),
`docs/07-dashboard-design.md` (Inbox, Devices, Widgets), `docs/06-connectors.md` (`android`),
`docs/10-build-plan.md` (Phase 2 "Done when", T4).

## What already exists (built in 2a and the look pass; not planned again)

- **Hub:** `core/src/link/phones.ts` stores `events` batches in one transaction, ignores resent `(device, seq)`,
  answers out-of-order batches with the real position, records gaps; `core/src/events.ts` drops any event whose
  collect switch is off on the hub (`Events.add` returns null); `hub.removeDevice` revokes the token, `link.drop`
  closes the socket (code 4001) and `phones.forget` clears the position; `hub.stopMini` calls `phones.stopAll()`.
  The API (`GET /v1/events`, `/v1/people`, `/v1/stats`, seen, delete) and the live topic `events` exist.
- **Tests 5, 9, 12** pass today: `core/test/link.test.ts` ("a client without a valid token is refused", "a removed
  device's token stops working…"), `core/test/android.test.ts` ("grants are per device…", "removing a phone…",
  "with the hub's collect switch off, nothing of that kind is stored"), `android/.../link/LinkTest.kt` (`PinTest`,
  `FramesTest` on `protocol/examples/link`). The protocol's example files are read by both sides already.
- **Dashboard:** `ui/src/features/inbox/Inbox.tsx` (timeline by day, filters, search, unseen, detail with the
  person's recent items, Delete, Ask Mini with "This shares this item with Mini"); `ui/src/widgets/list.tsx`
  (`EventList`, one-time codes masked by `Masked` in `components/ui/bits.tsx`); `calls.tsx`, `messages.tsx`,
  `device-status.tsx`; Devices and the phone's page; Permissions with collect switches per phone.
- **Phone:** `data/Record.kt` (`add` checks the collect switch), `data/RecordDb.kt` (SQLCipher), `consent/Switches.kt`,
  `link/HubLink.kt`, `link/Sync.kt`, `link/Commands.kt` (`stop` is never refused), `MiniService.stopFromPc()`
  (overlay and notification say "Stopped from your PC"), the screens in `ui/Screens.kt`.

## Global Constraints

- **The owner commits.** No task runs `git commit`, `push`, `stash`, `reset`, `checkout -- …` or anything that
  changes git's index, refs or history.
- **No new test files, no seed, demo, example or test data, no fake records.** The owner tests with their own data.
  Existing suites stay green; when a change alters behaviour an existing test pins, update that test minimally (the
  test helper `android/app/src/test/.../data/MemoryRecordStore.kt` is updated only to implement changed interface
  methods). The checks are run, not skipped.
- **Every collector starts off.** A source runs only while (a) its collect switch is on and (b) Android's permission
  or access for it is granted by the owner. When either is missing it is not registered: no observer, no query, no
  storing, no sending. `Record.add` checks the switch again for every item.
- **Collecting starts from the moment the switch is turned on.** No history is imported: not older calls, not
  older SMS, not notifications already on screen. Calls and SMS that happen while the app is not running, with the
  switch on, are caught up at the next start.
- **Turned off means not sent.** Events of a kind whose switch is now off are not sent, even if stored before; the
  phone reports them as a gap and keeps them in its own Record until the 7-day cleanup or the owner deletes them.
- **Permission requests only from a button the owner presses** on the phone's Permissions screen, with one
  sentence on why. Notification access, "Allow restricted settings" and app settings are opened, never toggled. No
  script, test or `adb` command grants a permission or clicks a consent surface.
- **Limits, as the protocol's** (`protocol/src/events.ts`): `who`, `whoKey`, `app` at most 200 UTF-16 units,
  `title` 300, `body` 20,000. An `events` frame holds at most 200 items **and** at most 512,000 characters of JSON
  (the hub's frame limit is 4 MiB). Truncation never splits a surrogate pair.
- **Repeats are folded** by a fingerprint: hex of SHA-256 over the parts joined by `\u0001`, first 32 characters,
  kept in the phone's `seen` table for 7 days. Calls `call|<_ID>`, SMS `sms|<_ID>`, chat
  `chat|<package>|<conversation>|<sender>|<message time>|<text>`, other notifications
  `note|<package>|<notification key>|<title>|<text>`.
- **One-time codes are masked in lists** on both sides with the same rule: if the text matches
  `\b(otp|code|pin|passcode|verification)\b` (any case), every `\b\d{4,8}\b` in it shows as `••••••`. The full text
  shows when the owner selects the item (dashboard) or taps the row (phone).
- **Logs** (pino on the hub, `android.util.Log` on the phone) never contain a phone number, a name, a message or
  notification text, a conversation title, a token or a pairing code. Package names and counts are fine.
- **Never skipped:** a `stop` frame. **Always skipped:** the app's own notifications, ongoing notifications
  (music, navigation, downloads, foreground services), group summaries, and the owner's own messages inside a chat
  notification.
- **Phone retention:** events already acked by the hub are deleted from the phone after 7 days (`docs/04`).
- **Live updates:** the hub sends the dashboard at most one `events` topic per 250 ms (first one at once, one more
  at the end of a burst). A new call, SMS or chat shows on the dashboard within 5 seconds while linked.
- **Words** are plain and short, sentence case, no exclamation marks. Exact strings are given in the tasks.
- **The look:** dashboard parts from `ui/src/components/look/` and tokens from `design/tokens.json`; phone parts from
  `ui/look/` and `ui/Kit.kt`. Every tile and screen handles loading, empty, error and "not allowed".
- **Made-up values only** in code, comments and docs: `+1 555 01xx`, `example.com`, `Asha Example`.
- **Project facts:** Node 24 type stripping (no enums, parameter properties or namespaces; `.ts` imports). Android
  Views, minSdk 33, targetSdk 36, SQLCipher `rawQuery(sql, *args)`. In Git Bash, write files with the editor tools.
- **Checks** (run what the task touches; all of them in Task 9):
  `cd /f/mini-hub && npm run check` · `npm test` · `npm run build -w @minihub/ui` ·
  `cd /f/mini-hub/android && ./gradlew :app:testDebugUnitTest :app:assembleRelease`.

**Rulings made while planning** (the owner may want to know; each changes a doc in the task named):

- SMS are read from Android's SMS store with `READ_SMS` and a content observer, which sees received and sent SMS
  alike; `RECEIVE_SMS` is not asked for. MMS are not recorded. (`docs/08`, Task 5)
- Names for SMS come from contacts only if the owner presses "Allow contacts"; calls carry the call log's own name.
  The SIM slot (`sim`) is not recorded: it needs another permission. (`docs/04`, `docs/08`, Tasks 1 and 5)
- One list of apps on the phone, "Apps to include", nothing ticked at first, decides which apps' notifications are
  read at all; a ticked app's messaging notifications become `chat` (under Messages), the rest `notification`.
  Ongoing notifications are never recorded, whatever is ticked. (`docs/08`, Task 6)
- Trial T4 is run with this phase's real build (0.4.0) instead of a throwaway trial app: one install on the
  nearly-full phone, and what cannot be read is taken out, as T4 says. Installed with `adb install -r`, which lets
  Android grant the call log and SMS permissions to a hand-installed app. (`docs/10` results, Task 9)
- The hub never refuses an event over the shape of its `data`: a refusal would stall the phone's sync. The shapes
  are documented in `protocol/src/events.ts` for both sides to follow. (Task 1)
- Deferred, said plainly: the phone's 200 MB cap on events not yet handed over; binding the socket to the Wi-Fi
  network (2a minor 10); widget settings ("which apps", "missed only") wait for Phase 4's edit mode.

## Review Focus

1. **RF1 Off means nothing:** with a switch off, or its permission missing, nothing of that kind is read, stored or
   sent, including items stored before it went off (Tasks 4, 5, 6).
2. **RF2 Nothing twice:** a chat app re-posting a growing notification, an observer firing twice, the app
   restarting, a reconnect mid-batch: each call, SMS and message is stored once on each side (Tasks 4, 5, 6).
3. **RF3 Nothing stalls the sync:** a 30,000-character message, emoji, a private number, an alphanumeric sender, a
   batch of 200 long messages: always acked (Tasks 1, 4).
4. **RF4 Refused or removed:** a permission revoked in Android's settings while recording, notification access
   turned off, the phone removed on the dashboard: no crash, and the screen says what happened (Tasks 5, 6, 7).
5. **RF5 No private text in logs:** no `Log.*` or pino line carries a number, a name or a text (all tasks).

---

### Task 1: Protocol: event data shapes, refusal codes, what the phone still needs

**Files:** modify `protocol/src/events.ts`, `protocol/src/link.ts`, `docs/04-data-and-sync.md`. No example files are
added or changed.

**Interfaces — Produces:**

```ts
// protocol/src/events.ts
export const CALL_DIRECTIONS = ['in', 'out', 'missed', 'rejected'] as const
export const callData = z.looseObject({ direction: z.enum(CALL_DIRECTIONS), seconds: z.number().int().nonnegative() })
export const smsData = z.looseObject({ direction: z.enum(['in', 'out']), thread: z.string().max(40) })
export const chatData = z.looseObject({ conversation: z.string().max(MAX_WHO).optional(), canReply: z.boolean(),
  notificationKey: z.string().max(300), package: z.string().max(200), group: z.boolean() })
export const notificationData = z.looseObject({ category: z.string().max(60).optional(), ongoing: z.boolean(),
  package: z.string().max(200), notificationKey: z.string().max(300) })
export const EVENT_DATA = { call: callData, sms: smsData, chat: chatData, notification: notificationData } as const
export type CallData = z.infer<typeof callData>   // and SmsData, ChatData, NotificationData

// protocol/src/link.ts
export const REFUSED_CODES = ['not-paired', 'locked-out', 'bad-frame'] as const
export const NEEDS = ['permission', 'notification-access', 'apps'] as const
// refused gains  code: z.enum(REFUSED_CODES).optional()
// state gains    needs: z.partialRecord(scopeKey, z.enum(NEEDS)).optional()
```

Behaviour: `newEventSchema` and `linkEvent` are unchanged (data stays `record<string, unknown>`); the shapes are a
contract, not a gate (see Rulings). `needs[scope]` is set by the phone only when that kind's collect switch is on
and **no** source of it can run; the value is the first thing missing in the order permission, notification access,
apps. A `refused` without `code` means `not-paired` (older hubs).

**docs/04 changes (this task):** in "Event types", the `data_json` column for `call` becomes `direction`
in/out/missed/rejected, `seconds`; `sms` stays `direction`, `thread`; `chat` gains `package`, `group`; `notification`
gains `package`, `notificationKey`, and `ongoing` is always false. Under "The link protocol": `refused { reason,
code? }` with the three codes and what the phone does with each (Task 7); the state frame's `needs`; a gap's reason
can be "deleted or not shared on the phone before it was sent".

- [ ] Implement the schemas and exports above; keep every existing export.
- [ ] Update `docs/04` as listed.
- [ ] Run `npm run check` and `npm test` — Expected: PASS (every existing link example still parses on the hub).

### Task 2: Hub: refusal codes, state replaced not merged, live updates coalesced

**Files:** modify `core/src/link/server.ts`, `core/src/link/phones.ts`, `core/src/hub.ts`. Existing tests in
`core/test/link.test.ts` and `core/test/android.test.ts` are updated only if they pin what changes.

**Interfaces — Consumes:** Task 1's `REFUSED_CODES`, `NEEDS`. **Produces:** no new routes; `device.state.needs`
(from the phone's state frame) for the dashboard.

Behaviour:

- `DeviceLink.#refuse(c, reason, code?)` sends `{ t: 'refused', reason, code }`. Codes: the lock-out after five wrong
  tokens → `locked-out`; a wrong or unknown token, or a removed device → `not-paired`; "Say hello first" and a frame
  that does not parse before hello → `bad-frame`. Pairing refusals (`PairSocket.refuse`) carry no code. Reasons stay
  word for word as they are.
- `Phones.#frame` on `state`: the shared fields are replaced, not merged, so a phone that stops sharing battery no
  longer shows its old battery (2a minor 14): `setState(id, { battery: null, charging: null, network: null,
  needs: {}, ...state, online: true })`. `collect` is still taken out of the state and followed as now. Check that
  `ui/src/features/devices/facts.ts` reads `null` as "not reported" (it tests `typeof … === 'number'`).
- `hub.ts`: the `events` live topic is coalesced: the first `events` in a quiet period is emitted at once, further
  ones within 250 ms set a flag, and one more is emitted when the 250 ms timer ends if the flag is set. The timer is
  `unref()`ed and cleared in `close()`. Other topics are unchanged. A phone catching up 10,000 events then costs the
  dashboard a handful of refetches, not 10,000.
- Nothing else in the sync changes: Tests 5, 9 and 12 keep passing as they are.

Edge cases: a `state` frame from a phone on 2a's app (no `needs`) gives `needs: {}`; a locked-out address still gets
its refusal before any hello (the code tells the phone to wait, Task 7).

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS, including link.test.ts, android.test.ts and the
  api.test.ts person-only table.

### Task 3: Dashboard: the notifications tile, tiles that say what is missing, Inbox and phone page

**Files:** create `ui/src/widgets/notifications.tsx`; modify `ui/src/widgets/list.tsx`, `ui/src/widgets/calls.tsx`,
`ui/src/widgets/messages.tsx`, `ui/src/features/home/Home.tsx`, `ui/src/features/inbox/Inbox.tsx`,
`ui/src/features/devices/DevicePage.tsx`, `ui/src/features/permissions/Permissions.tsx` (its row component, which
the phone's page reuses), `ui/src/app/queries.ts` (types only).

**Interfaces — Consumes:** `GET /v1/grants` rows (`target`, `scope`, `collect`), `GET /v1/devices`
(`state.needs`), `GET /v1/events`. **Produces:** `NotificationsTile`; `EventList` props gain `scope: string` and
`label: string` (the scope's words, e.g. "Call history"); `type Needs = Partial<Record<string, 'permission' |
'notification-access' | 'apps'>>` in `queries.ts`.

Behaviour:

- `EventList` state, in this order: events loading → `loading`; events error → `error`; any items → `ready` (even if
  the switch is now off: what came is shown). With no items: if the grants have loaded and there is **no** row for
  `scope` (no phone paired) → `not-connected` with the tile's `notConnected` text; if every row for `scope` has
  `collect: false` → `not-allowed`, text "`<label>` is not collected. Turn it on in Permissions." and the button
  "Open Permissions" (`#/permissions`); if a collecting phone reports `state.needs[scope]` → `empty` with the need's
  line (below); otherwise `empty`, "Nothing yet." If the grants request failed, fall back to today's behaviour
  (`not-connected` when `notConnected` is given). Keep the exported `NOTHING_YET` constant.
- Need lines (tiles, and under the collect switch of a phone's row in Permissions and on the phone's page):
  `permission` → "On, but the phone still needs Android's permission. Allow it in Mini on the phone, under Perms.";
  `notification-access` → "On, but notification access is off on the phone. Turn it on from Mini on the phone,
  under Perms."; `apps` → "On, but no apps are chosen on the phone. Choose them in Mini on the phone, under Perms."
- Not-connected texts: Calls "Calls arrive from your phone once it is paired. Pair it in Devices."; Messages "SMS and
  chat messages arrive from your phone once it is paired. Pair it in Devices."; Notifications "Notifications arrive
  from your phone once it is paired. Pair it in Devices." (The existing test matching `/Calls arrive from your
  phone/` stays green.)
- `NotificationsTile`: `EventList` with `types={['notification']}`, `scope="phone.notifications.read"`,
  `label="Other notifications"`, `inbox="notifications"`, a `Bell` icon, `limit={6}`; each line: who = `e.app ??
  'Notification'`, text = `title: body` when both exist and differ, else whichever exists.
- `CallsTile`: `scope="phone.calls.read"`, `label="Call history"`; a missed call keeps the warn tone.
  `MessagesTile`: `scope="phone.messages.read"`, `label="Messages (SMS and chat apps)"`; a chat in a group shows
  who as `<sender> · <conversation>` when `data.conversation` differs from the sender.
- Home: the last row becomes Calls (`min-[1100px]:col-span-3`), Messages (`col-span-6`), Notifications
  (`col-span-3`); below 1100 px each is 6 columns, below 700 px 12, as now.
- Inbox: the list line for a notification uses the same "title: body" text and its app as the name; a group chat
  line uses `<sender> · <conversation>`; the Inbox reads an optional `device` search parameter as its device filter.
  One-time codes stay masked in the list (`Masked`); the detail pane shows the full text.
- The phone's page gains **Recent from this phone**: the last 8 calls, SMS, chats and notifications from that device
  (`useEvents({ device: id, type: [...], limit: '8' })`), one `Row` each with `Masked` text and time, empty "Nothing
  from this phone yet.", and "All in Inbox →" to `#/inbox?device=<id>`. `docs/07` > Devices already asks for it.

Edge cases: two phones, one collecting and one not → the tile is `empty`, not `not-allowed`; privacy mode blurs the
new tile's text as the others do; very long or right-to-left text truncates as in the messages tile.

- [ ] Implement, in both themes, with the look's parts only.
- [ ] Run `npm run check`, `npm test` and `npm run build -w @minihub/ui` — Expected: PASS.
- [ ] Look at Home, the Inbox and the phone's page in both themes on a scratch hub (`node tools/dev.mjs` with a
  temporary `MINI_HUB_HOME`), with whatever it already holds; add no data to it.

### Task 4: Phone: the record's groundwork — limits, folding, filtered sending, cleanup, masking

**Files:** modify `android/app/src/main/java/app/minihub/phone/data/{Record.kt, RecordDb.kt}`,
`link/{Sync.kt, Frames.kt, HubLink.kt}`, `ui/Lines.kt`; update the test helper `data/MemoryRecordStore.kt` only to
implement the changed `RecordStore` methods.

**Interfaces — Produces:**

```kotlin
interface RecordStore {                                     // existing members kept, except `after`:
    fun after(seq: Long, limit: Int, types: Set<String>): List<StoredEvent>   // only rows whose type is in `types`
    fun insertOnce(fp: String, at: Long, e: NewEvent): Long?                  // null if `fp` is already in `seen`
    fun prune(ackedUpTo: Long, before: Long): Int                             // events seq <= ackedUpTo and occurred_at < before; seen rows at < before
}
class Record {
    fun add(e: NewEvent): Long?                    // as now, plus trimming to the limits
    fun addOnce(fp: String, e: NewEvent): Long?    // switch checked first (off: nothing written, not even the fingerprint), then folded
    fun after(seq: Long, limit: Int): List<StoredEvent>   // passes the types whose scope is collected now, plus "mini_action"
    fun prune(ackedUpTo: Long, now: Long): Int     // 7 days
    companion object { const val KEEP_MS = 7 * 86_400_000L; fun fingerprint(vararg parts: String?): String }
}
class Sync(after, latest, private val size: (StoredEvent) -> Int = { 0 }, private val maxChars: Int = 512_000)
object Frames { fun eventSize(e: StoredEvent): Int }       // length of the item's JSON text
object Lines { fun mask(text: String): String }            // the one-time-code rule in Global Constraints
```

Behaviour:

- `RecordDb` goes to database version 2: `onCreate` and `onUpgrade(old < 2)` create `seen (fp TEXT PRIMARY KEY, at
  INTEGER NOT NULL)`. `insertOnce` inserts the fingerprint and the event in one transaction.
- Trimming in `Record`: `who`, `whoKey`, `app` to 200, `title` to 300, `body` to 20,000, never splitting a surrogate
  pair (if the last kept char is a high surrogate, drop it).
- `Record.after` filters in SQL (`type IN (…)`), never after the query, so 200 filtered-out rows cannot hide the
  rest. The existing `Sync` logic then reports the hole as a gap. `Sync.DELETED`'s text becomes "deleted or not
  shared on the phone before it was sent".
- `Sync.next()` takes consecutive items while their running `size` stays within `maxChars`, always at least one.
  `HubLink` builds its `Sync` with `Frames::eventSize`.
- `HubLink` keeps the hub's last acked number in its preferences (`acked`, reset to 0 by `forget()`) and, on an ack,
  runs `record.prune(acked, now)` when the last cleanup (`prunedAt`) is more than 24 hours old. No timer.

Edge cases: **RF3** a body of 30,000 characters is cut to 20,000 and acked; a batch of 200 events of 20,000
characters goes as several frames; **RF1** an event stored while its switch was on and not yet sent is not sent
after the switch goes off; **RF2** `addOnce` with a fingerprint seen 6 days ago is folded, one seen 8 days ago (after
the cleanup) is new.

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest` — Expected: PASS (SyncTest and SwitchesTest unchanged).

### Task 5: Phone: calls and SMS, the collectors' coordinator, the service's record part

**Files:** create `collect/{Collectors.kt, CallLogCollector.kt, SmsCollector.kt, Numbers.kt}`; modify `Phone.kt`,
`MiniService.kt`, `MainActivity.kt`, `AndroidManifest.xml`, `docs/08-android-app.md`.

**Interfaces — Consumes:** Task 4's `Record.addOnce`, `Record.fingerprint`. **Produces:**

```kotlin
enum class Need(val wire: String) { Permission("permission"), NotificationAccess("notification-access"), Apps("apps") }
data class SourceStatus(val name: String, val running: Boolean, val need: Need?, val permission: String? = null)
class Collectors(context: Context, record: Record, switches: Switches, prefs: Prefs /* SharedPrefs(app, "collect") */) {
    fun start()                                // idempotent; follows switches.onChange and refresh()
    fun stop()
    fun refresh()                              // re-checks permissions and access: app resume, a permission answer
    fun status(scope: String): List<SourceStatus>   // for the Permissions screen
    fun needs(): Map<String, String>           // for the state frame (Task 7): scope -> Need.wire, per Task 1's rule
    fun recording(): List<String>              // "calls", "messages", "notifications": for the notification text
    fun anyOn(): Boolean                       // any of the three collect switches on
    fun onChange(fn: () -> Unit): () -> Unit
}
object Numbers { fun key(raw: String, countryIso: String): String?; fun name(context: Context, number: String): String? }
```

`Phone` gains `val collectors` and `fun startRecording()` (= `collectors.start()`). Sources: "Call log"
(`phone.calls.read`, `READ_CALL_LOG`) and "SMS" (`phone.messages.read`, `READ_SMS`); Task 6 adds "Chat apps" and
"Notifications". All work runs on one `HandlerThread` ("mini-collect"); an observer's change is debounced 1.5 s,
then the source catches up.

Behaviour:

- **Turning on.** On a switch's off→on change (on the phone or from the hub), the source's `since` (prefs
  `calls:since`, `sms:since`) is set to now. Catch-up reads only rows with `DATE >= since` and `_ID > lastId`, in
  `_ID` order, 500 at a time. The switch going off unregisters the observer at once.
- **Calls** (`CallLog.Calls`): `_ID, NUMBER, NUMBER_PRESENTATION, CACHED_NAME, TYPE, DATE, DURATION`. `TYPE` →
  direction: INCOMING and ANSWERED_EXTERNALLY `in`, OUTGOING `out`, MISSED and VOICEMAIL `missed`, REJECTED and
  BLOCKED `rejected`. Event: `type "call"`, `occurredAt DATE`, `who` = `CACHED_NAME` ?? contact name ?? the number
  (a presentation other than ALLOWED: "Private number", no `whoKey`), `whoKey` = `Numbers.key`, `app "Phone"`,
  `title` "Missed call" / "Declined call" / "Incoming, 4 min" / "Outgoing, 30 s" (under 60 s in seconds, else whole
  minutes rounded, at least 1), `data { direction, seconds }`, fingerprint `call|<_ID>`.
- **SMS** (`Telephony.Sms`): `_ID, ADDRESS, BODY, DATE, TYPE, THREAD_ID`; only TYPE 1 (`in`) and 2 (`out`) are
  recorded; draft and failed are passed over; while an outbox or queued row (4, 6) is waiting, `lastId` stops below
  it so the row is seen again once sent (the fingerprint `sms|<_ID>` folds the rest). Event: `type "sms"`, `who` =
  contact name (only if `READ_CONTACTS` is granted) ?? the address, `whoKey` = `Numbers.key`, `app "SMS"`, `title` =
  who, `body` = the text, `data { direction, thread }`.
- `Numbers.key`: `PhoneNumberUtils.formatNumberToE164(raw, iso)` with the country from `TelephonyManager`
  (`networkCountryIso`, else `simCountryIso`, upper case); failing that `+` and digits if it has 5 or more digits;
  an alphanumeric sender is lower-cased and trimmed. `Numbers.name` uses `PhoneLookup` and returns null without
  `READ_CONTACTS`.
- **Permissions:** checked before every query; a `SecurityException` stops the source and its status says
  `Need.Permission` (**RF4**). Nothing here asks Android for anything; Task 8's buttons do.
- **The service's record part:** `MiniService` keeps running while the bot is on, a hub is paired, **or**
  `collectors.anyOn()`; it calls `phone.startRecording()` in `onStartCommand`; when none of the three is true it
  stops itself (the `ACTION_LINK` path). `MainActivity.onCreate` starts it when a hub is paired or
  `collectors.anyOn()`; `onRequestPermissionsResult` and `onResume` call `phone.collectors.refresh()`. A collect
  switch turned on while the service is down starts it (`Collectors.onChange` in `Phone` → `MiniService.startLink`).
- The notification's text puts the record first: "Mini: recording calls and messages · linked to your PC · bot on"
  (built from `recording()`; nothing recorded leaves that part out).
- **Manifest:** `READ_CALL_LOG`, `READ_SMS`, `READ_CONTACTS`; the special-use subtype text becomes "Keeps the owner's
  floating assistant (Mini) and its record of the phone's calls, messages and notifications running, until the
  owner stops it."
- **docs/08 changes (this task):** the permissions table (`READ_SMS` only; `READ_CONTACTS` asked from its own
  button, for names of SMS senders); "The record" table (SMS read from the SMS store as they are written, received
  and sent alike; MMS not recorded; collecting starts when the switch is turned on; calls and SMS missed while the
  app was not running are caught up at its next start); the foreground service runs while anything is recorded.

Edge cases: **RF2** the observer fires three times for one call → one event; the app is killed between two calls
→ both recorded at the next start, with their real times; **RF4** the owner revokes the call log permission in
Android's settings while recording → the source stops, no crash; the phone's clock moves back → `_ID` still leads.
**RF5**: no `Log` line names a number, a name or a text.

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease` — Expected: PASS and an APK.

### Task 6: Phone: chat messages and other notifications

**Files:** create `collect/{NotesListener.kt, Notes.kt, Apps.kt}`; modify `collect/Collectors.kt`,
`AndroidManifest.xml`, `docs/08-android-app.md`.

**Interfaces — Consumes:** Task 5's `Collectors`, Task 4's `Record.addOnce`. **Produces:**

```kotlin
class NotesListener : NotificationListenerService()      // hands every posted notification to phone.collectors.onNote(sbn)
object Notes { fun read(sbn: StatusBarNotification, label: String): List<Pair<String, NewEvent>> }   // fingerprint to event
class Apps(prefs: Prefs) { fun chosen(): Set<String>; fun set(pkg: String, on: Boolean); fun onChange(fn: () -> Unit): () -> Unit }
// Collectors gains: val apps: Apps; fun onNote(sbn); fun notesComponent(): ComponentName; fun notesAccess(): Boolean
```

Behaviour:

- **Manifest:** `<service android:name=".collect.NotesListener" android:exported="true" android:enabled="false"
  android:label="Mini" android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">` with the
  `android.service.notification.NotificationListenerService` intent filter; and in `<queries>` an intent for
  `MAIN`/`LAUNCHER`, so the app list and app names can be read.
- **Registered only while needed:** `Collectors` enables the component (`setComponentEnabledSetting … ENABLED,
  DONT_KILL_APP`, then `NotificationListenerService.requestRebind`) while Messages or Other notifications is
  collected, and disables it when both are off, so Android unbinds it. If, on the phone, disabling the component
  turns the owner's notification access off for good, keep the component enabled and call `requestUnbind()` from
  the listener instead, and write the ruling in the ledger. `notesAccess()` =
  `NotificationManager.isNotificationListenerAccessGranted(notesComponent())`.
- **What is read** (`onNote`, every notification, cheaply): skip unless the package is in `apps.chosen()`; skip the
  app's own package; skip `isOngoing`, `FLAG_FOREGROUND_SERVICE` and `FLAG_GROUP_SUMMARY`; skip when neither title
  nor text is present. A notification is a **chat** when its template is `Notification$MessagingStyle` or its
  category is `CATEGORY_MESSAGE`; else a **notification**. A chat is kept only while Messages is collected, a
  notification only while Other notifications is collected; a chat is never stored as a notification.
- **Chat** (MessagingStyle): from `EXTRA_MESSAGES` (each bundle: `text`, `time`, `sender`, or `sender_person` as
  `android.app.Person`); `EXTRA_HISTORIC_MESSAGES` is not read; a message with no sender is the owner's own and is
  skipped. `conversation` = `EXTRA_CONVERSATION_TITLE`, `group` = `EXTRA_IS_GROUP_CONVERSATION`. Without
  MessagingStyle: sender `EXTRA_TITLE`, text `EXTRA_BIG_TEXT` ?? `EXTRA_TEXT`, time `postTime`. Event: `type "chat"`,
  `who` sender, `whoKey` = `Numbers.key` of a `tel:` person URI, else `<package>:<sender lower case>`, `app` = the
  app's label, `title` = conversation ?? sender, `body` text, `data { conversation, canReply, notificationKey:
  sbn.key, package, group }`; `canReply` = an action with a free-form `RemoteInput`.
- **Notification:** `type "notification"`, no `who`, `app` label, `title` `EXTRA_TITLE`, `body` `EXTRA_BIG_TEXT` ??
  `EXTRA_TEXT`, `occurredAt postTime`, `data { category, ongoing: false, package, notificationKey }`.
- Fingerprints as in Global Constraints; a re-post with the same text is folded, a changed text is a new event.
  Nothing is read from notifications already showing when access is granted or a switch is turned on.
- Status for the Permissions screen: "Chat apps" (Messages) and "Notifications" (Other notifications), each with
  `Need.NotificationAccess` when access is off, else `Need.Apps` when nothing is chosen.
- **docs/08 changes (this task):** "The record" > Chats and Other notifications: one "Apps to include" list,
  nothing ticked at first; ongoing notifications, group summaries and the owner's own messages are never recorded
  (replaces "skipped unless the owner includes that app"); the listener is enabled only while one of its two
  switches is on.

Edge cases: **RF2** a chat app re-posts the whole conversation with each new message → only the new message is
stored; the same message in two notifications (bundled and single) → once; **RF4** notification access turned off
in Settings while recording → the status says so on the next refresh, no crash; an app uninstalled while chosen →
dropped from the list quietly; a sender name with emoji, or a 10,000-character message → stored (trimmed by Task 4).

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease` — Expected: PASS and an APK.

### Task 7: Phone: the link's refusals, the phone's switches winning, "Stopped from your PC"

**Files:** modify `link/{Frames.kt, HubLink.kt}`, `Phone.kt`, `MiniService.kt`, `ui/Screens.kt` (HomeScreen only).

**Interfaces — Consumes:** Task 1's codes and `needs`, Task 5's `collectors.needs()`. **Produces:**
`Frame.Refused(reason: String, code: String? = null)`; `Frame.State(…, needs: Map<String, String> = emptyMap())`
(sent only when not empty); `Phone.stoppedBy: String?` (`"pc"`, `"phone"` or null, kept in prefs with `stopped`).

Behaviour:

- **Removed:** the hub closing with code 4001 (`onClosing`) sets `LinkStatus.Refused("Your PC removed this phone.
  Pair again to link it.")` at once, with no reconnect, and writes the phone's audit row ("Your PC", "remove this
  phone", "done"). Recording goes on; nothing more is sent.
- **Refusal codes:** `not-paired` (or no code) → `Refused(reason)`, no retry, as now; `locked-out` → status
  `NotAtHome`, one retry after 10 minutes; `bad-frame` → the normal backoff (2a minor 9).
- **The phone's switches win (2a minor 8):** when `switches.applyFromHub` refuses a `settings` frame because the
  phone is locked, the phone sends its state frame at once, so the hub's copy follows the phone instead of dropping
  that kind.
- **What is missing:** `stateFrame()` adds `needs = collectors.needs()`; `Collectors.onChange` sends the state
  again, so the dashboard's need lines (Task 3) follow the phone within a second while linked.
- **Stopped from your PC:** `MiniService.stopFromPc` sets `stopped = true`, `stoppedBy = "pc"`, and ends Mini's
  session only if one is running (no Termux command when the bot is off). Any stop on the phone sets `"phone"`;
  starting Mini clears both. HomeScreen: with `"pc"` the head reads "Stopped from your PC" and the line "Mini on this
  phone is stopped. Start Mini to resume here."; with `"phone"`, "Mini is stopped" and "Start Mini to resume." The
  notification's text keeps "stopped from your PC" first while `stoppedBy == "pc"` (it is no longer replaced by the
  next link change).

Edge cases: **RF4** removal while a batch is in flight → nothing more is sent, no crash; a hub from 2a without codes
→ treated as now; Stop from the PC with the bot off and the app closed (only the record part running) → the
notification and Home say "Stopped from your PC".

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease` — Expected: PASS (FramesTest's round trip of
  every valid example still holds).

### Task 8: Phone: the Permissions screen's buttons, "Apps to include", the Record screen

**Files:** create `ui/AppsScreen.kt`; modify `ui/Screens.kt` (PermissionsScreen, RecordScreen), `MainActivity.kt`
(register `"apps"`, request codes), `android/app/build.gradle.kts` (`versionCode = 4`, `versionName = "0.4.0"`).

**Interfaces — Consumes:** `phone.collectors.status(scope)`, `Need`, `collectors.apps`, `notesComponent()`,
`Lines.mask`.

Behaviour, per `docs/08` > The app's own screens, in the look (`k.card`, `LookSwitch`, `k.button`, `k.muted`):

- **Permissions:** the "Not collected by this version yet" line goes from calls, messages and notifications (it
  stays on Location). Under each collect switch, one line per source from `status()`, and the button for the first
  thing missing, shown only while the switch is on:
  - Permission: "Android has not allowed Mini to read the call log yet." (or "…your SMS yet.") with **Allow**, which
    calls `requestPermissions` for that one permission. After a refusal that Android will not ask again (no
    rationale, asked before; prefs `asked:<permission>`): "Android will not ask again. Allow it in Mini's app
    settings, under Permissions." with **Open app settings** (`ACTION_APPLICATION_DETAILS_SETTINGS`).
  - Notification access: "Notification access is off. Turn on Mini in Android's list." with **Open notification
    access** (`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with the component, else
    `ACTION_NOTIFICATION_LISTENER_SETTINGS`), and below it, small: "If Android says this setting is restricted: open
    Mini's app info, tap ⋮, Allow restricted settings, then try again."
  - Apps: "No apps chosen yet. Mini reads notifications only from apps you choose." with **Choose apps**.
  - Running: "Recording calls." / "Recording SMS." / "Recording from 3 apps." with **Choose apps** for the last.
  - Under Messages, while SMS is running and contacts are not allowed: "To show names for SMS, allow contacts. They
    are used only on this phone." with **Allow contacts** (`READ_CONTACTS`).
  - Each button's sentence on why: "Mini reads this only while Collect is on, and keeps it on this phone until it
    goes to your PC."
- **Apps to include** (`AppsScreen`, opened from Choose apps, back to Permissions): "Mini reads notifications only
  from the apps you tick. Chat apps' messages count as Messages; the rest as Other notifications." A search field,
  then every launchable app except Mini, by name, each with a `LookSwitch` ("Include <name>"). Loading shows the
  munching loader; no apps → "No apps found."
- **Record:** a list line's text goes through `Lines.mask`; tapping a masked line shows it in full until the screen
  is left. Calls show their title ("Missed call"); notifications "title: text".
- The screen refreshes on resume and after a permission answer (`collectors.refresh()`), so a grant made in
  Android's settings shows when the owner comes back.

Edge cases: a permission granted and later revoked shows Allow again; the switch turned on from the dashboard while
the permission is missing shows the Allow line next time the screen opens; a 360 dp wide phone: buttons wrap under
their line, nothing is cut off.

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease` — Expected: PASS and a signed release APK 0.4.0.

### Task 9: Checks, review, install, and the owner's trial

Not a code task beyond fixes found here; the owner is at both devices for the trial.

- [ ] Run every check in Global Constraints; all PASS. Run the secrets search of `03` > "Keeping the repository
  clean" over the tracked files and look at every hit.
- [ ] Final review of Tasks 1–8 against the Review Focus (RF1–RF5) and the Global Constraints; one fix pass; write
  the rulings and deferred minors in the ledger `.superpowers/sdd/2026-11-23-phone-record/progress.md`.
- [ ] With the owner's go-ahead, install the release APK over 0.3.0: `adb install -r app-release.apk` (keeps the
  record and the pairing). Nothing is typed into the phone; no permission is granted by `adb`.
- [ ] The owner's steps below, with the owner. Write down what was seen, then update `docs/10` > "Results so far"
  with T4's result (what was read correctly, what could not be read, whether Android asked for restricted
  settings), and take anything that cannot be read out of the plan, telling the owner.
- [ ] The phase report (`docs/10` > What a phase report says): each "Done when" line and how it was checked; what
  was verified on the devices and what only by the checks; battery and memory against `08`'s targets.

## Owner steps

Only the owner can do these; nothing in this plan does them for the owner.

1. **Install.** Say yes to installing 0.4.0 over the current app (the controller runs `adb install -r`). If the app
   is ever installed by opening the APK on the phone instead, Android may hold back the call log, SMS and
   notification access until "Allow restricted settings" (Mini's app info > ⋮).
2. **Choose what to record**, on the phone (Perms) or the dashboard (Permissions): Collect for Call history,
   Messages, Other notifications. Each starts off.
3. **Grant Android's permissions**, from the buttons on the phone's Perms screen: Allow (call log), Allow (SMS),
   and, if wanted, Allow contacts.
4. **Notification access:** press Open notification access and turn Mini on in Android's list; then Choose apps and
   tick the chat apps (the two main ones) and any others to record.
5. **Trial T4 and the "Done when" checks**, while linked at home: one real call (answered and missed), one SMS each
   way, one message in each of the two main chat apps (one in a group). Each should appear in the phone's Record
   and on the dashboard (Inbox and tiles) within 5 seconds, with the right sender, conversation and text, and once
   only. Then turn one switch off and check nothing of that kind arrives on either side.
6. **Stop and remove:** press Stop Mini on the dashboard and see "Stopped from your PC" on the phone; Resume on the
   dashboard and start Mini on the phone. Removing the phone (on a scratch hub, or when the owner chooses) shows
   "Your PC removed this phone." and nothing more arrives.
7. **A day with the PC off:** leave the PC off for a day with the phone recording; at home, switch it on and check
   everything arrives in order, nothing twice.
8. **Two days of normal use:** check the phone's battery use for Mini (Android's battery page) and memory against
   `08`'s targets (under 2% a day, under 150 MB), or agree new ones.

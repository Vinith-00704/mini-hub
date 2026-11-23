# 08. The phone app

An ordinary Android app, built here and installed by hand as an APK. It is never published to a store, which is
what allows it the permissions below. The owner's phone is a Nothing Phone (2a) on Android 16.

## What it does

1. **The floating bot.** Mini's pixel-art bot floats over other apps, as on the PC. Tap it to talk or type; drag
   it anywhere; hide it; stop it.
2. **The record.** With the owner's say, per kind: calls, SMS, chat messages seen as notifications, other
   notifications, battery and app use. Kept encrypted on the phone and handed to the hub at home (`04`).
3. **The rules.** The phone's own switches for what is recorded and what Mini may use, the phone's own approvals,
   and its own log (`03`).
4. **The hands.** Reading the screen and controlling the phone for Mini, when allowed, through Android's
   accessibility service.
5. **The brain's keeper.** Starts, watches and restarts Claude Code in Termux, and passes prompts and replies.
6. **Voice.** Speech to text and text to speech on the phone.
7. **The link.** Pairing and syncing with the hub.
8. **Nothing extras.** A quick-settings tile, a home-screen widget, the assistant gesture, the Glyph lights.

## Packages inside the app

One Gradle module to start with, one package per job:

| Package | Holds |
|---|---|
| `overlay` | The floating bot and its panel: windows, drawing the sprite, drag, hide |
| `collect` | The call-log reader, the SMS reader, the notification listener, usage and battery |
| `data` | Room database on SQLCipher: `events`, `audit`, `grants`, `collect`, `approvals`, `hub`, `settings` |
| `consent` | Grants, risk, approvals, the audit log, the stop state. The only code allowed to say yes. |
| `hands` | The accessibility service, and the tool endpoint Claude Code calls |
| `brain` | Starting and watching Termux, the runtime and Claude Code; prompts in, replies out |
| `voice` | Speech recognition and speaking |
| `link` | Finding the hub, pairing, the WebSocket, sync, commands from the hub |
| `nothing` | Glyph, the tile, the widget, the assistant service |
| `ui` | Compose screens and the theme |

## What it asks Android for

Each is asked for at the moment the owner turns on the thing that needs it, with one sentence on why, never all at
once on first launch. Turning the thing off stops using the permission.

| Permission or special access | For | Notes |
|---|---|---|
| Display over other apps | The floating bot | A settings screen, not a dialog |
| Notifications | Its own status notification; required for a foreground service | n/a |
| Foreground service (`specialUse`) | Keeping the bot, the record and the brain's keeper alive | Runs while the bot is on, a PC is paired, or anything is recorded (any collect switch on); Stop Mini does not end the record. The notification says what is on, the record first: "Mini: recording calls and messages · linked to your PC · bot on"; while the Talk sheet listens it starts with "Mini is listening". It is `specialUse` only: the service has no `microphone` type and never listens |
| Ignore battery optimizations | Not being stopped in the background | For the app and, separately, for Termux |
| `READ_CALL_LOG` | Call history | Calls carry the call log's own names |
| `READ_SMS` | SMS, received and sent | Read from the SMS store; `RECEIVE_SMS` is not asked for |
| `READ_CONTACTS` | Names for SMS senders | Asked from its own button ("Allow contacts"), not with `READ_SMS`. Used only on the phone, to put a name to a number |
| Notification access | Chat messages and other notifications | A settings screen. The owner chooses which apps are included. |
| Usage access | Time per app | A settings screen |
| Accessibility service | Reading the screen and controlling the phone | A settings screen. Android may first require "Allow restricted settings" for an app installed by hand. Off until the owner wants Mini to use the phone. |
| `RECORD_AUDIO` | Voice | Used only while the Talk sheet is on screen, after the owner tapped Talk, with the sheet, the bot's "listening" and Android's own microphone dot showing it. Asked for from the sheet ("Mini hears you only while this sheet is open.") or from the Brain screen's Allow, never by code |
| `CAMERA` | Scanning the pairing code | Only on the pairing screen |
| `SEND_SMS`, `CALL_PHONE` | Sending an SMS and placing a call for Mini | Asked for only when the owner turns on "sending replies and SMS". Every use still asks. |
| `com.termux.permission.RUN_COMMAND` | Starting things in Termux | Granted in the app's own permission page; Termux must also allow outside apps (below) |
| `com.nothing.ketchum.permission.ENABLE` | The Glyph lights | n/a |
| Internet, network state, Wi-Fi state, local network | The link to the hub | No location permission is needed |
| Receive boot completed | Starting again after a restart, if the owner turned that on | n/a |

Not asked for: location (until a later phase, if the owner wants it), storage, the body sensors, call recording.

## The floating bot

- A small always-on-top window showing the active bot, drawn from the same pixel-art data as on the PC
  (`sprite`: a palette and frames for idle, blink, listening, thinking, working, done, error). The bot's profile
  comes from the hub at sync, so a bot designed on the PC appears on the phone. A default sprite ships in the app.
- **Tap**: the panel opens beside it: the last reply, a text box, **Talk** (the Talk sheet, under Voice), and
  three small buttons: **Hide**, **Stop**, **Open app**. A tap on the bot also stops Mini speaking.
- **Long-press and drag**: move it. It snaps to the nearest edge and remembers where. Dragging it onto the "x"
  that appears at the bottom hides it.
- **Hide** removes the bot from the screen and nothing else: the record goes on, and the status notification
  still says what is on. If the microphone, the screen reading or control is in use, an indicator stays on screen
  that hiding cannot remove.
- **Stop** stops Mini on the phone: ends listening and control (Mini's and the PC's), tells the brain to stop,
  and refuses tool calls and commands from the PC until the owner starts it again on the phone. When linked, it
  offers "Stop on my PC too". A stop sent from the PC does the same and shows "Stopped from your PC". The record
  goes on unless the owner also turns collecting off.
- The bot hides itself automatically over apps on a list the owner keeps (banking, payments), and the
  accessibility service does nothing in those apps.
- States shown by the sprite and a small label under it ("listening", "thinking", "working", "needs you", "asleep";
  nothing while it rests): resting, listening, thinking, working, **needs you** (a question from Mini is waiting: an
  approval, or a question the runtime put up; it wins over the other states), **asleep** (the brain is not running),
  **controlling** (with a red edge around the whole screen). The bubble window is 64 × 80 dp: the bot, and the label
  below it. The bot's state follows the runtime's own report of what Mini is doing (`working` and `thinking`).
- **Questions from the runtime** (a routine that runs a prompt, a bot preview) show in the panel as the question's
  text with one button per option, the main one first. A tap goes to the runtime; a question that is no longer open
  (it ran out, or was answered elsewhere) just goes away. The bot shows "needs you" while one is open. A bot preview
  reads "Here is <name>, as it would look." with the runtime's text; the phone does not draw other bots yet.
- **Reminders** (a routine's announcement) show as the panel's status line until the next one comes.

## The record

| Collector | How | Becomes |
|---|---|---|
| Calls | Reads the call log when it changes (a content observer: a call has ended). Calls made while the app was not running are caught up at its next start, with their real times | `call` |
| SMS | Read from the SMS store as they are written, received and sent alike (a content observer). Drafts and failed messages are passed over; one still going out is recorded once sent. MMS are not recorded. SMS missed while the app was not running are caught up at its next start | `sms` |
| Chats | The notification listener, for the apps ticked in "Apps to include". A ticked app's messaging notifications (its messaging style, or the message category) are chats: the sender, the conversation and the text of each message, and whether it offers a reply box. Recorded only while Messages is collected | `chat` |
| Other notifications | The same listener and the same list: a ticked app's other notifications, with their title and text. Recorded only while Other notifications is collected; a chat is never recorded as one | `notification` |
| State | Battery level in steps of 5%, charging, network changes | `device_state` |
| App use | Once a day from the usage statistics | `app_usage` |
| Mini | Every tool call, approval and refusal | `mini_action` |

- A collector whose switch is off, or whose permission Android has not given, is not registered at all: no
  reading, no storing. A permission taken away in Android's settings stops it, and the Permissions screen says so.
- Collecting starts when the switch is turned on (and Android allows it), from that moment: no older calls or SMS
  are imported. Each call and SMS is recorded once, however often Android reports a change.
- Android ends the app when a permission is taken away; at its next start every source starts afresh, so nothing
  from while access was off is read. One case leaves no trace: a permission taken away and given back while the app
  was not running at all. The calls and SMS from that time are then caught up at the next start.
- One list, "Apps to include", decides which apps' notifications are read at all. Nothing is ticked at first; an
  app that is uninstalled leaves the list.
- The phone app (Android's default dialer) cannot be ticked: calls come from the call log, so its notifications
  are never read. Its row in "Apps to include" says "Calls come from Call history".
- The SMS app (Android's default for SMS) can be ticked, for RCS chats, which arrive only as its notifications.
  Its messages are mostly the SMS already read from the SMS store, so one of them is passed over when an SMS from
  the same sender (the same number, normalised as the record keys it, or the same contact name) with the same text
  was stored in the last 2 minutes; otherwise it is kept as a chat. Its notifications wait 2 seconds and the SMS
  store is read first, so the SMS is there to compare with.
- The notification listener is enabled once Messages or Other notifications is first collected, and never disabled
  again (Android would forget the owner's notification access). While both are off, Mini asks Android to let go
  of it, also after a restart; when one comes back on, Mini asks for it again. Android binds it only once the owner
  turns on notification access for Mini in Settings (the app opens that screen, it never turns it on).
- Notifications already on screen when a source starts (access given, a switch turned on, an app ticked) are not
  read, even when the app posts them again.
- Repeated updates of the same notification (a chat app re-posting the whole conversation with each new message)
  are folded: each message once, by its app, conversation, sender, own time and text; each other notification
  once per title and text. A changed text is a new event.
- Never recorded, whatever is ticked: Mini's own notifications, ongoing notifications (music, navigation, a
  download, a foreground service), group summaries, and the owner's own messages in a chat notification.
- The record is written before anything else is done with an item, so nothing is lost if the app is stopped.

## Mini's brain on the phone

Claude Code runs in Termux, signed in with the owner's plan, with the Mini Bot plugin installed. The Mini Bot's
runtime (Node) runs beside it in Termux and does on the phone what it does on the PC for the plumbing: keeps the
session alive, queues prompts, passes replies and activity back. See `09-mini-bot-changes.md` for what changes in
that code.

```
 phone app                         Termux
 ---------                         ------
 brain keeper  --RUN_COMMAND-->    start-mini.sh
                                     node runtime/server.mjs      (listens on 127.0.0.1)
                                     tmux: claude  (Mini Bot plugin loaded)
 overlay  <----- loopback ----->   runtime      prompts in, activity and replies out
 hands endpoint <--- loopback ---  plugin       phone_* tool calls, with the agent token
```

**Setting it up, once** (the Brain screen: `ui/Screens.kt` BrainScreen, `assets/check-mini.sh`, `assets/update-mini.sh`).
Each step shows ✓ done, • not done or ? not known yet, a button only while it is not done, and a line saying what to
do. Every step is the owner's own tap; the screen's first line says so: "Mini on this phone runs on Claude Code in
Termux. Every step here is your own tap; Mini never changes Termux's or Claude Code's settings for you." The fourteen
steps and how each is checked:

1. **Termux is installed** (Android's package list). **Get Termux** opens the F-Droid page in the browser.
2. **Termux is the F-Droid build** (advice only; it never blocks Start). Not done while Termux's `ApplicationInfo` has
   `FLAG_DEBUGGABLE` (the GitHub build); the line says what that means and how to move (D5).
3. **Mini may run commands in Termux**: Termux's "run commands" permission, granted by the owner on Android's own
   question.
4. **Termux accepts commands from Mini**: the owner pastes one line into Termux (**Copy the line**), which sets
   `allow-external-apps = true`. Done once a check has run; if Termux refuses, the step shows Termux's refusal.
5. **Node.js, tmux and git in Termux**: from the check; the line to run is `pkg install nodejs-lts tmux git`.
6. **Claude Code is installed and signed in**: from the check (`claude --version`, and whether Claude Code's credentials
   file has anything in it); the owner runs `claude` in Termux and signs in.
7. **Mini Bot 0.8.0 or later on this phone**: the version of the phone's own copy (`~/.mini/plugin`), or "not
   downloaded yet". **Update Mini Bot** stops Mini if it runs (an answer still coming is dropped, "Mini is
   updating."), runs `update-mini.sh` (this is the phone's own clone, not a repository of the owner's on the PC: it is
   used only if `~/.mini/plugin` has a `.git` of its own whose `origin` is the Mini Bot repository, and git never
   looks above `~/.mini`; then `git fetch --depth 1` and `checkout --force FETCH_HEAD`, rolled back if the checkout
   or the version fails. Otherwise a fresh clone is made beside it and swapped in only when whole; downloads end after
   150 seconds), starts Mini again if it was on, and says "Mini Bot on this phone is now <version>." or the error. A
   start refuses an older plugin and points here. The button stays on this step when it is done: a newer Mini Bot
   reaches the phone only this way.
8. **Claude Code trusts Mini's folder**: from the check (only `hasTrustDialogAccepted` for `~/.mini/work`). The owner
   starts Mini, taps **Open Claude Code** and answers Yes to Claude Code's own question. Mini never answers it.
9. **Your Claude Code settings keep Mini's limits**: from the check. Not done while the owner's own
   `~/.claude/settings.json` allows a `Bash`, `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Glob`, `Grep`,
   `WebFetch` or `WebSearch` rule, bare or with a pattern outside `~/.mini/work`, lists `additionalDirectories`, or
   `~/.mini/work` has a `.claude` folder or a `.mcp.json`. The screen lists them (at most 10, 60 characters each; `Bash`
   rules are only counted and web rules named without their hosts, so nothing the owner typed there is kept) and says
   to remove them in Termux; the app does not. If the settings cannot be read, the step shows "?", never a check mark.
10. **Mini may appear over other apps**, 11. **Notifications**, 12. **Microphone**, 13. **Android does not pause
    Mini** and 14. **Android does not pause Termux** (battery use "Unrestricted", checked with
    `isIgnoringBatteryOptimizations("com.termux")`; **Open Termux's settings** opens its app page): Android's own
    questions, each opened from a button the owner presses. After the microphone comes **Speech for <language> on
    this phone** (done when the on-device model is installed; **Download** when Android offers it, which only
    Android's own download runs; "Not offered on this phone" otherwise), and after the brain's card the **Voice**
    card (under Voice, below).

**Check Termux** runs `check-mini.sh` through Termux and keeps its answer (not secret) in the app's `brain`
preferences with its time; the steps that need it show "?" and "Tap Check Termux." until then. A check also runs
after each start reaches Ready and after Update Mini Bot. **The app reads Claude Code's and Termux's settings and
trust only through that script, only to say what is missing, and never writes them** (not
`~/.termux/termux.properties`, not `~/.claude/`, not `~/.claude.json`, not a `.claude/settings*.json` or `.mcp.json`),
and never answers the folder-trust question or the sign-in. The script prints one line, `MINI_CHECK {json}`, with
`claude` (its version text, at most 40 characters) and `claudeFound`, `node`, `tmux`, `git`, `signedIn`, `plugin`,
`trusted`, `widened`, `runtime` and `session` (Mini's two tmux sessions), and `logMore` and `errorNotes` (below). No
account, name or mail address is printed. A check that could not read something says so (`null`, `read: false`) and
the step shows "?": without node, or when Claude Code's settings cannot be read, `plugin`, `trusted` and `widened`
are unknown, never empty.

Termux's own logs can hold what Mini sends it (docs/03 > Keys). From Termux's preferences the check also reads its log
level and whether plugin error notifications are on (Termux's default). If the level is above Normal, the screen says
so plainly (in amber) and to set it to Normal; if the level cannot be read, it says so; if the notifications are on,
it gives advice in a muted line (their report can include Mini's keys only if a start ever fails to report back).
It changes nothing in Termux.

Below the steps, one card shows the brain's state (Off, Starting, Ready, Needs you with **Open Claude Code**, Resting,
Asleep with its reason, Broken with the repair text), with **Start Mini** / **Show the bot**, **Stop Mini**,
**Restart**, and **Open Claude Code** while it runs; the choice **Keep running** (default) or **Start when asked**
("saves battery; the first answer then takes a little longer"); and, while it runs, "Runtime port <n> · tools port
<m>" (not secret).

Starting Mini: the app sends `start-mini.sh` through `RUN_COMMAND` each time Mini starts; nothing of it is kept in
Termux. The first time, it downloads the Mini Bot plugin to `~/.mini/plugin`. Each time, it writes
`~/.mini/session.sh`, the way Mini's own Claude Code session starts.

**Running** (Phase 3: `brain/BrainKeeper`, `brain/Termux`, `brain/RuntimeClient`, `assets/start-mini.sh`)

- **Every start of the brain restarts the runtime with fresh keys, and keeps Mini's session.** The keeper makes two
  new keys (the overlay key and the hands token: 32 random bytes each, as 64 lowercase hex characters), starts the
  hands endpoint for its address, and sends `start-mini.sh` with three lines put before the script's own text:
  `MINI_OVERLAY_KEY=<hex>`, `MINI_HANDS_URL=http://127.0.0.1:<port>`, `MINI_HANDS_TOKEN=<hex>`. The script checks
  them, Termux's commands (`claude`, `node`, `tmux`, `git`) and the plugin's version (0.8.0 or later, else "Tap
  Update Mini Bot on the Brain screen"), writes `~/.mini/session.sh`, takes Termux's wake lock, ends the old runtime
  (the `rt` tmux session) and starts a new one. It hands the runtime its keys as one JSON line,
  `{"overlayKey":…,"handsUrl":…,"handsToken":…}`, through a one-use fifo (`~/.mini/tmp/keys.<pid>`, mode 600,
  written by the shell itself and removed at once; 10 seconds at most). `~/.mini/tmp` (mode 700) is the scripts' own:
  Claude Code's temporary files go to `~/.mini/claude-tmp`, and Mini's session may neither read nor change
  `~/.mini/tmp`. It never exports the keys: Mini's `rt` and
  `mini` tmux sessions share one tmux server, whose environment comes from the script. The runtime then writes
  `runtime.json` (40 seconds at most) and the script answers `MINI_READY {"port":…,"token":"…","version":"…"}` (the
  runtime's own token and the plugin's version), or `MINI_ERROR <text>`. Mini's `mini` tmux session is not touched:
  the new runtime's keeper takes it back, or starts it with `session.sh`.
- **How the app and the runtime trust each other.** Any app on the phone can open a loopback address, so neither
  side accepts a caller without a secret. The keys travel only on the start script's standard input and through the
  fifo: never on a command line, in an environment variable, in a file the app or a script writes, or in a log. The
  app asks `GET /v1/phone/proof?nonce=<32 hex>` and checks the answer (HMAC-SHA256 of the nonce, keyed with the
  overlay key) before it trusts a new runtime, before every prompt, and before every other request: the proof
  request carries no secret (that one route takes no token on the phone; Host and Origin are still checked), and the
  app calls the runtime with its token and the overlay key on every request after the proof. A program that took
  the runtime's port after it died learns nothing and gets no prompt. Keys are never reused across starts: every
  start makes new ones. Another app on
  the phone has none of the keys, so it can neither feed Mini prompts nor read its replies nor call the hands.
  Nothing in this exchange can grant anything: the phone app decides every tool call itself.
- **Termux is started as a foreground service** (`startForegroundService`, Termux's own advice since Android 8): a
  plain start is refused while Termux is not running, as after it was killed.
- **Starting.** After the proof, the keeper reads the runtime's state each second for up to 90 seconds:
  `assistant.status` `running` is **ready**; `needs-you` (Claude Code waits in its window, as for the folder-trust
  question at the first start in `~/.mini/work`) is **needs you**, and the bot's panel opens with the note and an
  **Open Claude Code** button; `failed` is **broken**; anything else is **starting**. Still not running after 90
  seconds is **needs you** too. The keeper keeps checking.
- **Health.** The keeper checks the proof and the state every 30 seconds while the bot is shown, every 5 minutes
  while hidden (hiding the bot keeps the brain running). A failed check is **asleep** ("Mini's brain stopped.
  Bringing it back…") and a restart; a failed start is tried again 10 seconds later. After three restarts within 10
  minutes, successful or not, the next one is not tried: the brain stays **asleep** with the last error until the
  owner presses Start Mini (or, in "Start when asked", asks something), which clears the count. Asleep like this
  (and broken) runs `stop-mini.sh`, so the runtime, Mini's Claude Code session and the wake lock go too. Termux refusing
  outside apps is asleep at once with the step to take. Two starts never run at once in Termux: the start script
  holds a lock (`~/.mini/tmp/start.lock`, taken back after 3 minutes).
- **Broken.** "Claude Code is not installed in Termux.", or Mini's session failing in the plugin, is **broken**:
  "Claude Code on this phone is not working: … Mini keeps recording. To repair it, open Termux, update or reinstall
  Claude Code the way you installed it, run claude once to check it signs in, then tap Restart on the Brain screen."
  No automatic retries. The runtime's own notes on the phone are the phone's: "Claude Code is waiting for you in
  Termux. Tap Open Claude Code." and "Claude Code's session keeps closing, so it was left off after 3 tries."
- **Keep running or Start when asked.** "Keep running" (the default) starts the brain with the bot. "Start when
  asked" shows the bot with the brain resting ("Mini starts when you ask something."); the first question starts it
  and waits for it (90 seconds at most), and after 10 minutes with no prompt and no question waiting the brain is
  stopped and rests again. Waiting includes a question of Mini's on the phone, the runtime's own question, the Talk
  sheet listening, and a turn still running (a routine's prompt too).
- **Stop.** Stop Mini, on the phone or from the PC, runs `stop-mini.sh` (it leaves a stop mark,
  `~/.mini/tmp/stopped`; the runtime's tmux session ends first, then Mini's, and the wake lock goes), closes the
  hands and leaves the brain off. A start that was under way (cloning, waiting for the lock, starting the runtime)
  sees the new mark, ends whatever it made (runtime, session, wake lock) and answers "Mini was stopped while it was
  starting." The app ignores a start's answer that comes after Stop, and runs `stop-mini.sh` again for it, whatever
  it says (even "Termux did not answer").
- "Open Claude Code" opens Termux in front, attached to Mini's `mini` tmux session, which is the phone's version of
  the PC's "Claude Code itself, beside the bot". The owner answers what waits there; the app types nothing.

**What the phone session may do by itself.** Claude Code's own tools could reach the phone around the app, so
the session is started with them shut (`03`, "Mini's own tools on the phone"): permission mode `dontAsk`, so it
never waits on a question nobody can see; the `phone_*` tools, routines, bot design and files inside `~/.mini/work`
allowed; running commands, web search and fetch, and every other file refused. These limits are Claude Code's
command-line flags in `~/.mini/session.sh`, which the start script writes afresh at every start, not a Claude Code
settings file: the app never writes Termux's or Claude Code's settings. `session.sh` holds no keys. It sets
`MINI_BOT_HOME=~/.mini/home`, `MINI_BOT_ROLE=main`, `MINI_BOT_PLATFORM=android` and `CLAUDE_CODE_TMPDIR=~/.mini/claude-tmp`, starts in
`~/.mini/work`, keeps from what the runtime passes only `--resume <id>` and `--model <name>`, and runs
`claude --plugin-dir ~/.mini/plugin -n Mini --permission-mode dontAsk` with the lists in `03`.

**If Claude Code stops working after an update**, the app says so in plain words, keeps recording, and offers
the steps to repair (above, "Broken"). It does not fall back to anything else by itself.

## The hands endpoint and the phone's tools

A small HTTP server inside the app on the loopback address, port chosen at start, that accepts only the agent
token it issued. It is how Claude Code reaches the phone. Every call goes through `consent`.

| Tool Mini sees | Does | Scope | Risk |
|---|---|---|---|
| `phone_status` | Battery, network, what is allowed, what is waiting | `phone.status.read` (the phone's own; also needs Collect for Battery and app use) | read |
| `phone_read` | Recent calls, messages, notifications from the phone's own record, with filters | `phone.calls.read`, `phone.messages.read`, `phone.notifications.read` | read |
| `phone_look` | The text and layout of what is on screen; a picture if asked | `phone.screen.read` | read |
| `phone_act` | One step: open an app, tap, type, swipe, press back or home, dismiss a notification. Returns the screen after it. | `phone.control` | act |
| `phone_send` | Answer a chat through its notification, send an SMS, place a call | `phone.reply` | important |
| `phone_set` | Do Not Disturb, ringer, torch, brightness | `phone.control` | act |

Underneath, these are the same actions as in `06` (the `android` connector): `phone_act` covers `open_app`,
`tap`, `type`, `swipe`, `key` and `dismiss`; `phone_send` covers `reply`, `send_sms` and `call`; `phone_look`
covers `screen_read` and `screenshot`; `phone_set` is `set`. One implementation in `hands`, two ways in:

- **Mini on this phone** calls the tools. `consent` checks the **"Mini on this phone"** list.
- **A command from the hub** names the action. `consent` checks the **"From my PC"** list (`03`, `04`).

`phone_status` and `phone_read` need no accessibility service and arrive in Phase 3. The rest arrive in Phase 5.

**How the endpoint works** (Phase 3, `hands/HandsServer`, `hands/PhoneTools`, `consent/MiniGate`):

- **Loopback only, a new token per start of the brain.** It listens on `127.0.0.1`, on a port Android chooses.
  Every start of the brain makes a new 32-byte token (64 hex characters); the old one stops working at once. The
  token lives only in the app's memory and the runtime's, never in a file, a log, the record or a notification.
  A request with an `Origin` header, a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, or a missing or
  wrong `authorization: Bearer <token>` (compared in constant time) gets `401 {"error":"missing or wrong token"}`;
  the phone's log gets "Another app · call Mini's tools · refused" at most once a minute. One request per
  connection, headers at most 8 KiB, a body at most 16 KiB with `content-length`, 10 seconds to send it; anything
  else is `400`.
- **The endpoint proves itself.** `GET /v1/proof?nonce=<32 lowercase hex>` needs no token (Origin and Host are
  still checked) and answers `{"proof":"<lowercase hex of HMAC-SHA256, key = UTF-8 of the token, message = UTF-8
  of the nonce>"}`, `400` for a bad nonce. The plugin asks it with a fresh nonce before every call and every poll and
  sends nothing more unless it matches, so a program that takes the port after the app's process ends gets neither
  the token nor Mini's search words, and cannot feed Mini a fake record.
- **Routes.** `GET /v1/health` → `{"ok":true,"tools":["phone_status","phone_read"]}`. `POST /v1/tools/call` with
  `{"tool":"…","args":{…}}` → `200 {"ok":true,"text":"…"}`, `200 {"ok":false,"code":"…","error":"…"}`, or
  `202 {"ticket":"t-<16 hex>","until":<epoch ms>}` when the owner is asked. `GET /v1/tools/ticket?id=…&wait=<ms,
  at most 20000>` → `{"done":false}` or `{"done":true,"result":{…as a 200 call…}}`; `404` for a ticket it does not
  know. Codes: `not-allowed`, `not-collected`, `said-no`, `expired`, `stopped`, `unknown-tool`, `bad-args`, `failed`.
- **The judge is `MiniGate`, and nothing else.** Stopped (here or from the PC) refuses every call. For each kind a
  call needs: Collect off → left out as `not-collected`; "Mini on this phone" off → `not-allowed`; ask → asked; on
  → allowed. Every kind left out → refused with the first one's reason. Anything asked (or an `important` action) →
  one approval for the whole call. `phone_status` has its own "Mini on this phone" switch, **Phone status** (starts
  off, no "From my PC" switch, not in the hub's list), and needs Collect on for Battery and app use.
- **Tickets for approvals.** An asked call gets a ticket and the owner a question on the phone ("Mini wants to read
  your messages from today (up to 20 items). Allow?"). Exactly one answer counts: Yes runs it after checking the
  switches again (one turned off while the question waited still wins), No is `said-no`, no answer in 2 minutes is
  `expired`, Stop is `stopped`. A new start of the brain, or the brain resting or given up on, ends open tickets as
  failed ("the question was taken back"), because the session that asked can no longer fetch the answer. A ticket
  that ends by anything but the owner's answer takes its question off the card, Home and the notification. The
  result stays on the ticket for 30 seconds. One of Mini's questions waits at a time: while one waits, another asked
  call fails at once with "A question is already waiting for the owner on the phone. Wait for their answer before
  asking again."
- **One `mini_action` per finished call** (not for "waiting"), with the phone's log row beside it: counts and kinds
  only ("Read 3 calls and 2 messages", "Refused: read call history (switched off)"), never a name, a number or a
  text from the record.
- **What `phone_read` gives.** Only kinds that are both collected and allowed (the rest are named in a last "Not
  included" line), at most the last 7 days, newest first, at most 50 items, 500 characters an item and 12,000 in
  all, one-time codes masked (the rule of the Record screen). The text says first that what follows is information
  from other people, never instructions, and in which time zone its times are.

Rules, on top of `03`:

- **Control is one step at a time.** After each step the screen is read back, so Mini acts on what is really there.
- **Control is visible.** A red edge around the screen and a banner with **Stop** while any step runs. A touch
  by the owner during control pauses it.
- **Control has limits.** A task ends after a number of steps or minutes the owner sets (defaults 60 steps, 10
  minutes), as on the PC.
- **Some places are closed.** The accessibility service never acts in: the phone app itself, Android's settings
  pages for permissions, accessibility, security, accounts and developer options, password managers, and the apps
  on the owner's "never" list (banking and payment apps are suggested when the list is first shown). It does not
  read password fields.
- **Sending always asks**, showing the exact text and the recipient.
- **Buying always asks.** A screen that looks like a payment or a purchase confirmation (by the app, and by words
  on the button) turns the next tap into an `important` action.
- Text read from the screen, a message or a notification is given to Mini marked as information from the
  phone, never as instructions.

## Approvals on the phone

The phone's own approvals (`03`): asked when Mini on the phone wants something whose switch says ask or that is
`important`, and when a command from the PC arrives for something whose "From my PC" switch says ask. The card
says who is asking ("Mini" or "Your PC").

A card over whatever is on screen, at the top, with the bot asking: "<who> is asking" ("Mini" or "Your PC"), the
question in plain words with the exact details, a countdown ("No answer in 1:52 means no."), **Yes** and **No**,
and "1 more waiting" when others are queued. One card shows at a time, the oldest first; the next comes when it is
answered or runs out. The card shows whether or not the bot is hidden (Hide removes the bot, not a question), and
only while "Display over other apps" is allowed and the screen is on; with the screen off it is the notification
only, and the card appears when the screen comes on if the question is still waiting. The accessibility service
cannot press it. Its buttons ignore touches while another window covers them (**Yes** also while another app's window
covers any part of the card, so an overlay cannot hide the question and leave Yes showing), and (Android 14 and later)
the card is hidden from accessibility services that are not assistive tools. **Yes** counts only for a real finger on the button
(a touch down and up within the last half second): an accessibility action or a programmatic click does nothing.
A new question does not take a tap for 0.6 seconds after it appears or after another one goes, so a tap meant for one
question never answers the next.

The runtime's own questions (a routine to add, a designed bot to keep) show in the bot's panel, headed "Mini's
session asks" (about a routine, about a new look), never "<who> is asking". They are consent questions too and have
the same guards: no option takes a tap for 0.6 seconds after the question appears, the primary option (the yes)
counts only for a real finger on a window nothing else covers, and (Android 14 and later) they are hidden from
accessibility services that are not assistive tools.

The same question is also a notification (channel "Questions from Mini and your PC") titled "<who> is asking", with
**No** and **Open**, never Yes: any app that may read notifications can fire a notification's actions, so a Yes there
would not be the owner's. **No** works from the lock screen; **Open** (and a tap on the notification) needs the phone
unlocked and opens Home, where the question waits at the top with the same Yes, No and countdown as the card.
Answering on the card or on Home clears the notification, and **No** clears the card. Only the owner's finger on
**Yes** says yes: no token, tool, program or accessibility action does. No answer in 2 minutes is no, and so is Stop (every card and notification goes at once). The
text of a question is never written to a log.

## Voice

- **The Talk sheet** is the only place the microphone opens. The panel's **Talk** and Home's **Talk** (beside Send)
  open it; nothing else does. It is a small see-through screen of the app's own (`TalkActivity`: not exported, its
  own task, never in recents, never over the lock screen, one at a time) with a card at the bottom: the bot in its
  listening state, "Listening…", the words as they are heard, and **Stop**. While it listens the bot shows
  "listening" and the notification starts with "Mini is listening". The sheet is not part of the bot: **Hide** hides
  the bot and the panel only, and the sheet and Android's microphone dot stay. The panel closes while the sheet is
  open so it never covers it; the reply opens it again (a hidden bot stays hidden and the reply waits in its panel).
- **It closes**, and the microphone with it, on Stop, Back, a tap outside the card, the sheet leaving the screen
  (another app, the phone locking), a result (the words go to Mini and the sheet goes), an error (its line for 2 s),
  Stop Mini on the phone, Stop from the PC, and the brain going asleep, broken or off. The service never holds the
  microphone.
- **Not while Mini cannot answer**: when Mini is stopped, or the brain is asleep or broken in "Keep running", Talk
  does not listen and the panel says "Mini is asleep. Tap Start Mini." (or the stopped line). In "Start when asked"
  Talk starts the brain and listens at once; the words wait for it.
- **On the phone only**: Android's on-device recognizer, never an online one. The sheet first asks it whether it
  has a model for the phone's language (`checkRecognitionSupport`). With no on-device recognizer, or no model: "This
  phone has no on-device speech model for <language>, so Mini takes typing only.", with **Download** when Android
  offers one; the download is Android's own (`triggerModelDownload`), started only by the owner's tap, here or on
  the Brain screen ("Speech for <language> on this phone", after the microphone step). Without the microphone
  permission the sheet asks Android for it; refused: "Mini needs the microphone to hear you. You can type instead."
  Nothing heard: "I did not catch that. Tap Talk and try again."
- **Out**: Android's text to speech. The Brain screen's **Voice** card: "Speak replies" (When I spoke, the default;
  Always; Never), "Voice" (the phone's default first, then the installed voices for its language that need no
  network), "Speed" (0.8, 1, 1.2, 1.5) and **Try it** ("This is how Mini sounds."). A change applies to the next
  reply. The final reply is spoken (never an error) without its markdown marks (`*`, `_`, `#`, backticks, `>`),
  with `[words](link)` read as "words", code blocks left out, and cut to 600 characters at the last sentence end
  within them; the panel shows the whole reply. Talk, Stop and a tap on the bot stop Mini speaking. A
  reply that ends while the Talk sheet listens is not spoken (the microphone would hear it). With no voice for the
  language that works offline nothing is spoken and replies are shown as text ("No voice on this phone works offline;
  replies are shown as text."): reply text never goes to an online voice.
- **Starting it**: the panel's Talk and Home's Talk now; the quick-settings tile and the assistant gesture come in
  Phase 5. There is no always-listening wake word in this plan (`11`).
- What was said, the reply and the words heard are never written to a log.

## The app's own screens

| Screen | Holds |
|---|---|
| **Home** | The bot, its state, a prompt box; today's counts; the hub's state ("synced 2 min ago", "not at home: 143 waiting") |
| **Activity** | What Mini did on this phone |
| **Record** | What has been recorded, searchable, with delete |
| **Permissions** | One row per kind of thing, with three controls: **Collect** (on or off), **Mini on this phone** (off, ask, on) and **From my PC** (off, ask, on); "only change these on the phone"; the "never" apps; Stop. A line under the first one says what "Mini on this phone" means; under each row a short note says when Mini cannot use the kind yet, or that Collect is off so there is nothing to read |
| **Hub** | Pair, the paired hub, sync now, forget this hub |
| **Brain** | Setup steps and their checks, the brain's state, open Claude Code, restart |
| **Settings** | The look, voice, the bot (hide over which apps, size, start after restart), limits, storage |

Bottom navigation for the first four; the rest under a menu. The look follows `07`.

## Fitting the Nothing Phone (2a)

| Feature | What it does | How |
|---|---|---|
| **Quick-settings tile** | "Mini": tap to talk; long-press opens the app. A second tile, "Mini bot", shows or hides the bot. | `TileService` |
| **Home-screen widgets** | "Ask Mini" (a bar); "Today" (counts); "Bot" (the sprite and its state). Monochrome, dot-matrix numerals, sized to sit with Nothing's own widgets. | Glance |
| **Assistant gesture** | Holding the power button or swiping from a bottom corner opens Mini's prompt, if the owner picks Mini as the phone's assistant app | A `VoiceInteractionService` with its session; the owner selects it in Settings > Apps > Default apps |
| **Glyph lights** | A slow pulse while Mini thinks, a sweep while it works, a double blink when it needs the owner, a fill as a long task progresses. Off when the phone is face up, when Glyph is off in the system, and at night by the system's own schedule. | Nothing's Glyph Developer Kit (`DEVICE_23111`). On Android 16 no key from Nothing is needed. |
| **App shortcuts** | Long-press the icon: Talk, Show or hide the bot, Stop | Static shortcuts |
| **Lock-screen and always-on display** | The status notification's short text | The ordinary notification |

Each Glyph pattern, and Glyph as a whole, has its own switch. Nothing-specific code lives in `nothing/` and the
app works without it on any other phone.

## Building and installing the APK

- `android/` is a normal Gradle project. `./gradlew assembleRelease` makes `app-release.apk`.
- **Signing**: a keystore made once on the owner's PC (`keytool`), kept outside the repository or in `local/`,
  with its path and passwords in `android/keystore.properties`, which git ignores. The same key must sign every
  later version, or Android will refuse to install over the old one. The owner backs the keystore up.
- **Release builds are not debuggable**, so nothing reaching the phone over USB can read the app's data.
- **Installing**: `adb install -r app-release.apk` with the phone on USB, or copy the file to the phone and open it.
- **Updating**: build, install over the top. The record and the pairing are kept.
- Version name and code come from one place (`android/app/build.gradle.kts`) and are shown in the app and sent to the hub.
- The application id is a placeholder, `app.minihub.phone`, to be confirmed by the owner before the first
  release build, because changing it later means a fresh install.

## Staying light

- The foreground service does nothing on a timer except the health check. Collectors are driven by Android's
  own events.
- The bot's animation stops when the screen is off or the bot is hidden.
- The link uses one connection and sends small batches. It does not hold a wake lock.
- Targets, to be measured in Phase 2 and 3 on the owner's phone: under 2% of battery a day with the bot shown and
  the brain idle; the app under 150 MB of memory; the record under 200 MB.

## Left to the builder

- The exact overlay window types and flags, and how the red edge is drawn.
- How a "payment-like" screen is recognised (start with a short list of words and known apps; keep it easy to extend).
- The widget designs within the look in `07`.
- The setup script's contents, and how the plugin is installed and updated in Termux.

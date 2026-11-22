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
| `collect` | The call-log reader, the SMS receiver and reader, the notification listener, usage and battery |
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
| Foreground service (`specialUse`) | Keeping the bot, the record and the brain's keeper alive | The notification says what is on: "Mini: recording calls and messages - bot shown" |
| Ignore battery optimizations | Not being stopped in the background | For the app and, separately, for Termux |
| `READ_CALL_LOG`, `READ_CONTACTS` | Call history with names | Contacts are used only to put a name to a number, on the phone |
| `READ_SMS`, `RECEIVE_SMS` | SMS | n/a |
| Notification access | Chat messages and other notifications | A settings screen. The owner chooses which apps are included. |
| Usage access | Time per app | A settings screen |
| Accessibility service | Reading the screen and controlling the phone | A settings screen. Android may first require "Allow restricted settings" for an app installed by hand. Off until the owner wants Mini to use the phone. |
| `RECORD_AUDIO` | Voice | Only while listening, with the bot showing it and Android's own indicator on |
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
- **Tap**: the panel opens beside it: the last reply, a text box, a microphone button, and three small buttons:
  **Hide**, **Stop**, **Open app**.
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
- States shown by the sprite and a small label: resting, listening, thinking, working, **needs you** (an approval
  is waiting), **asleep** (the brain is not running), **controlling** (with a red edge around the whole screen).

## The record

| Collector | How | Becomes |
|---|---|---|
| Calls | Reads the call log when a call ends (a content observer), and once at start for anything missed while stopped | `call` |
| SMS | Receives new SMS as they arrive; reads sent ones from the provider | `sms` |
| Chats | The notification listener, for the apps the owner ticked. Uses the notification's messaging style to get the sender, the conversation and the text, and remembers whether it offers a reply box. | `chat` |
| Other notifications | The same listener, for other ticked apps | `notification` |
| State | Battery level in steps of 5%, charging, network changes | `device_state` |
| App use | Once a day from the usage statistics | `app_usage` |
| Mini | Every tool call, approval and refusal | `mini_action` |

- A collector whose switch is off is not registered at all: no reading, no storing.
- Repeated updates of the same notification (a chat app re-posting a growing summary) are folded into one event
  per message, by the notification's key and the message's own time.
- Ongoing notifications (music, navigation, a download) are skipped unless the owner includes that app.
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

**Setting it up, once** (a guided screen in the app, each step with a check that it worked):

1. Install Termux (the app links to the official release) and open it once.
2. In Termux: install Claude Code with the community installer and sign in. Already done on the owner's phone.
3. In Termux: `pkg install nodejs tmux git`.
4. In Termux: add `allow-external-apps = true` to `~/.termux/termux.properties`. In Android's settings, grant the
   phone app Termux's "run commands" permission. The owner does both by hand; the app explains that this lets it,
   and only apps given that permission, start commands in Termux.
5. Set Termux's battery use to unrestricted.
6. The app runs its own setup script through `RUN_COMMAND`: installs the Mini Bot plugin from its marketplace,
   writes `~/.mini/start-mini.sh`, and starts it.

**Running**

- The keeper starts `start-mini.sh` when the bot is started and whenever it finds the runtime gone. The script
  takes Termux's wake lock, starts the runtime with `MINI_BOT_HOME=~/.mini/home`, and the runtime starts Claude
  Code inside a detached `tmux` session.
- **How the app and the runtime trust each other.** Any app on the phone can open a loopback address, so
  neither side accepts a caller without a secret. At each start the app makes three random values and gives
  them to `start-mini.sh` on its standard input (Termux's `RUN_COMMAND` can pass standard input; nothing is put
  on a command line or in a file): the **overlay key** the app will present to the runtime, the address of the
  app's **hands endpoint**, and the **agent token** the plugin will present to it. The runtime listens on a
  loopback port it reports back on its standard output, accepts the overlay only with that key, and keeps the
  token in memory. Another app on the phone has none of the three, so it can neither feed Mini prompts nor read
  its replies nor call the hands. Nothing in this exchange can grant anything: the phone app decides every
  tool call itself.
- The keeper checks the runtime's health every 30 seconds while the bot is shown, every 5 minutes while hidden.
  Three failed restarts in a row set the state to **asleep** and tell the owner why, with the last error.
- "Open Claude Code" in the app opens Termux attached to the `tmux` session, which is the phone's version of the
  PC's "Claude Code itself, beside the bot".

**What the phone session may do by itself.** Claude Code's own tools could reach the phone around the app, so
the session is started with them shut (`03`, "Mini's own tools on the phone"): permission mode `dontAsk`, so it
never waits on a question nobody can see; the `phone_*` tools, routines, bot design, web search and fetch, and
files inside `~/.mini/work` allowed; running commands and every other file refused. The setup script writes
these as the session's Claude Code settings, and the keeper starts the session with that settings file. The
hands endpoint's agent token is passed to the runtime in memory and is not written to a file.

**If Claude Code stops working after an update**, the app says so in plain words, keeps recording, and offers
the steps to reinstall. It does not fall back to anything else by itself.

## The hands endpoint and the phone's tools

A small HTTP server inside the app on the loopback address, port chosen at start, that accepts only the agent
token it issued. It is how Claude Code reaches the phone. Every call goes through `consent`.

| Tool Mini sees | Does | Scope | Risk |
|---|---|---|---|
| `phone_status` | Battery, network, what is allowed, what is waiting | n/a | read |
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

A card over whatever is on screen: the bot, the question in plain words with the exact details, **Yes** and
**No**, a countdown. It also appears as a notification with the same two buttons if the screen is off. The
accessibility service cannot press it. With the phone locked, an approval can be refused from the lock screen
but needs unlocking to accept.

## Voice

- **In**: Android's on-device speech recognizer. If the phone has no on-device model for the language, the app
  says so and offers typing; it does not silently use an online recognizer.
- **Out**: Android's text to speech, with the owner's choice of voice and speed; on when the prompt was spoken,
  always, or never, as on the PC.
- **Starting it**: tap the bot's microphone, the quick-settings tile, or the assistant gesture. There is no
  always-listening wake word in this plan (`11`).
- The microphone is open only between the tap and the end of speech, and the bot shows "listening" throughout.

## The app's own screens

| Screen | Holds |
|---|---|
| **Home** | The bot, its state, a prompt box; today's counts; the hub's state ("synced 2 min ago", "not at home: 143 waiting") |
| **Activity** | What Mini did on this phone |
| **Record** | What has been recorded, searchable, with delete |
| **Permissions** | One row per kind of thing, with three controls: **Collect** (on or off), **Mini on this phone** (off, ask, on) and **From my PC** (off, ask, on); "only change these on the phone"; the "never" apps; Stop |
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

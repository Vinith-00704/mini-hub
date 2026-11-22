# 10. Build plan

The order of work. Each phase ends with something the owner can use and judge. Before a phase starts, its
step-by-step plan is written and the owner approves it; this page says what each phase must deliver, not how.

## How to read a phase

- **Delivers**: what exists at the end.
- **Done when**: checks that can be shown, not opinions. "Verified on the owner's devices" means run for real,
  by the owner or with them watching, and written down in the phase report with what was not checked.
- **Needs**: what must be true first.

## Phase 0. Trials

Short, throwaway builds that answer the questions the whole plan rests on. Nothing from a trial is kept as product
code. Each has a pass mark and what happens if it fails. Run T1 first: it decides the shape of the phone's brain.

| Trial | Question | Pass | If it fails |
|---|---|---|---|
| **T1. The plugin in Termux** | Does the Mini Bot plugin load in Claude Code on the phone, in a `tmux` session, and does a prompt put into the runtime's queue over HTTP come back as a reply? Does the session survive two hours with the screen off? In permission mode `dontAsk` with the settings in `03`, is a command refused without a question, and is a plugin tool still served? | A prompt sent with `curl` to the runtime in Termux is answered, twenty times over two hours, with no restart; a request to run a command is refused and the session carries on; a stand-in plugin tool is called and answered | Use the fallback in `11` (headless streaming mode with the phone tools as a local MCP server). `08` and `09` section D are revised before Phase 3. If only the permission rules behave differently, find the settings that give the same result and write them into `03`. |
| **T2. The shell and the core** | Does a Tauri shell start a bundled Node core, hand it keys over standard input, and open an encrypted database, on this PC? What does it cost in memory with the window closed and open? | Installer builds and runs; window closed costs under 120 MB in total; a second start finds the same database | Electron replaces Tauri (`02`), or the memory target is revisited with the owner |
| **T3. The link** | Can an Android test app find the core on the home network, connect over TLS with a pinned self-made certificate, through Windows Firewall, and stay connected through the phone sleeping? | Pair, send 10,000 made-up events, pull the plug mid-way, reconnect, and end with exactly 10,000 stored | Try plain TCP with the same encryption done in the message layer; or a fixed address instead of discovery |
| **T4. Reading the phone** | On this phone and Android version, can an app installed by hand read the call log and SMS, and receive chat messages from the notification listener with sender, conversation and text? Does Android demand "allow restricted settings" first? | One real call, one SMS and one message from each of the owner's two main chat apps are captured correctly | Record what cannot be read and take it out of the plan, saying so to the owner |
| **T5. Glyph** | Does the Glyph kit drive the Phone (2a)'s lights from a hand-installed app? | One pattern plays on request | The Glyph feature is dropped from Phase 5 |
| **T6. Staying alive** | With a foreground service and battery use unrestricted, do the test app and Termux both survive a night? | Both still running after 8 hours of normal use, including the phone's own memory clean-up | Add a watchdog (WorkManager restart); if Termux still dies, the brain is started on demand instead of kept running |

Trials T1 and T6 touch the owner's daily phone. Agree a time with them, and read "Testing safely" below first.

**Needs installing first**: the Rust toolchain and the Visual Studio C++ build tools on the PC (for T2); `nodejs`,
`tmux` and `git` in Termux (for T1); and the two Termux settings in `08` (for T1), which the owner sets by hand.

## Phase 1. The hub's foundation

**Delivers**: an installable Windows app. Tray icon, global key, start with Windows. The core with its encrypted
database, the two kinds of caller (person, agent), grants, approvals, the audit log, Stop. The dashboard's frame
and design system in both themes; the Home board with fixed tiles; the Mini screen (state, prompt, streamed
reply); Permissions; Activity; Settings (appearance, start-up). Connectors: `pc` and `mini`. Mini Bot changes B and C.

**Done when**

- The installer installs, the app starts with Windows into the tray, and the key opens the window.
- With the window closed the hub uses under the memory target agreed after T2.
- A prompt typed on the Mini screen reaches Mini's session and the reply streams in.
- Stop in the dashboard ends an ongoing computer-control task in the bot; stopping in the bot shows as stopped in the dashboard.
- Tests 1, 2, 3, 4, 7 and 8 from `03` pass.
- The owner has seen Home, Permissions and Activity as real screens in both themes and agreed the look
  (mockups first: `07`, "Left to the builder").
- A search of the tracked files for secrets and personal data finds nothing (`03`).

**Needs**: T2.

## Phase 2. The phone's record

**Delivers**: the phone app, signed, installed by hand: onboarding, pairing with the hub, the collectors for calls,
SMS, chat notifications, other notifications and phone state, the encrypted record, the sync, the phone's own
Permissions and Record screens, the foreground service. The floating bot, shown and movable, with Hide and Stop,
not yet able to answer. In the hub: the `android` connector, pairing, the Devices screen, the Inbox, and the
calls, messages, notifications and device-status tiles.

**Done when**

- A call, an SMS and a chat message on the phone appear in the dashboard within 5 seconds while linked.
- With the PC off for a day, the phone keeps recording; when the PC comes on at home, everything arrives, in
  order, with nothing twice. Verified on the owner's devices.
- With a collect switch off, nothing of that kind is stored on the phone or sent. Shown by a test and by looking.
- Removing the phone in the dashboard stops it syncing at once.
- Tests 5, 9 and 12 from `03` pass; the protocol's example files pass on both sides.
- Stop Mini on the dashboard shows "Stopped from your PC" on the linked phone.
- Battery and memory are measured over two days of real use and are within the targets in `08`, or the owner has
  agreed new ones.

**Needs**: Phase 1, T3, T4, T6.

## Phase 3. Mini on the phone

**Delivers**: the brain's keeper and the setup screen; the hands endpoint with the two tools that need no
accessibility service (`phone_status`, `phone_read`); the "Mini on this phone" list and approvals on the phone;
voice in and out; the bot answering by text and by voice; `mini_action` events; Mini Bot change D. The phone
works with the PC off.

**Done when**

- With the PC switched off, the owner asks the bot by voice "who called me today?" and gets a correct spoken
  answer. Verified on the owner's devices.
- With `phone.calls.read` off, the same question gets "that is switched off", and the Activity screen shows the refusal.
- Hiding the bot while it listens leaves an indicator on screen.
- Killing Termux by hand: the bot shows **asleep**, the keeper brings the brain back, and a prompt works again.
- Asked to run a command or read a file outside its work folder, Mini on the phone is refused and says so.
- Another app on the phone (a test app without the secrets) cannot queue a prompt, read a reply or call the hands endpoint.
- What Mini did on the phone while the PC was off appears in the dashboard's Activity after the next sync.
- A night of normal use with the brain kept running costs no more battery than the target, or the owner chooses
  "start on demand".

**Needs**: Phase 2, T1.

## Phase 4. Mini uses the hub, and the dashboard becomes the owner's own

**Delivers**: Mini Bot change A (the four `hub_*` tools). The `mail` connector and its tile. Boards with edit
mode, the widget gallery, several boards, quick actions, the command box with search. Retention settings, export
and import.

**Done when**

- On the PC, "what did I miss this morning?" is answered from calls, messages and mail, and each read is in the
  Activity screen.
- With a grant on **ask**, the question waits for the owner's answer in the dashboard, and the bot says so.
- A mail arrives in the Inbox within a minute; "draft a reply" puts a draft in the account; "send it" asks first
  and shows the exact text.
- The owner rearranges a board, adds and removes tiles, makes a second board, and finds it all as they left it
  after a restart.
- An export followed by an import on a clean data folder gives back the same events and boards.

**Needs**: Phase 2 (Phase 3 is not required; the two can run in either order).

## Phase 5. Controlling the phone, and fitting the Nothing Phone

**Delivers**: the accessibility service; `phone_look`, `phone_act`, `phone_set`, `phone_send`; the closed places
and the "never" apps; the control indicator and limits; commands from the hub with the "From my PC" list (`ring`,
settings, reading the screen, reply from the Inbox) and `mirror`. The quick-settings tiles, the widgets, the
assistant gesture, the Glyph patterns.

**Done when**

- "Open the camera" and "turn on Do Not Disturb" work by voice on the phone and from the PC, with the red edge showing.
- "Reply to Ravi: on my way" shows the exact text and the recipient and sends only after Yes; No sends nothing.
- The service does nothing in a banking app and in the phone app itself; tests 10 and 13 from `03` pass.
- With "From my PC" off for control, Ring from the dashboard is refused and the dashboard says which switch on the phone to change.
- A purchase screen turns the next tap into a question.
- Stop on the phone ends a control task within a second; Stop on the PC ends it too.
- The tile, a widget and the assistant gesture each open Mini's prompt. A Glyph pattern plays while Mini works.

**Needs**: Phase 3, T5.

## Phase 6. The home and the Echo Dot

**Delivers**: the `home` connector with the adapters the owner's devices need (`11`), the House screen and tiles,
scenes. The `alexa` connector: the skill's setup, the checked route, the tunnel, spoken answers and "what did you
find", "safe by voice".

**Done when**

- Each of the owner's appliances that can be reached shows its state and switches from the dashboard, and by
  asking Mini. Those that cannot are listed with the reason.
- "Alexa, ask Mini whether I have any missed calls" is answered, or deferred and then answered, and is refused
  politely with `voice.alexa.private` off.
- A request with a bad signature is refused; tests 6 and 11 from `03` pass.
- "Alexa, ask Mini to open my browser" is refused as not available by voice, and nothing happens on the PC.
- Turning the `alexa` connector off closes the tunnel and the listener. Shown by checking that the address no
  longer answers.

**Needs**: Phase 4; the owner's answers on appliances and on the tunnel in `11`.

## Phase 7. Finishing

**Delivers**: the dashboard lock; privacy mode; the generic connector for simple gadgets; backup reminders; an
in-app "what changed" page; a clean-install guide for the PC and the phone; a review of every screen for
keyboard use and screen readers; a security read-through of the whole against `03`.

**Done when**: a fresh Windows user account and a factory-fresh test phone (or an emulator for everything but the
Nothing features) can be set up from the guide alone.

## Not in this plan

Kept out on purpose; each would be its own plan: phone location and "find my phone" on a map; an always-listening
wake word on the phone; reaching the hub from outside the home; a second user; the Claude phone app as another
way in; the PC as a device other PCs can control.

## Testing safely

- **Scratch data only.** Every automated test and every manual run during development sets `MINI_HUB_HOME` to a
  throwaway folder, seeded by `tools/seed.mjs` with made-up people. The owner's real data folder is opened only
  by the installed app.
- **The bot's runtime.** Test it over HTTP with a scratch `MINI_BOT_HOME`, with hotkeys off and a position away
  from the owner's real bot. Do not start a real Claude Code session against a test runtime unless the test
  truly needs one: the plugin's stored settings are shared between the installed plugin and a working copy, so a
  test session pushes the owner's real settings into the test runtime and can start a second hidden session. If
  it is needed, keep it to one short run, stop the test runtime straight after, and tell the owner.
- **Consent surfaces are never clicked by a script**, on the PC or the phone, in a test or otherwise. Tests of
  approvals call the core's person route with the test's own person key in a scratch core; they do not drive the
  real dashboard's or the real bot's buttons. A real grant on the owner's devices is turned on by the owner.
- **The phone.** It is the owner's daily phone and nearly full. Use an emulator for everything that does not
  need the real device. On the real phone: install only the test build for the current phase; never type with
  `adb input` (an open Claude Code session in Termux takes it as a prompt); never lock, wake or restart it
  without asking; remove test builds and their data when the trial is over.
- **Mail.** Test against a local IMAP test server with made-up mail. The owner's real account is connected only
  by the owner, in the installed app.
- **The Alexa route.** Test the signature check with recorded, made-up requests. The tunnel is opened only by the owner.

## Tests every phase keeps green

| Layer | Kind | Run with |
|---|---|---|
| Protocol | Every example file parses and round-trips on both sides | `npm test`, `./gradlew test` |
| Core | Unit tests for rules, audit and sync; API tests against an in-memory database; the numbered checks in `03` | `npm test` |
| Dashboard | Component tests; whole-screen tests against a fake core, in both themes, at 900 px and 1280 px | `npm test`, Playwright |
| Phone app | Unit tests for consent, the record and the link; screen tests for the approval card and the permissions screen | `./gradlew test` |
| Mini Bot | Its own suites, unchanged and passing, plus tests for each change in `09` | `claude plugin test .`, `node --test runtime/test/*.test.mjs` |
| By hand | The phase's "Done when" list, on the owner's devices | With the owner |

## What a phase report says

What was built; which "Done when" checks passed, with how each was checked; what was verified on real devices and
what only in tests; what was not done and why; measurements against the targets; anything in the docs that
changed; and the result of the search for secrets and personal data in tracked files.

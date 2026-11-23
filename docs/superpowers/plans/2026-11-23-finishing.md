# Phase 7: Finishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 7 of `docs/10-build-plan.md`, the last phase. Mini Hub can lock itself after an idle time the
owner chooses and opens again only with Windows Hello or a PIN, and while it is locked the window holds no key and
shows no data, though Stop still works. Privacy mode blurs every preview of other people's words, and has its own
button. Small gadgets that Mini Hub does not know by name can be described by the owner, either as a web address on the
home network or as topics on the owner's MQTT broker, and then behave like any other home device. Mini Hub reminds the
owner to export a backup. A "What changed" page shows what each update brought. A new docs page walks the owner,
step by step, from a fresh Windows account and a factory-fresh phone to everything working, and ends with every step
that only the owner can do. Every screen, on the dashboard and on the phone, is reviewed for keyboard use and screen
readers. On the phone, a TalkBack user can now say Yes, but only through the phone's own fingerprint or screen-lock
check. Last, the whole system is read through against `docs/03`, and the findings are written down and fixed.
**Done when** a fresh Windows user account and a factory-fresh test phone (or an emulator, for everything but the
Nothing features) can be set up from the guide alone.

**Architecture:** Six pieces.

- **The lock lives in the shell, not in the page.** The shell (Rust) keeps a `locked` flag. While it is set, `hub_keys`
  refuses (`LOCKED`), so a window that loads gets no person key and can only show the lock screen. On lock, the shell
  reloads the window (`eval("location.reload()")`), which drops the key and every cached answer from its memory. The
  shell counts idle time from the window's own input (sent by the page at most every 30 s) and from wall-clock time,
  so a closed window or a sleeping PC counts as idle. Windows Hello is asked by the shell itself through
  `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` (the `windows` crate the lock file already has). A
  PIN is checked by the core, which keeps only its scrypt hash in the encrypted database and limits wrong tries. The
  shell calls the core with the person key, as the tray's Stop already does.
- **Small dashboard features:** privacy mode finished (`privacy-blur` everywhere a preview shows, a top-bar button,
  approvals never blurred); backup reminders (`GET/PATCH /v1/backup`, the export records its time); the What changed
  page (`#/changes`, its text bundled in the dashboard) with a one-time banner after an update; Mini Hub and the phone
  app become **0.7.0**.
- **Gadgets you describe** are two more adapters, `web` and `mqtt`, inside Phase 6's `home` connector. They are not a
  separate connector, so they get House, tiles, "Mini may use this device", scenes, the guarded kinds and "safe by
  voice" for free. The owner writes the exact requests or topics. Mini can only say on, off or a brightness. Every
  connection goes through Phase 6's local-only checks (`lanFetch`, and a new `lanConnect` for MQTT's socket).
- **The phone: Yes for TalkBack.** A click on Yes that is not a real finger (TalkBack's double-tap, Switch Access) no
  longer does nothing. It opens `ConfirmYesActivity`, which asks Android's own `BiometricPrompt` (fingerprint or the
  phone's screen-lock PIN, pattern or password). Only a success there answers Yes. Then comes a screen-reader pass over
  every phone screen.
- **Reviews:** keyboard and screen readers on every dashboard screen; a security read-through of the whole system
  against `docs/03`, written down in `docs/13-security-review.md` with its fixes.
- **The guide:** `docs/12-setting-up-from-scratch.md`, for the owner, with the master checklist of every owner step.

```
 window (no key while locked)          shell (Rust)                                   core (127.0.0.1)
 ----------------------------          ------------                                   ----------------
 main.tsx: invoke hub_keys ---------> locked? Err("LOCKED") : { api, key }
 LockScreen: unlock_hello ----------> RequestVerificationForWindowAsync(hwnd) -> Verified -> locked = false -> POST /v1/lock/unlocked (audit)
 LockScreen: unlock_pin(pin) -------> POST /v1/lock/check { pin } (x-hub-ui) -------------> scrypt compare, wrong-try limit -> { ok, wait }
 LockScreen: lock_stop -------------> post_stop (as the tray)
 any input (<= every 30 s) ---------> lock_activity -> last = now
                                      ticker 15 s: on && now - last >= idle -> locked = true, window.eval("location.reload()")
```

**Tech Stack:** As before (Node 24 core, Fastify, zod 4, SQLCipher; React 19, TanStack Query and Router; Tauri 2.12;
Kotlin with Android Views). Additions, each checked on its registry on 2026-11-23 and more than two weeks old:

- **Shell:** `windows` **=0.62.2** (2025-10-06, already in `shell/src-tauri/Cargo.lock` through Tauri; features
  `Security_Credentials_UI`, `Win32_System_WinRT`, `Win32_Foundation`, `Win32_System_Com` checked to exist in that
  version's `Cargo.toml`) and `windows-future` **=0.3.2** (already in the lock; it owns `IAsyncOperation` and its
  blocking `join()` in 0.62). In `windows-0.62.2/src/Windows/Win32/System/WinRT/mod.rs`,
  `IUserConsentVerifierInterop::RequestVerificationForWindowAsync<T>(&self, HWND, &HSTRING) -> Result<T>` exists. No
  Tauri plugin is used: `tauri-plugin-biometric` 3.0.0-alpha.3 is Android, iOS and macOS only, and the few "Windows
  Hello" crates on crates.io are tiny, recent and unreviewed.
- **Core:** `mqtt-packet` **9.0.2** (2025-03-04, MIT; depends on `bl`, `debug`, `process-nextick-args`), only to write
  and parse MQTT 3.1.1 packets. No full MQTT client: `mqtt` 5.16.1 pulls in `ws`, `commist`, `help-me` and more, and it
  makes its own sockets, which would get round `lanConnect`.
- **Phone:** no library. `android.hardware.biometrics.BiometricPrompt` (framework, API 30+ for
  `setAllowedAuthenticators`; minSdk is 33) and the normal install-time permission `USE_BIOMETRIC`.

**Spec:** `docs/10-build-plan.md` (Phase 7, Testing safely, What a phase report says),
`docs/03-security-and-permissions.md` (all of it: The dashboard itself; Approvals; Keys and secrets; The network;
Keeping the repository clean), `docs/06-connectors.md` (the generic connector line, The interface, `home`),
`docs/07-dashboard-design.md` (Settings > Lock, Look > privacy mode, Accessibility, Words),
`docs/08-android-app.md` (Approvals on the phone, The app's own screens, Building and installing the APK),
`docs/04-data-and-sync.md` (What is kept, the backup), `docs/11-open-decisions.md` (Risks: "Export reminders"; D5, D12).

## What already exists (built, or planned in Phases 4–6 and finished before this phase; not planned again)

- **Today, in the code:**
  - The shell (`shell/src-tauri/src/lib.rs`) holds the person key in `Mutex<Hub>` and hands it out through `hub_keys`,
    which the dashboard calls at load in `ui/src/main.tsx` through `keysFromShell()` (`ui/src/app/keys.ts`).
  - The tray has Open, Stop Mini and Quit. `process::post_stop(port, key)` calls the core with `x-hub-ui` through
    `ureq` 3. `keyring` 3 holds the database key. The CSP allows `'self'` and `127.0.0.1` only. There are `cargo test`
    tests in `lib.rs` and `process.rs`. The only capability is `core:default` (it includes events).
  - The core's person routes use `config: { access: 'person', audit: '<action>' }` (`core/src/api/server.ts`). The
    store has `getMeta`, `setMeta`, `getSetting` and `setSetting` (`core/src/store/db.ts`). pino's `REDACT` is in
    `core/src/log.ts`. `VERSION = '0.1.0'` is in `core/src/hub.ts`, and every `package.json`, `tauri.conf.json` and
    `Cargo.toml` says 0.1.0.
  - Privacy mode exists in part. It is the `privacy` field of the `ui` settings (`routes/settings.ts`), a switch in
    Settings > Look ("Blurs message previews until you point at them."), and the `.privacy-blur` class in
    `ui/src/design/tokens.css` (outside the generated `tokens:start` block; it is revealed on `:hover` and
    `:focus-within`). It is used in `widgets/list.tsx` (`EventList`), the Inbox list and the phone's page only.
  - Phone: `overlay/ApprovalCard.kt` has `TapGuard` (Yes counts only for a real finger, within 500 ms, armed 600 ms) and
    `answerRow`. Buttons are data-sensitive on API 34+. The approval notification has No and Open, never Yes. The
    deferred minor from Phase 3's review: "TalkBack/Switch Access users can say No but not Yes (ACTION_CLICK)". Only 3
    accessibility attributes (`contentDescription` and the like) exist in all of `ui/` and `overlay/`.
- **Phase 4 (plan `2026-11-23-hub-for-mini.md`):**
  - Connector plumbing: `setup(ctx, session, step, input)`, `remove`, `Ctx.secrets`, `Ctx.settings` and `Ctx.grants`,
    the setup route with 15-minute sessions, and `SetupWizard.tsx` with `AddDevice.tsx`.
  - Boards, edit mode, the gallery and the widget registry. The command box (`features/frame/CommandBox.tsx`, with its
    "Go to" list).
  - Settings > Look, Boards, Data, Network, Start-up and About, addressed as `#/settings?section=<id>` (its ledger's
    ruling F3).
  - Export and import (`core/src/data/archive.ts`, `routes/data.ts`, `POST /v1/data/export` with `{ path,
    passphrase }`; the backup carries the `ui` and `retention` settings, never secrets, grants or the audit log), and
    the shell's `pick_backup_save` and `pick_backup_open`. `ui/src/app/shell.ts` gives `inShell()` and its own
    `invoke(cmd, args)`.
  - Retention, the network summary, and plugin 0.9.0 (`hub_*` tools).
- **Phase 5 (plan `2026-11-23-phone-control.md`):**
  - Phone app 0.6.0 (`versionCode = 6`), with the accessibility service `hands/MiniAccess` (`isAccessibilityTool="false"`),
    `Closed`, `OwnWindows`, `Control`, the red edge `overlay/ControlEdge`, and `consent/NeverApps`.
  - `ui/SettingsScreen.kt` and `ui/NeverScreen.kt`, the mirror, the `nothing/` tiles, widgets and assistant, and
    `voice/AskActivity`.
  - `TapGuard.accepts()` is false for 1,000 ms after a gesture that `MiniAccess` dispatched (`Control.lastGestureEnd`).
  - Plugin 0.10.0.
- **Phase 6 (plan `2026-11-23-home-and-alexa.md`):**
  - The `home` connector frame (`core/src/connectors/home/`) with the `Adapter` contract (`discover?`, `probe`,
    `connect`, `read`, `set`), `lanFetch`, `lanSocket`, `lanUdp` and `isLan` (private IPv4 only, no redirects, 3 s,
    1 MiB), `REASONS` and `HomeFailure`.
  - The setup steps (`how`: `look` or `address`), the poller (10 s with a dashboard, 60 s without), the actions `list`,
    `get`, `set`, `set_guarded` and `scene`, the per-device "Mini may use this device" share, and the guarded kinds.
  - `protocol/src/home.ts` (`HOME_KINDS`, `ADAPTERS`, `homeChange`, `HomeState`, `sceneSchema`). Field kind `checks`
    and `copy` blocks in the wizard.
  - The Shelly, WLED, Tasmota, Hue and Kasa adapters. House (`features/house/`), `HomeDevicePage.tsx`, `DeviceTile.tsx`
    and the home tiles.
  - The `alexa` connector, the tunnel, and plugin 0.11.0 (change E, room turns).
- **Not built anywhere:** the lock and Settings > Lock; backup reminders; the What changed page; gadgets you describe;
  Yes for TalkBack; the guide; `docs/12` and `docs/13`.

## Global Constraints

- **The owner commits.** No task runs `git commit`, `push`, `stash`, `reset`, `checkout -- …`, or anything else that
  changes git's index, refs or history, in `F:\mini-hub` or `F:\claude mini-bot`. A version is raised in the same piece
  of work as its code.
- **No new tests and no seed, demo, example or test data.** No new test file, suite or case: no new `*.test.ts(x)`,
  no new Kotlin test, no new Rust `#[test]` function, no saved Playwright script. No new protocol example file, fake
  record, made-up gadget, recorded MQTT traffic, stand-in broker or fake device. The owner tests with their own data
  and devices. Existing suites stay green. When a change alters behaviour that an existing test pins, update that test
  minimally and say so in the report. Checks (type checks, builds, existing tests) are run, not skipped.
  `tools/seed.mjs` and `tools/dev.mjs` are not changed. Manual looks use a scratch hub with what it already holds, and
  add nothing to it.
- **Permission first. Nothing new acts by itself.**
  - The lock is **off** until the owner turns it on.
  - A gadget is added only from the owner's wizard, starts **not shared with Mini**, and is switched by the wizard's
    "try" step only when the owner picks that choice.
  - A backup reminder only shows a line. It never exports, chooses a path or stores a passphrase.
  - No code, test, script or import writes a grant, a share or a "safe by voice" tick.
- **Only the owner's own action grants or answers.**
  - Windows Hello's dialog, Android's `BiometricPrompt`, TalkBack, Narrator, the accessibility service and every
    consent surface are used only by the owner. Never script, click or `adb` any of them, on the phone, an emulator or
    the PC.
  - On the phone, **Yes** answers only for (a) a real finger on Yes, as today, or (b) a success in Android's own
    `BiometricPrompt` with `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`, started from Yes for that one open question.
  - The notification never gets a Yes. A gesture dispatched by Mini's own service never reaches either path.
- **The lock really locks.**
  - While locked, the window holds no person key (`hub_keys` refuses `LOCKED`, and the window is reloaded). It shows no
    data, no counts, no names and no approval text.
  - Stop Mini always works while locked: from the tray, the global Stop, and the lock screen's **Stop Mini**.
  - A PIN is 4–12 digits. It is never stored as text, never logged, never audited and never exported, and exists in
    memory only for one check. Only `{ salt, hash }` from `scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1 })` is kept,
    in the encrypted database under the settings key `lock`, which the backup does not carry.
  - Wrong PINs: after 5 in a row, a wait of 60 s, then doubling for each further wrong one, at most 30 minutes. The
    count lives in `meta` `lockFails`, so quitting does not reset it. A right PIN or a Windows Hello unlock resets it.
- **Local only.**
  - Gadgets reach only private IPv4 addresses, through `lanFetch` or `lanConnect` (Task 4). No other socket and no
    host name.
  - MQTT is plain MQTT 3.1.1 on the home network, QoS 0. No wildcard subscription (`+`, `#`) and no `$` topics.
  - The dashboard still loads nothing from the internet, and the What changed page is bundled text.
- **Secrets and words stay inside.**
  - New secrets live only in the encrypted `secrets` table: a web gadget's password (`<endpointId>.password`) and an
    MQTT broker's password (`<endpointId>.password`). They are never returned by a route, never in `info` or `state`,
    never logged, never exported, and never filled back into a form ("Leave empty to keep the one set").
  - pino's `REDACT` gains `pin`, `topic`, `payload`, `passphrase` (if missing), `*.pin`, `*.topic` and `*.payload`.
  - No log line, audit row or event holds a gadget's request path, body, topic, payload or answer. Counts, adapter
    names and addresses are fine.
- **Capture is never hidden; Stop always works.** Nothing in this phase changes the indicators. The lock never hides
  Phase 5's red edge or banner, which belong to the phone.
- **Made-up values only** in code, comments and docs: `192.168.1.20`, `asha@example.com`, `Asha Example`,
  `+1 555 0123`, `home/example-lamp/set`, `pc-example.tailnet-example.ts.net`. The guide names no real account,
  repository owner, network or device. Where the owner's GitHub name is needed, it says `<your GitHub name>`.
- **Words** are plain and short, sentence case, with no exclamation marks and no "successfully". The tasks give exact
  strings. Where they give none, follow `docs/07` > Words.
- **The look:** dashboard parts from `ui/src/components/look/` and tokens from `design/tokens.json`. Phone parts from
  `ui/look/` and `ui/Kit.kt`. Never edit the generated block of `tokens.css` or the generated token files
  (`npm run tokens`). Every screen and tile handles loading, empty, error and "not allowed".
- **Keyboard and screen readers** (`docs/07` > Accessibility) for everything new: reachable by Tab in reading order,
  visible focus, `Esc` closes the top layer, a name for every control, and changes that matter announced
  (`role="status"` or `aria-live`). Nothing depends on hover alone or on colour alone. On the phone: a
  `contentDescription` or visible text on every control, headings marked, touch targets of at least 48 dp, and text in
  `sp`.
- **Versions:** Mini Hub **0.7.0**, in `core/src/hub.ts` `VERSION`, `core`, `ui`, `protocol` and `shell`
  `package.json`, `shell/src-tauri/tauri.conf.json` and `Cargo.toml` (`Cargo.lock` by cargo). Phone app **0.7.0**
  (`versionCode = 7`). The Mini Bot plugin becomes **0.12.0** only if a task changes it (in this plan, only a Task 9
  fix can), raised in `.claude-plugin/plugin.json` in the same piece of work.
- **Project facts:**
  - Node 24 type stripping in the core: no enums, parameter properties or namespaces; imports use `.ts`.
  - The plugin's mod loader passes `$` across imports only into function declarations.
  - Android: Views, minSdk 33, targetSdk 36, AGP 9.0.1, OkHttp 5.4.0, SQLCipher `rawQuery(sql, *args)`.
  - In Git Bash, write files with the editor tools (long heredocs fail).
  - The installer needs `export PATH="$HOME/.cargo/bin:$PATH"`.
- **Testing safely** (`docs/10`):
  - Use a scratch `MINI_HUB_HOME` and `MINI_BOT_HOME`. No real Claude Code session against a test runtime.
  - On the owner's phone: nothing typed with `adb input`; no lock, wake or restart; nothing installed except this
    phase's build, by the controller, with the owner's go-ahead.
  - No device or gadget is switched by anyone but the owner.
- **Checks** (run what the task touches; all of them in Task 10):
  `cd /f/mini-hub && npm run check` · `npm test` · `npm run build -w @minihub/ui` ·
  `cd /f/mini-hub/shell/src-tauri && cargo test` (with the PATH above) ·
  `cd /f/mini-hub/android && ./gradlew :app:testDebugUnitTest :app:assembleRelease` ·
  and only if the plugin changed:
  `cd "/f/claude mini-bot" && claude plugin validate . && claude plugin test . && node --test "runtime/test/*.test.mjs"`
  (scratch `MINI_BOT_HOME`).

**Rulings made while planning** (the owner may want to know; each changes a doc in the task named):

- **The lock is the shell's, and it is a screen lock.** It keeps a person at the unlocked PC from seeing or changing
  Mini Hub. It does not encrypt anything new: a program already running as the owner can read what the owner can
  (`docs/03`, Out of scope). Idle means no input in Mini Hub's window, and a closed window or a sleeping PC counts as
  idle. The window starts locked at each start while the lock is on. Choices: 1, 5 (default), 15, 30 or 60 minutes
  (Tasks 1, 2; `docs/03`, `docs/07`).
- **Windows Hello always unlocks; a PIN is the alternative.** "Unlock with" is Windows Hello (Windows' own face,
  fingerprint or Windows PIN) or a PIN for Mini Hub. A PIN lock still offers Windows Hello when the PC has it set up.
  So the way back from a forgotten PIN is to set up Windows Hello in Windows' Sign-in options and use it. There is no
  back door, file or start flag that removes the lock (Tasks 1, 2; `docs/03`).
- **Stop works while locked; nothing else does.** Approvals wait until the owner unlocks. The bot's "Open Mini Hub"
  then opens the lock screen (Task 2; `docs/03`).
- **Approval cards are never blurred** in privacy mode. What the owner says Yes to stays readable (Task 3; `docs/07`).
- **Backup reminders default to every month**, as a quiet line on Home that links to Settings > Data. "Never" is one
  choice away. The first reminder comes a week after Mini Hub's first start if no backup was ever made (Task 3;
  `docs/04`).
- **The generic connector is built as two `home` adapters**, `web` and `mqtt`, so a gadget appears in House like any
  lamp, can be shared with Mini or not, can be guarded ("If it opens a door, a garage or a lock, choose that kind"), and
  can be put in scenes. It is not a new connector with its own scopes (Tasks 4, 5; `docs/06`).
- **MQTT through the owner's own broker on the home network only**, in plain MQTT 3.1.1 with an optional user name and
  password: home brokers rarely run TLS. `mqtts`, wildcards and QoS 1 and 2 are left out. This also reaches Zigbee
  devices through Zigbee2MQTT and ESPHome devices through their MQTT option (Task 5; `docs/06`, `docs/03`).
- **TalkBack says Yes through the phone's own check.** Double-tapping Yes with TalkBack or Switch Access opens
  Android's fingerprint or screen-lock prompt for that one question. Only its success answers Yes. A phone without a
  screen lock says "To answer Yes without touching the screen, set a screen lock on this phone first." A real finger
  on Yes works as before (Task 6; `docs/08`, `docs/03`).
- **Version 0.7.0** for Mini Hub and the phone app, after the phase number. Mini Hub said 0.1.0 until now. The owner
  may choose to call a later release 1.0 (Task 3).
- **The What changed page is on the dashboard only.** It lists the PC, the phone and the Mini Bot. The phone app gets
  no page of its own in this phase (Task 3; `docs/07`).
- **The security read-through is a tracked doc,** `docs/13-security-review.md`. It holds one row per finding: where it
  is, how bad, the fix, and fixed or accepted with the reason. Critical and Important findings are fixed in the task
  (Task 9).
- **The guide's trial uses a separate Windows account and an emulator or a spare phone,** never the daily phone. A
  phone pairs with one hub, so pairing the daily phone with the trial account's hub would unpair it from the owner's
  real hub (Task 10, Owner steps).
- **Deferred, said plainly:**
  - Locking when Windows locks, rather than on idle.
  - A lock or a What changed page on the phone.
  - `mqtts`, wildcards and the colour trait for gadgets.
  - Accessibility of the C# bot overlay on the PC (it is the Mini Bot's own window, not a Mini Hub screen).

## Review Focus

1. **RF1 The lock locks:**
   - No path gives the window the person key while locked (start, reload, a new window, the single-instance second
     launch, the global key).
   - Idle in every form locks: a closed window, sleep, no input.
   - The lock screen shows nothing private. Stop works. The PIN is never logged, stored as text or exported, and wrong
     tries are limited across restarts (Tasks 1, 2).
2. **RF2 Only the owner says Yes on the phone:** a non-touch click on Yes opens only the system's own check, for that
   question only. A success after the question ended, was answered, or was replaced does nothing. A gesture by Mini's
   own service never counts (Task 6).
3. **RF3 Gadgets stay home and do only what the owner wrote:** every socket goes through `isLan`. Mini sends only on,
   off and an integer brightness, and no text of Mini's reaches a path, body, topic or payload. No wildcard
   subscription. Secrets are never shown back (Tasks 4, 5).
4. **RF4 Nothing new acts by itself:** the lock starts off, gadgets start unshared, a reminder never exports, and the
   try step switches only on the owner's choice (Tasks 1, 3, 4, 5).
5. **RF5 Privacy mode covers every preview** of names and words, reveals on focus as well as hover, and never blurs an
   approval (Task 3).
6. **RF6 Keyboard and screen readers, everywhere:** every dashboard and phone screen passes the checklist in Tasks 6
   and 7, and what was not fixed is listed (Tasks 2, 3, 6, 7).
7. **RF7 The guide alone is enough:**
   - Every owner step of Phases 2b–6 is in it, in an order that works from nothing.
   - It holds no personal data.
   - It matches the real screens' words (Tasks 8, 10).
8. **RF8 The read-through is complete:** every section of `docs/03` and every rule in `AGENTS.md` has a verdict, and
   every Critical or Important finding is fixed or explicitly accepted by the owner (Task 9).

---

### Task 1: Shell and core: the lock — idle, Windows Hello, a PIN, no key while locked

**Files:**
- Create: `shell/src-tauri/src/lock.rs`, `shell/src-tauri/src/hello.rs`, `core/src/lock.ts`,
  `core/src/api/routes/lock.ts`.
- Modify:
  - `shell/src-tauri/src/lib.rs` (state, commands, tray item, `hub_keys`), `shell/src-tauri/src/process.rs` (two small
    `ureq` calls beside `post_stop`), `shell/src-tauri/Cargo.toml` (`[target.'cfg(windows)'.dependencies]`) and
    `Cargo.lock` (by cargo).
  - `core/src/api/server.ts` (register the routes), `core/src/log.ts` (`REDACT`).
  - Docs: `docs/03-security-and-permissions.md` (The dashboard itself), `docs/05-hub-api.md` (the lock routes),
    `docs/02-tech-stack.md` (the `windows` crate, and why no plugin).

**Interfaces — Produces:**

```ts
// core/src/lock.ts
export const IDLE_MINUTES = [1, 5, 15, 30, 60] as const
export const lockSchema = z.object({ on: z.boolean(), idleMinutes: z.union(IDLE_MINUTES.map(n => z.literal(n))),
  method: z.enum(['hello', 'pin']), pin: z.string().regex(/^\d{4,12}$/).optional() }).strict()
export type LockInfo = { on: boolean; idleMinutes: number; method: 'hello' | 'pin'; pinSet: boolean }
export class Lock { constructor(db: Store, now?: () => number)
  info(): LockInfo
  set(input: z.infer<typeof lockSchema>): LockInfo   // throws ApiFailure 400 on the rules below
  check(pin: string): { ok: boolean; wait: number }   // wait in seconds, 0 when a try is allowed
  unlocked(method: 'hello' | 'pin'): void }           // resets lockFails
// routes (person only):
// GET  /v1/lock            -> LockInfo
// PUT  /v1/lock            body lockSchema -> LockInfo                    audit 'lock' (data: on, method, idleMinutes)
// POST /v1/lock/check      { pin } -> { ok, wait }                        self-audited: 'unlock' (method pin) or 'unlock-refused' (data: count)
// POST /v1/lock/unlocked   { method: 'hello' } -> { ok: true }            self-audited: 'unlock' (method hello)
```

```rust
// shell/src-tauri/src/lock.rs (pure; no Windows calls)
pub struct LockState { pub on: bool, pub idle_secs: u64, pub method: Method, pub locked: bool, last_activity: SystemTime }
impl LockState { pub fn touch(&mut self, now: SystemTime); pub fn due(&self, now: SystemTime) -> bool; pub fn apply(&mut self, info: &LockInfo) }
// shell/src-tauri/src/hello.rs (#[cfg(windows)]; a stub elsewhere that answers NotAvailable)
pub enum HelloState { Available, NotSetUp, NoDevice, OffByPolicy, Busy, Unknown }
pub fn availability() -> HelloState                    // UserConsentVerifier::CheckAvailabilityAsync()?.join()
pub fn verify(hwnd: HWND, message: &str) -> Result<bool, String>   // RequestVerificationForWindowAsync, Verified -> true
// Tauri commands (lib.rs):
// hub_keys            -> Err("LOCKED") while locked (checked before anything else)
// lock_info           -> { on, locked, method, hello: "available"|"not-set-up"|"no-device"|"off-by-policy"|"busy"|"unknown", wait }
// lock_activity       -> ()      (the page calls it at most every 30 s)
// lock_now            -> ()      (only when on)
// lock_reload         -> ()      (re-reads GET /v1/lock after the page saved it)
// unlock_hello        -> Result<(), String>
// unlock_pin(pin)     -> Result<(), String>   // Err carries the words to show
// hello_check         -> Result<bool, String> // Settings uses it before choosing Windows Hello
// lock_stop           -> Result<(), String>   // the tray's Stop, usable while locked
```

Behaviour:

- **Core rules** (`Lock.set`):
  - `on: true` with `method: 'pin'` needs a PIN already set or `pin` given. Otherwise 400 `bad-request` "Choose a PIN
    of 4 to 12 digits."
  - A given `pin` is hashed with a fresh 16-byte salt (`scrypt`, the parameters in Global Constraints) and the hash
    replaces the old one.
  - `on: false` deletes the hash. `method: 'hello'` keeps no PIN.
  - Stored as the settings key `lock` (`{ on, idleMinutes, method, pin?: { salt, hash } }`, base64). Default
    `{ on: false, idleMinutes: 5, method: 'hello' }`.
- **`Lock.check(pin)`:**
  - With `lockFails.until > now` it answers `{ ok: false, wait }` and does not compare.
  - Otherwise it compares with `timingSafeEqual`. A right PIN resets `lockFails` and answers `{ ok: true, wait: 0 }`.
  - A wrong PIN adds 1. At 5 or more, `until = now + min(60 s × 2^(count − 5), 30 min)`.
  - The body is parsed with `{ pin: z.string().regex(/^\d{4,12}$/) }`. Anything else is 400 "A PIN is 4 to 12 digits."
    and is not counted.
  - No log line carries the body.
- **The shell's state.**
  - `Hub` gains `lock: LockState`. After the core is ready (`start_hub`), the shell reads `GET /v1/lock` with the
    person key. If that fails, the lock stays as last known: off at first start, and that is said in the report.
  - With `on`, the shell starts `locked = true`.
  - A ticker thread wakes every 15 s. When `on && !locked && due(now)`, it sets `locked = true` and, if the window
    exists, calls `window.eval("location.reload()")`.
  - `due` compares `SystemTime` (wall clock), so time asleep counts, and a clock that goes backwards counts as 0.
  - `lock_activity` sets `last_activity = now` and is ignored while locked.
  - `lock_now` sets locked and reloads.
  - `lock_reload` reads `GET /v1/lock` again. If the lock was just turned on, the idle count starts from now.
- **`hub_keys`** returns `Err("LOCKED")` while locked, before the core-died check.
- **Unlocking.**
  - `unlock_hello` takes the main window's `hwnd()` and runs `hello::verify` inside
    `tauri::async_runtime::spawn_blocking`, never on the main thread. The message is "Unlock Mini Hub". On `Verified`
    it clears `locked`, sets `last_activity = now`, and posts `/v1/lock/unlocked { method: 'hello' }` (a failure to
    post only logs a count-free line).
  - Results map to words: `Canceled` → `Err("Not unlocked.")`; `DeviceNotPresent` / `NotConfiguredForUser` →
    `Err("Windows Hello is not set up on this PC. Set it up in Windows Settings > Accounts > Sign-in options.")`;
    `DisabledByPolicy` → `Err("Windows Hello is turned off on this PC by a policy.")`; `RetriesExhausted` →
    `Err("Too many tries. Wait a moment, then try again.")`; anything else → `Err("Windows Hello did not answer. Try again.")`.
  - `unlock_pin(pin)` posts `/v1/lock/check`. `ok` clears locked, the same as Hello. A wait answers `Err("Wrong PIN
    too many times. Try again in <n> minutes.")` (or "<n> seconds" below a minute); a wrong one answers
    `Err("That is not the PIN.")`.
  - With the core not running: `Err("Mini Hub's background service is not running, so the PIN cannot be checked. Use
    Windows Hello, or quit Mini Hub and start it again.")`.
  - The `pin` string is dropped once the request is sent, and is never logged or formatted into an error.
- **Windows Hello calls:**
  - `windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()`, then
    `unsafe { interop.RequestVerificationForWindowAsync::<IAsyncOperation<UserConsentVerificationResult>>(hwnd, &HSTRING::from(message)) }?.join()`.
  - If the factory fails with `CO_E_NOTINITIALIZED`, call `CoInitializeEx(None, COINIT_MULTITHREADED)` once on that
    thread (feature `Win32_System_Com`) and try again.
  - `availability()` uses `UserConsentVerifier::CheckAvailabilityAsync()?.join()`.
  - Check every name against the 0.62.2 source in `~/.cargo/registry` before writing. If one differs, use the name that
    source has and say so in the report.
- **The tray** gains **Lock Mini Hub** between Stop Mini and Quit. It is enabled only while the lock is on
  (`MenuItem::set_enabled`, updated on `lock_reload` and at start) and does `lock_now`.
- **Stop while locked:** `lock_stop` runs exactly the tray's `stop_mini` path (`post_stop`). The global Stop and the
  tray Stop are unchanged and never look at the lock.
- **Development** (`cfg!(debug_assertions)` with the dashboard on `127.0.0.1:5173`) behaves the same in the shell. The
  browser launcher (`tools/dev.mjs`) has no shell, so there is no lock there (Task 2 says so on screen).
- **docs:**
  - `docs/03` > The dashboard itself: the lock as built. It is the shell's flag and no key reaches a locked window; the
    idle rules; Hello or a PIN; Hello always unlocks; no back door; Stop while locked; wrong-PIN waits; the PIN's hash
    in the database and not in the backup.
  - Add to Keys and secrets the row "Mini Hub's lock PIN | its scrypt hash inside the encrypted database | never
    shown, logged or exported".
  - `docs/05`: the four routes.
  - `docs/02`: the shell's `windows` and `windows-future` crates and why no plugin.

Edge cases:
- A second launch (single instance) only shows the window, which loads locked.
- The global key opens a locked window as the lock screen.
- An unlock while the window was closed opens nothing by itself.
- Hello's dialog left open while the ticker fires is fine: still locked.
- The core restarted by the owner (Quit, start) starts locked again.
- The PC's clock jumping forward an hour locks: accepted.
- `RequestVerificationForWindowAsync` needs a visible window. If none exists, `unlock_hello` first calls `show_main`.
- The existing `cargo test` cases (`the_key_opens_…`, `the_window_is_not_built_at_start`, the process tests) stay
  unchanged and green.

- [ ] Implement.
- [ ] Run `npm run check`, `npm test`, and `cargo test` in `shell/src-tauri` with the PATH. Expected: PASS
  (`api.test.ts`'s table of person-only routes still holds. If it lists every route, add the four lock routes to it,
  minimally, and say so).

### Task 2: Dashboard: the lock screen, Settings > Lock, Lock now

**Files:**
- Create: `ui/src/features/lock/LockScreen.tsx`, `ui/src/features/settings/LockSettings.tsx`, `ui/src/app/lock.ts`.
- Modify: `ui/src/main.tsx` (render the lock screen on `LOCKED`; start the activity watch), `ui/src/app/keys.ts` (pass
  `LOCKED` through unchanged), `ui/src/app/shell.ts` (Phase 4's; the lock commands),
  `ui/src/features/settings/Settings.tsx` (section `lock` between Start-up and About),
  `ui/src/features/frame/TopBar.tsx` (Lock now), `ui/src/features/frame/CommandBox.tsx` ("Lock now", "Settings >
  Lock"), `docs/07-dashboard-design.md` (Settings > Lock, the lock screen).

**Interfaces — Consumes:** Task 1's commands and `GET/PUT /v1/lock`. **Produces:** `lock.ts`:
`watchActivity(): () => void` (listeners on `pointerdown`, `pointermove`, `keydown` and `wheel`, at most one
`lock_activity` per 30 s), `lockInfo()`, `lockNow()`, `unlockHello()`, `unlockPin(pin)`, `helloCheck()`, `lockStop()`,
`lockReload()`, each a thin `invoke`.

Behaviour:

- **Start** (`main.tsx`): `keysFromShell()` throws `Error('LOCKED')` → render `<LockScreen />` alone, with no router,
  no query client and no request to the core. Any other error keeps today's notice. With keys, and `inShell()`, call
  `watchActivity()` once.
- **Lock screen** (a full window in the look, both themes, centred):
  - `PixelBot` small; heading "Mini Hub is locked" (`h1`); the line "Unlock to see your hub. Stop Mini works while
    locked."
  - With method `hello`, or Hello `available`: **Unlock with Windows Hello** (primary, focused at load) →
    `unlockHello()`, then `location.reload()`.
  - With method `pin`: a PIN field (`inputmode="numeric"`, `autocomplete="off"`, label "PIN", `type="password"`,
    `maxLength` 12) and **Unlock**. Enter submits. The field is cleared after each try.
  - The result line is `role="status"` with the error words from Task 1, and the wait counts down once a second.
  - **Stop Mini** (danger, always shown) → `lockStop()` → "Mini is stopped. Unlock to resume." or the error.
  - No data, counts, names or versions are fetched or shown.
  - Hello not set up and method `pin`: the Hello button is left out and a small line reads "Forgot the PIN? Set up
    Windows Hello in Windows Settings > Accounts > Sign-in options, then unlock with it."
- **Settings > Lock** (`id="lock"`, deep link `#/settings?section=lock`):
  - Outside the desktop app it shows "The lock works in the desktop app." and the controls are disabled.
  - **Lock Mini Hub when I am away** (`Switch`).
  - **After** `Choice` "1 minute / 5 minutes / 15 minutes / 30 minutes / 1 hour", with the hint "Counted from your last
    click or key in Mini Hub. A closed window or a sleeping PC counts too."
  - **Unlock with** `Choice` "Windows Hello / A PIN for Mini Hub". Under it, Hello's state:
    - "Windows Hello is ready on this PC."
    - "Windows Hello is not set up on this PC. Set it up in Windows Settings > Accounts > Sign-in options, or use a PIN."
      (this disables the Hello choice)
    - "Windows Hello is turned off on this PC by a policy."
  - Choosing Windows Hello, or turning the lock on with it, first runs `helloCheck()` with the line "Windows will ask
    you once, to check it works." Only a `true` result saves (`PUT /v1/lock`); otherwise "Windows Hello did not
    confirm it. Nothing changed."
  - Choosing a PIN shows "New PIN" and "The same PIN again" (4–12 digits, must match) and **Save the PIN**, with the
    hint "If you forget it, unlock with Windows Hello. Without Windows Hello on this PC, set it up first in Windows
    Settings."
  - After each save, `lockReload()`. Results go in `role="status"`: "The lock is on. Mini Hub locks after 5 minutes
    away." / "The lock is off."
  - **Lock now** (enabled while on).
- **Top bar:** while the lock is on (from `GET /v1/lock`), a `Lock` icon button "Lock now" (aria-label, tooltip, 32 px)
  before Stop → `lockNow()`.
- **Command box:** "Lock now" (only while on) and "Settings > Lock" join "Go to".
- **docs/07:** Settings > Lock as built; the lock screen and what it never shows.

Edge cases:
- The PIN fields never go into a query key, the URL, storage or a log.
- A failed `PUT` leaves the switch as it was.
- Turning the lock off needs no unlock: the owner is already in.
- While locked, the reload is the shell's, so a page whose JavaScript hangs still ends up locked: the next load
  refuses the key.
- Two windows cannot exist (single label `main`).

- [ ] Implement, in both themes, with the look's parts only.
- [ ] Run `npm run check`, `npm test` and `npm run build -w @minihub/ui`. Expected: PASS (`screens.test.tsx` mocks
  `GET /v1/settings` without lock. Settings > Lock shows its error or "desktop app" state without throwing; no test
  edit).
- [ ] By hand in the dev shell (`npm run tauri -w @minihub/shell -- dev` on its scratch `.minihub-home/shell-dev`):
  turn the lock on with a PIN, wait 1 minute, see the window reload locked, unlock with the PIN, try a wrong PIN five
  times and see the wait, press Stop Mini on the lock screen, then turn the lock off. Windows Hello is tried only by
  the owner (Owner steps).

### Task 3: Hub and dashboard: privacy mode finished, backup reminders, What changed, version 0.7.0

**Files:**
- Create: `core/src/api/routes/backup.ts`, `ui/src/features/about/WhatChanged.tsx`, `ui/src/features/about/changes.ts`,
  `ui/src/features/home/Banners.tsx`.
- Modify:
  - Core: `core/src/api/routes/data.ts` (Phase 4's export records its time), `core/src/api/routes/settings.ts`
    (`seenVersion`), `core/src/main.ts` (meta `createdAt`), `core/src/api/server.ts`, `core/src/hub.ts` (`VERSION`).
  - Versions: `core/package.json`, `ui/package.json`, `protocol/package.json`, `shell/package.json`,
    `shell/src-tauri/tauri.conf.json`, `shell/src-tauri/Cargo.toml` (and `Cargo.lock` by cargo).
  - Dashboard: `ui/src/app/router.tsx` (`/changes`), `ui/src/app/queries.ts` (types), `ui/src/design/tokens.css` (only
    the hand-written `.privacy-blur` rules, outside `tokens:start`), `ui/src/features/frame/TopBar.tsx` (the privacy
    button), `ui/src/features/frame/CommandBox.tsx`, `ui/src/features/settings/Settings.tsx` (Look line, About link),
    `ui/src/features/settings/Data.tsx` (Phase 4's; the reminder row), `ui/src/features/home/Home.tsx` (the banners).
  - Every tile and screen listed under privacy below.
  - Docs: `docs/07-dashboard-design.md`, `docs/04-data-and-sync.md`, `docs/05-hub-api.md`,
    `docs/03-security-and-permissions.md` (the privacy line).

**Interfaces — Produces:**

```ts
// core: GET /v1/backup (person) -> { remind: 'off' | 'week' | 'month', lastExportAt: number | null, due: boolean, snoozedUntil: number | null }
//       PATCH /v1/backup (person, audit 'backup') { remind?: 'off' | 'week' | 'month', snooze?: true } -> the same
// settings key 'backup' { remind, snoozedUntil? }, default { remind: 'month' }; meta 'lastExportAt', meta 'createdAt'
// uiSettingsSchema gains seenVersion: z.string().max(20).optional()
// ui/src/features/about/changes.ts
export type Change = { version: string; date: string; pc: string[]; phone: string[]; bot: string[] }
export const CHANGES: Change[]   // newest first
export const EARLIER: Array<{ title: string; lines: string[] }>
```

Behaviour:

- **Privacy mode, finished** (`docs/03`: previews of other people's words, blurred until pointed at or focused):
  - `privacy-blur` goes on the name and the text of every preview: the `EventList` tiles (calls, messages,
    notifications), `mail`, `voice-requests`, `mini-activity` (its titles can hold names), the Inbox list, the phone's
    page "Recent from this phone", the mail account's page lists, the command box's People and Items rows, and Home's
    "Waiting for you" tile lines.
  - It does **not** go on approval cards or the Approvals list (the ruling), the detail pane of an item the owner
    selected, the Mini screen's conversation, House, the note tile or counts.
  - Each blurred line sits in an element that takes focus (the row's own button or link, or `tabIndex={0}` with the
    row's name), so `:focus-within` reveals it by keyboard and touch too, not by hover alone.
  - Under `prefers-reduced-motion` there is no transition.
  - Screen readers still read the text; blur is only visual.
  - The top bar gains an `EyeOff`/`Eye` button "Privacy mode" with `aria-pressed`, 32 px, which saves
    `PATCH /v1/settings { privacy }`. The command box gains "Privacy mode on" / "Privacy mode off".
  - Settings > Look's hint becomes "Blurs names and message previews until you point at them or move to them with the
    keyboard. Questions waiting for your answer are never blurred."
- **Backup reminders:**
  - The export (Phase 4's `routes/data.ts`) sets `meta lastExportAt = now` after the file is renamed into place, and
    only then.
  - `main.ts` sets `meta createdAt` once: now, or, on an existing database, the oldest audit row's time.
  - `due` is true when all of these hold: `remind !== 'off'`; there is at least one event; `now >= snoozedUntil`; and
    either `lastExportAt` exists and `now − lastExportAt >= 7 or 30 days`, or there is no export yet and
    `now − createdAt >= 7 days`.
  - `snooze: true` sets `snoozedUntil = now + 3 days`.
  - **Home** shows, above the board, a `Row`-style line with an info tone, `role="status"`: "Your last backup was <n>
    days ago." or "You have not made a backup yet.", with **Back up now** (`#/settings?section=data`) and **Later**
    (snooze). It is refetched every 10 minutes. It never exports anything.
  - **Settings > Data** gains "Remind me to back up" (`Choice` "Never / Every week / Every month") and "Last backup:
    <date, Windows' format>" or "Last backup: never".
- **What changed** (`#/changes`, title "What changed"):
  - One `Window` per entry of `CHANGES` with "On your PC", "On your phone" and "Mini Bot" lists. Then "Earlier" with
    `EARLIER`. Headings are `h2`/`h3`. There is a link from Settings > About ("What changed") and from the command box.
  - Entry `0.7.0` (date of the build), exact lines:
    - pc:
      - "Lock: Mini Hub can lock itself when you are away, and opens again with Windows Hello or a PIN. Settings > Lock."
      - "Privacy mode now blurs every name and preview until you point at it, and has its own button at the top."
      - "Gadgets you describe: switch a small gadget by its web address or through your MQTT broker. House > Add a home device."
      - "Backup reminders, every month unless you choose otherwise. Settings > Data."
      - "This page."
      - "Keyboard and screen reader fixes on every screen."
    - phone:
      - "With TalkBack or Switch Access, Yes now asks for your fingerprint or screen lock."
      - "Screen reader fixes on every screen."
    - bot: "No changes." (Task 9 replaces this line if it changes the plugin.)
  - `EARLIER`:
    - "The hub": "The tray app, the dashboard, the Mini screen, Permissions, Activity and Stop."
    - "Your phone's record": "Calls, SMS, chats and notifications, kept on the phone and brought to the PC at home."
    - "Mini on the phone": "Mini on the phone by text and by voice, even with the PC off."
    - "Mini uses the hub": "Mini reads the hub for you, your mail, boards you arrange, the command box, and backups."
    - "Controlling the phone": "Mini can use the phone one step at a time with a red edge; sends always ask; Ring, Do
      Not Disturb and Show the screen from the PC; tiles, widgets and Glyph lights."
    - "Home and the Echo Dot": "Home devices in House, scenes, and \"Alexa, ask Mini\"."
  - **After an update:** when `GET /v1/settings` has `version !== seenVersion`, Home shows "Mini Hub was updated to
    <version>." with **See what changed** and **Dismiss**. Both set `seenVersion`. When `seenVersion` is missing (a
    first install), it is set silently.
- **Version 0.7.0** everywhere in the list under Files. The NSIS file becomes `Mini Hub_0.7.0_x64-setup.exe`.
- **docs:**
  - `docs/07`: Look > privacy mode as built and what it never blurs; Home's two banners; the What changed page; the
    top bar's privacy and lock buttons.
  - `docs/04` > What is kept: backup reminders, `lastExportAt`.
  - `docs/05`: `/v1/backup`, `seenVersion`.
  - `docs/03` > The dashboard itself: the privacy mode line as built.

Edge cases:
- An import (Phase 4) does not change `lastExportAt`.
- A failed export does not count.
- A hub with no events never reminds.
- `CHANGES` is plain text, rendered as text, never as HTML.
- Privacy mode at 150% text size still truncates rather than overflowing.
- The tests that mock `/v1/settings` with `version: '0.1.0'` and no `seenVersion` still pass: the banner appears only
  when `seenVersion` is set and differs.

- [ ] Implement.
- [ ] Run `npm run check`, `npm test`, `npm run build -w @minihub/ui` and `cargo test`. Expected: PASS.
- [ ] Look at Home (both banners), the tiles with privacy on, the Inbox, What changed and Settings > Data, in both
  themes at 900 and 1280 px, on a scratch hub (`node tools/dev.mjs --no-open`, with what it already holds; add nothing).

### Task 4: Hub and dashboard: gadgets you describe — the `web` adapter and its setup

**Files:**
- Create: `core/src/connectors/home/adapters/web.ts`, `core/src/connectors/home/gadgets.ts` (definitions, the
  `gadget-via` form, the web forms and the shared `try` step; Task 5 adds the MQTT forms), `core/src/connectors/home/pointer.ts`.
- Modify:
  - Protocol: `protocol/src/home.ts` (`ADAPTERS` gains `'web'` and `'mqtt'`; the gadget schemas; `HomeState.assumed?`).
  - Core: `core/src/connectors/home/adapter.ts` (optional `attach` and `close`; two reasons),
    `core/src/connectors/home/lan.ts` (`lanConnect`), `core/src/connectors/home/setup.ts` (`how: gadget`; editing),
    `core/src/connectors/home/index.ts` (the adapter list, `attach`, `close` on stop and remove),
    `core/src/api/routes/home.ts` (`endpoint.gadget` summary), `core/src/log.ts` (`REDACT`).
  - Dashboard: `ui/src/features/devices/HomeDevicePage.tsx` ("How Mini Hub reaches it", "Change how it is reached"),
    `ui/src/features/house/DeviceTile.tsx` ("Last sent"), `ui/src/app/home.ts` (types).
  - Docs: `docs/06-connectors.md` (the generic line becomes a section), `docs/05-hub-api.md`, `docs/03-security-and-permissions.md`
    (Keys and secrets: gadget passwords).

**Interfaces — Produces:**

```ts
// protocol/src/home.ts
export const GADGET_ID = /^g-[0-9a-f]{8}$/
export const TOPIC = /^(?!\$)[^#+\u0000]{1,200}$/
export const POINTER = /^(\/[^/]{1,60}){1,8}$/            // RFC 6901, at most 8 steps
export const webRequest = z.object({ method: z.enum(['GET', 'POST', 'PUT']), path: z.string().regex(/^\/[\x21-\x7e]{0,299}$/),
  body: z.string().max(2000).optional(), type: z.enum(['json', 'text', 'form']).optional() }).strict()
export const stateRule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('json'), pointer: z.string().regex(POINTER), on: z.string().min(1).max(60) }),
  z.object({ kind: z.literal('contains'), text: z.string().min(1).max(60) }),
  z.object({ kind: z.literal('equals'), on: z.string().min(1).max(60) }) ])
export const readingRule = z.object({ name: z.string().min(1).max(40), pointer: z.string().regex(POINTER).optional(),
  topic: z.string().regex(TOPIC).optional(), unit: z.string().max(10) }).strict()
const gadgetBase = { id: z.string().regex(GADGET_ID), name: z.string().min(1).max(60), kind: z.enum(HOME_KINDS) }
export const webGadget = z.object({ ...gadgetBase, via: z.literal('web'), turnOn: webRequest, turnOff: webRequest,
  state: z.object({ request: webRequest, rule: stateRule }).optional(),
  brightness: z.object({ request: webRequest, scale: z.union([z.literal(100), z.literal(255)]) }).optional(),
  readings: z.array(readingRule).max(4) }).strict()                // readings: pointer into the state answer
export const mqttGadget = z.object({ ...gadgetBase, via: z.literal('mqtt'), command: z.string().regex(TOPIC),
  payloadOn: z.string().min(1).max(200), payloadOff: z.string().min(1).max(200),
  state: z.object({ topic: z.string().regex(TOPIC), rule: stateRule }).optional(),
  brightness: z.object({ topic: z.string().regex(TOPIC), payload: z.string().max(200), scale: z.union([z.literal(100), z.literal(255)]) }).optional(),
  readings: z.array(readingRule).max(4) }).strict()                // readings: topic (+ optional pointer)
export const gadgetSchema = z.discriminatedUnion('via', [webGadget, mqttGadget])
export type Gadget = z.infer<typeof gadgetSchema>
// HomeState gains  assumed?: boolean   (no state is read; `on` is what Mini Hub last sent)

// core/src/connectors/home/adapter.ts — Adapter gains (optional, used by web and mqtt):
//   attach?(tell: (endpointId: string) => void): void      // ask the poller for a read round now
//   close?(endpointId?: string): Promise<void>              // all, or one endpoint, on stop and remove
// REASONS gains:
//   'no-state': "It answered, but Mini Hub could not find its state where you said."
//   'bad-template': "The brightness request must contain {brightness} once."
// core/src/connectors/home/lan.ts
export function lanConnect(address: string, port: number, signal?: AbortSignal): Promise<net.Socket>   // isLan or HomeFailure('not-local'); 3 s connect timeout
```

Behaviour:

- **Records.**
  - A gadget endpoint is `Endpoint { id, adapter: 'web', address, port, makerId: 'web-<8 random hex>', extra: { auth:
    'none' | 'basic', user?: string (max 60), gadgets: { [gadgetId]: Gadget } } }`. The `makerId` is random, so the
    address can change and the device ids, shares and scenes stay.
  - A thing is one gadget (`key` = gadget id, `kind` and `name` from it, `traits` = `onoff`, plus `brightness` when
    defined, plus `reading` when it has readings).
  - At most 50 gadgets per endpoint, inside Phase 6's 100 home devices.
- **The web adapter** (`web.ts`, title "Web address"):
  - `connect` checks reachability with one `lanFetch` of the state request if defined, else `GET /`. Any HTTP status
    counts as reachable; no answer → `unreachable`.
  - With `auth: 'basic'`, every request carries `Authorization: Basic base64(user:password)`, the password from the
    secret. A `401` → `wrong-password`.
  - `read`:
    - With `state`, it sends the request and applies the rule: `json` → `String(valueAt(pointer)).toLowerCase() ===
      on.toLowerCase()`, a missing pointer → reason `no-state`; `contains` → the answer's text includes `text` (case
      ignored); `equals` → the trimmed answer equals `on` (case ignored). Readings: a number at each pointer, else
      left out.
    - Without `state`, no request is made; the state stays as last set, with `assumed: true` and `reachable: true`.
  - `set`:
    - `on: true` / `false` sends `turnOn` / `turnOff` exactly as written.
    - `brightness` sends the brightness request with `{brightness}` replaced by `Math.round(b × scale / 100)` (an
      integer, 1–100 or 1–255).
    - `Content-Type` follows `type` (`application/json`, `text/plain; charset=utf-8`,
      `application/x-www-form-urlencoded`).
    - A status that is not 2xx → `failed`. The answer's text is never logged, stored or shown.
- **The guarantee in code.** No value from an agent's or a person's action reaches a request except the validated
  integer brightness (and the choice of on or off). Paths, bodies and topics come only from the stored definition.
  `{brightness}` must appear exactly once, in the path or the body, else the form refuses with `bad-template`.
- **Setup** (Phase 6's `setup.ts`; Phase 4's form, show and done steps; exact words):
  - The first form's `how` gains `gadget`, "A gadget I describe myself (a web address or MQTT)".
  - Form `gadget-via`:
    - Title "A gadget you describe".
    - Text "For a small gadget Mini Hub does not know by name. You tell Mini Hub exactly how to switch it, and Mini can
      only use what you write here: on, off and, if you add it, a brightness. It stays on your home network."
    - Field `via`: `web` "It has a web address on my home network" / `mqtt` "It is on my MQTT broker" (Task 5).
  - Web, form `web-where`:
    - `name` (text, 1–60).
    - `kind` (choice of `HOME_KINDS`, with words "Light, Plug, Switch, Fan, Air conditioner, TV, Speaker, Sensor, Lock,
      Camera, Alarm, Garage, Other"), with the hint "If it opens a door, a garage or a lock, choose that kind: then it
      always asks first."
    - `address` (text, the Phase 6 hint), `port` (number, default 80).
    - `auth` (choice "No sign-in / A user name and password"), `user` (text), `password` (password).
    - `isLan` fails → the same form with the `not-local` error.
  - Form `web-switch`, text "The requests that turn it on and off, as its maker's page or manual gives them. For
    example GET /relay/0?turn=on.": `onMethod`, `onPath`, `onBody`, `offMethod`, `offPath`, `offBody`, and `type`
    (choice JSON / Plain text / Form).
  - Form `web-state`, title "Reading its state (you can skip this)": `has` (choice "Mini Hub reads its state" / "Skip:
    show what was last sent"), `stateMethod`, `statePath`, `rule` (choice "A value in its JSON answer" / "Its answer
    contains a word" / "Its answer is exactly a word"), `pointer` (hint "Like /ison or /POWER"), `onValue` (hint "The
    value that means on, like true or ON"), and readings 1 and 2 (`r1Name`, `r1Pointer`, `r1Unit`, `r2…`).
  - Form `web-brightness`, title "Brightness (you can skip this)": `has`, `bMethod`, `bPath`, `bBody` (hint "Write
    {brightness} where the number goes."), `scale` (choice "1 to 100" / "1 to 255").
  - Form `try`:
    - Title "Try it". Text: the last try's result, or "Nothing has been sent yet."
    - Field `try`: `on` "Turn it on now" / `off` "Turn it off now" / `read` "Read its state now" / `save` "Save it".
    - A try runs `set` or `read` once, and the same form comes back with the result: "It answered. It says: on.", "It
      answered. Its state is not read.", or the reason line.
    - Nothing is switched unless the owner picks `on` or `off`.
  - `save` → the endpoint and the secret are saved, one device is upserted **not shared**, and the step answers
    `{ kind: 'done', devices }`.
- **Editing** (`step: null` with `input: { endpoint, gadget }`): the same forms with `value`s filled from the
  definition. The password is never filled; its hint is "Leave empty to keep the one set." Saving replaces the
  definition, and the device id stays.
  `input: { endpoint }` alone, on a web endpoint, starts at `web-switch` for a new gadget on the same address.
- **`GET /v1/home`**: for `web` and `mqtt` endpoints, `endpoint.gadget = { via, lines: string[] }` (for example "Turn
  on: POST /relay/0?turn=on", "State: GET /status, on when /ison is true"), built from the definition. It never
  includes a user name, a password or an answer.
- **Dashboard:**
  - `HomeDevicePage` for a gadget gains "How Mini Hub reaches it" (the `lines`, `font-mono`) and **Change how it is
    reached** (`SetupWizard` with `connector: 'home'` and `input`).
  - `DeviceTile` shows a small "Last sent" `Tag` when `state.assumed`.
- **docs:**
  - `docs/06`: replace the "A generic connector is planned …" paragraph with a pointer, and add "Gadgets you describe"
    under `home`: what the owner writes, what Mini can do (on, off, brightness), local only, the try step, no secrets
    shown back, and the limits.
  - `docs/05`: `endpoint.gadget` in `GET /v1/home`; the setup input `{ endpoint, gadget }`.
  - `docs/03` > Keys and secrets: gadget and broker passwords in the encrypted database.

Edge cases:
- A path with a space is refused by the regex, with the hint "Write a space as %20".
- An answer over 1 MiB → `too-large`.
- A gadget marked Lock, Camera, Alarm or Garage is guarded (Phase 6: only `set_guarded`, never in a scene, never by
  voice).
- An endpoint whose last gadget is removed drops its secret.
- The poller treats `web` like any adapter (10 s / 60 s). A gadget without `state` costs no request at all.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test`. Expected: PASS (the home connector starts with no endpoints).
- [ ] Open House > Add a home device > A gadget I describe myself on a scratch hub, and walk the forms to `try`
  without saving and without an address of a real device (nothing is added).

### Task 5: Hub: gadgets on the owner's MQTT broker — the `mqtt` adapter

**Files:**
- Create: `core/src/connectors/home/adapters/mqtt.ts`, `core/src/connectors/home/mqtt-client.ts`.
- Modify: `core/package.json` and `package-lock.json` (`mqtt-packet` `9.0.2`, exact), `core/src/connectors/home/gadgets.ts`
  (the MQTT forms), `core/src/connectors/home/index.ts` (register), `docs/06-connectors.md` (MQTT), `docs/02-tech-stack.md`
  (`mqtt-packet`, and why not `mqtt`).

**Interfaces — Consumes:** Task 4's `lanConnect`, the gadget schemas, `attach` and `close`; Phase 6's `Adapter`.
**Produces:**

```ts
// mqtt-client.ts
export class MqttClient {
  constructor(o: { address: string; port: number; user?: string; password?: string; log: Logger; onMessage: (topic: string, payload: Buffer) => void; onState: (up: boolean) => void })
  connect(signal: AbortSignal): Promise<'ok' | 'wrong-password' | 'refused' | 'unreachable'>
  subscribe(topics: string[]): void          // QoS 0; never + or #
  publish(topic: string, payload: string): void   // QoS 0, retain false
  close(): Promise<void>
  get up(): boolean }
```

Behaviour:

- **Before any code:** bundle `mqtt-packet@9.0.2` with the same esbuild options as `tools/bundle-core.mjs` in a scratch
  folder outside the repository and run it. It needs 0 warnings and must run (`core/test/bundle.test.ts` asserts an
  empty stderr). If it warns, do not mark anything external: write the seven packets by hand in `mqtt-client.ts`
  (CONNECT, CONNACK, SUBSCRIBE, SUBACK, PUBLISH at QoS 0, PINGREQ/PINGRESP, DISCONNECT; MQTT 3.1.1, the
  remaining-length varint) and say so in the report.
- **The client:**
  - It connects through `lanConnect` only. It sends CONNECT with protocol level 4, client id `minihub-<8 random hex>`,
    clean session, keepalive 30 s, and the user name and password when set.
  - It waits 5 s for CONNACK. Code 0 → `ok`; 4 or 5 → `wrong-password`; other codes → `refused`; no answer →
    `unreachable`.
  - PINGREQ every 30 s. No PINGRESP within 45 s, or the socket closing → `onState(false)`, then reconnect after 5 s,
    15 s, 60 s, then every 5 minutes. After `wrong-password` it does not retry until the owner enters a password again.
  - It re-subscribes after every reconnect.
  - Incoming PUBLISH payloads over 4,096 bytes are dropped.
  - The parser is fed at most 64 KiB buffered. Anything more closes the socket.
- **The adapter** (`mqtt.ts`, title "MQTT broker"):
  - One `MqttClient` per broker endpoint (`makerId 'mqtt-<8 random hex>'`, `extra: { user?, gadgets }`), made at the
    first `read` and kept until `close`.
  - It subscribes to every gadget's state topic and reading topics. The last payload per topic is kept in memory, and
    a broker's retained messages fill the cache at once.
  - `onMessage` for a known topic calls `tell(endpointId)` (from `attach`), so the poller reads now.
  - `read` answers from the cache without any traffic. `reachable` = `client.up`. The state rule applies to the
    payload as text (`json` → pointer into `JSON.parse(payload)`, a parse failure → `no-state`).
  - `set`: `on` → publish `payloadOn` to `command`; `off` → `payloadOff`; `brightness` → publish `brightness.payload`
    with `{brightness}` replaced by the scaled integer, to `brightness.topic`.
  - With no `state`, the state is `assumed` as in Task 4.
  - `close(endpointId)` sends DISCONNECT and ends the socket. `close()` closes all of them (the home connector's `stop`).
- **Setup forms** (Task 4's `via: mqtt`):
  - Form `mqtt-broker`:
    - Title "Your MQTT broker".
    - Text "The broker on your home network, for example Mosquitto, or the one in Zigbee2MQTT or Home Assistant. Mini
      Hub subscribes only to the topics you name."
    - Fields: `address`, `port` (default 1883), `user`, `password`.
    - `connect` runs at once: `wrong-password` → the same form with that reason; `unreachable` → its reason. A broker
      already added (same address and port) is reused, and its secret is replaced only if a password is given.
  - Form `mqtt-gadget`:
    - `name`, `kind` (as in Task 4).
    - `command` (hint "The topic that switches it, like home/example-lamp/set"), `payloadOn` (hint "Like ON or
      {\"state\":\"ON\"}"), `payloadOff`.
    - `stateTopic` (optional), `rule` (as in Task 4) with `pointer` and `onValue`.
    - `brightnessTopic`, `brightnessPayload` (hint "Write {brightness} where the number goes."), `scale`.
    - Two readings (`name`, `topic`, `pointer`, `unit`).
    - A topic with `+`, `#`, a starting `$`, or over 200 characters → the form error "Use one exact topic, without +
      or #."
  - Then Task 4's `try` form. `read` waits up to 3 s for a state message.
- **No log line** holds a topic, a payload, a user name or a client id. Counts, the address and `up`/`down` are fine.
- **docs:**
  - `docs/06`: the MQTT part of "Gadgets you describe": the broker, exact topics only, QoS 0, plain MQTT on the home
    network and why, retained state, Zigbee2MQTT and ESPHome as examples.
  - `docs/02`: `mqtt-packet` 9.0.2 and the reasons.

Edge cases:
- A broker that drops the connection every minute settles at the 5-minute retry, with its devices `reachable: false`
  and the `unreachable` line.
- Two gadgets on one state topic both update.
- Removing the last gadget of a broker closes its client and deletes its secret.
- The Stop button does not stop the client (the record keeps working, as in Phase 6), but every agent action is
  already refused by the core.
- Without the dashboard open, the client stays connected (it costs one idle socket) and the poller reads every 60 s.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test`. Expected: PASS, including `core/test/bundle.test.ts` with an empty stderr.

### Task 6: Phone: Yes for TalkBack through the phone's own check, and a screen-reader pass on every screen

**Files:**
- Create: `consent/ConfirmYesActivity.kt`.
- Modify:
  - `overlay/ApprovalCard.kt` (`TapGuard.accepts()` returns a verdict; Yes routes a no-touch click), `consent/Approvals.kt`
    (`isOpen(id)`, the question's text by id).
  - `AndroidManifest.xml` (`USE_BIOMETRIC`; the activity).
  - Every screen and view for the pass: `ui/Screens.kt`, `ui/AppsScreen.kt`, `ui/SettingsScreen.kt`, `ui/NeverScreen.kt`,
    `ui/look/Parts.kt` (`LookSwitch`, `ChoiceView`, `lookButton`, `WindowCard`), `ui/Kit.kt`, `overlay/Overlay.kt`
    (the bot and its panel), `overlay/ControlEdge.kt` (the banner), `voice/TalkActivity.kt`, `voice/AskActivity.kt`,
    `mirror/MirrorActivity.kt`, and the `nothing/` widgets and tiles.
  - `android/app/build.gradle.kts` (`versionCode = 7`, `versionName = "0.7.0"`).
  - Docs: `docs/08-android-app.md` (Approvals on the phone; The app's own screens: accessibility),
    `docs/03-security-and-permissions.md` (Approvals: the second way to say Yes).
  - Paths are under `android/app/src/main/java/app/minihub/phone/`.

**Interfaces — Produces:**

```kotlin
enum class Verdict { Touch, NoTouch, TooSoon, Blocked }   // Blocked: within 1,000 ms of a gesture Mini dispatched (Phase 5)
fun TapGuard.accepts(): Verdict
object ConfirmYes { fun start(context: Context, questionId: Int) }
class ConfirmYesActivity : Activity()   // not exported, excludeFromRecents, its own taskAffinity, noHistory, never over the lock screen
```

Behaviour:

- **Yes:**
  - `Touch` → answer Yes, as today. `TooSoon` and `Blocked` → nothing, as today. `NoTouch` (TalkBack's double-tap,
    Switch Access, `ACTION_CLICK`) → `ConfirmYes.start(context, q.id)`.
  - No is unchanged: any click after the 600 ms arm.
- **`ConfirmYesActivity`:**
  - It reads the id. If `Approvals.isOpen(id)` is false, it finishes at once.
  - If `KeyguardManager.isDeviceSecure` is false, it shows one dialog in the look, "To answer Yes without touching the
    screen, set a screen lock on this phone first.", with **OK**, then finishes.
  - Otherwise it builds the framework `BiometricPrompt` with `setAllowedAuthenticators(BIOMETRIC_STRONG or
    DEVICE_CREDENTIAL)`, title "Allow this?", subtitle "<who> is asking", and description = the question's text, cut
    at 400 characters with "…" (the full text stays on the card behind it).
  - `onAuthenticationSucceeded` → if `Approvals.isOpen(id)` is **still** true for that same id → `Approvals.answer(id,
    true, this)`; then it finishes. An error, a cancel or a failure → nothing (the question stays, and No still
    works), and it finishes.
  - The phone being stopped, the question expiring, or the question being answered elsewhere while the prompt is open
    → the success does nothing.
  - One prompt at a time: a second `start` while one is open is ignored.
- **The description for screen readers:** Yes's `contentDescription` is "Yes. With TalkBack, double-tap, then confirm
  with your fingerprint or screen lock." No's is "No". The notification is unchanged: No and Open, never Yes.
- **Why it is safe** (write it in `docs/08` > Approvals on the phone):
  - The prompt is Android's own window (system UI, a closed place for Mini's service in Phase 5).
  - It needs the owner's fingerprint or screen-lock secret.
  - Yes is still data-sensitive, so Mini's own service (`isAccessibilityTool="false"`) cannot see it.
  - A gesture Mini dispatched is `Blocked`.
  - `docs/03` > Approvals gains: "On the phone, Yes is the owner's real finger on Yes, or, for screen reader users, the
    phone's own fingerprint or screen-lock check started from Yes."
- **The screen-reader pass** (every screen and view in Files; fix what fails, write what does not in the ledger
  `.superpowers/sdd/2026-11-23-finishing/a11y-phone.md`). The checklist:
  1. Every control has visible text or a `contentDescription`. Icon-only buttons are named. Decorative images and the
     dots pattern are `importantForAccessibility = NO`.
  2. `LookSwitch` reads as a switch with its label and state (`AccessibilityDelegate`: class `Switch`, `isCheckable`,
     `isChecked`, `stateDescription` "On"/"Off"). `ChoiceView` reads as a group of radio buttons ("Off, 1 of 3,
     selected").
  3. Card titles and screen titles are headings (`isAccessibilityHeading = true`).
  4. Changes that matter are announced once: the brain's state on the Brain screen, "Stopped from your PC", a
     question arriving (`announceForAccessibility` once per question), a control task starting and ending (the
     banner). The countdown does **not** tick in a live region; its text is read when focused.
  5. Touch targets are at least 48 × 48 dp (`minHeight` and `minWidth`, or a `TouchDelegate`).
  6. Text is in `sp`, and at the largest font size and 200% display size nothing is cut: lines wrap, buttons wrap under
     their line, and lists scroll.
  7. The focus order follows the reading order. The approval card reads: who, the question, the countdown, Yes, No.
  8. The floating bot is named "Mini", with custom actions "Talk", "Open the panel" and "Hide"
     (`AccessibilityAction`), so it works without dragging.
  9. The red edge's banner is reachable and its **Stop** is named "Stop Mini's control".
  10. Widgets (`RemoteViews`) set `setContentDescription` on each clickable part. Quick-settings tiles have labels and
     state descriptions.
- **Version 0.7.0** (`versionCode = 7`).

Edge cases:
- Two questions open: the prompt answers only the one whose Yes was used.
- With TalkBack on, the 600 ms arm still applies to its double-tap.
- A phone with only a weak (class 2) face unlock: `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` falls back to the PIN,
  pattern or password, which is fine.
- The prompt while the phone is in a call or on the lock screen: the activity is not shown over the lock screen, and
  the question waits on Home as today.
- The existing unit tests (`CommandsTest`, `FramesTest`, the record tests) stay unchanged.

- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease`. Expected: PASS and a signed release APK 0.7.0.
- [ ] Look at each screen on an emulator (not the owner's phone) with the largest font size and display size, which the
  controller may set on the emulator only. TalkBack itself is turned on and used only by the owner (Owner steps).

### Task 7: Dashboard: keyboard and screen readers on every screen

**Files:** modify what the review finds, across `ui/src/features/**`, `ui/src/widgets/**` and
`ui/src/components/look/**` (never the generated token files); `docs/07-dashboard-design.md` (Accessibility: the keys,
and what was decided). The ledger is `.superpowers/sdd/2026-11-23-finishing/a11y-dashboard.md` (git-ignored).

**Interfaces:** none new. Existing component props may gain `aria-*` pass-through only.

Behaviour:

- **The screens:**
  - The frame: top bar, pill bar, Stop and Resume, the bell, the command box, and the approval cards with the
    Approvals list.
  - Home: a board, the tabs, edit mode with the gallery and tile settings, and every tile in the gallery.
  - Inbox (list, filters, detail, Reply through the phone, the mail approval). Mini screen. Devices, Add device, the
    SetupWizard (phone, mail, home, gadget, Echo Dot).
  - Each device page: phone (actions, the mirror view), mail account, home device, Echo Dot. House and the scenes
    editor with Guarded.
  - Activity. Permissions (switches, three-way choices, safe by voice, Disconnect everything). Settings (Look, Boards,
    Data, Network, Start-up, Lock, About). The lock screen. What changed.
- **The checklist for each screen** (fix what fails; write what does not in the ledger with the reason):
  1. Every action works with Tab, Shift+Tab, Enter, Space, the arrows (in tabs, lists, choices, menus and the grid in
     edit mode) and `Esc`. The tab order follows the reading order, with no traps except in a modal.
  2. Focus is visible on every control in both themes (`:focus-visible`, at least a 2 px outline that contrasts with
     its background).
  3. A modal or sheet (`role="dialog"`, `aria-modal`, labelled by its title) moves focus in, keeps it in, closes with
     `Esc`, and gives focus back to what opened it.
  4. Every control has a name: icon-only buttons have `aria-label`; inputs have a `<label>`; switches are
     `role="switch"` with `aria-checked`; the three-way choices are a `radiogroup`; tabs are `tablist`/`tab`/`tabpanel`
     with `aria-selected`.
  5. Landmarks: one `main`, the navigation as `nav`, each screen with one `h1` and ordered headings.
  6. These are announced (`aria-live="polite"`, or `assertive` for Stop): an approval arriving ("Mini Hub is asking:
     <summary>"), Stop and Resume, save results, search counts, a device going offline, and the lock's results.
  7. Nothing depends on hover alone (tooltips also on focus; privacy blur reveals on focus) or on colour alone (state
     has a word or an icon too).
  8. Targets are at least 32 × 32 px (24 in compact rows, with a larger hit area).
  9. At 150% zoom (Ctrl and + in the dev browser, as a stand-in for Windows' text size) at 900 px wide, nothing is
     clipped or overlapped, and the page scrolls instead.
  10. `prefers-reduced-motion` stops the skeleton shimmer, `Munch` and transitions.
- **How:**
  - Use a scratch hub (`node tools/dev.mjs --no-open`, with what it already holds; add nothing), in the browser.
  - Walk each screen by keyboard only.
  - Read its accessibility tree with the Playwright browser tools' snapshot (a look, not a saved test).
  - Edit mode and the gallery are checked with the keys that `docs/07` names (arrows move, Shift+arrows resize).
  - Narrator is used only by the owner (Owner steps).
- **docs/07 > Accessibility:** a short "Keys" table (Ctrl+K, Esc, the arrows in edit mode, Enter and Space), privacy
  mode's focus reveal, the lock screen, and anything else decided here.

Edge cases:
- A fix that changes what an existing test queries (`screens.test.tsx`, `frame.test.tsx`, `home.test.tsx`,
  `devices.test.tsx`) updates that test's query minimally and is listed in the report.
- A finding that needs a design change the owner should judge goes into the ledger and the report, not into code.

- [ ] Review and fix.
- [ ] Run `npm run check`, `npm test` and `npm run build -w @minihub/ui`. Expected: PASS.

### Task 8: Docs: the clean-install guide and the owner's master checklist

**Files:** create `docs/12-setting-up-from-scratch.md`; modify `README.md` (the "Read in this order" table, and the
Status line), `docs/10-build-plan.md` (Phase 7 names the guide), `docs/08-android-app.md` (Building and installing the
APK points to the guide).

**Sources the writer reads first:**
- The Owner steps of `docs/superpowers/plans/2026-11-23-phone-record.md`, `2026-11-23-mini-on-phone.md`,
  `2026-11-23-hub-for-mini.md`, `2026-11-23-phone-control.md` and `2026-11-23-home-and-alexa.md`, and this plan's.
- `docs/08` > Mini's brain on the phone (the fourteen setup steps) and What it asks Android for. `docs/03` > The
  network (the firewall). `docs/11` D5 and D12.
- The plugin's `README.md` (install and update).
- The real screens' words: the phone app's `ui/` and the dashboard's `features/`.

Behaviour (written for the owner, plain words, one action per numbered step, each step saying what you should see when
it worked):

- **Before you start:**
  - What to have: the installer `Mini Hub_0.7.0_x64-setup.exe` and the phone app `app-release.apk` (0.7.0) on a USB
    stick or a shared folder; a backup file and its passphrase if restoring; the mail account's app password; and,
    only for the Echo Dot, an Amazon developer account and Tailscale or your own tunnel.
  - What the trial needs: a separate Windows account and an emulator or a spare phone, never the daily phone (it would
    be unpaired from your hub).
- **Part 1, the PC, from a fresh Windows account:**
  1. Windows Hello (Settings > Accounts > Sign-in options), for the lock.
  2. Git for Windows.
  3. Claude Code: the install command from Anthropic's Claude Code setup page, as it reads on the day of writing,
     with that date. Then sign in with `claude` and answer its first questions yourself.
  4. The Mini Bot: `claude plugin install mini-bot --marketplace <your GitHub name>/Claude-Mini-bot`; say yes to
     adding the marketplace; start the bot as its README says; trust the folder when Claude Code asks; the bot's own
     permissions (screen, microphone, computer control, full access) are your choice.
  5. Mini Hub: run the installer. Windows SmartScreen may say the app is unrecognised (it is not signed): More info >
     Run anyway. The first start makes its key in Windows Credential Manager and its data folder `%APPDATA%\MiniHub`.
     Set Start with Windows and learn Ctrl+Alt+H.
  6. Restore a backup (optional): Settings > Data > Import. Every switch is off afterwards.
  7. The lock: Settings > Lock.
  8. Mail: Devices > Add device > Mail account. For Gmail, an app password (2-Step Verification on). Then the switches.
  9. Home devices and gadgets: House > Add a home device.
  10. The Echo Dot (optional): the tunnel choice (D3), the skill's steps as the Echo Dot's page shows them, and Turn on.
  11. Backups: Settings > Data > Export, and keep the passphrase.
- **Part 2, the phone, from a factory-fresh phone:**
  1. Android set-up with a screen lock (needed for Yes with TalkBack, and wise anyway), on the same Wi-Fi as the PC.
  2. Termux from F-Droid (D5), opened once. Then `pkg install nodejs-lts tmux git`, Claude Code installed in Termux
     and signed in.
  3. Install Mini. Either: Developer options > USB debugging on, `adb install app-release.apk` from the PC, then USB
     debugging off. Or: open the APK on the phone, then Mini's app info > ⋮ > Allow restricted settings when Android
     holds back a permission.
  4. The Brain screen's steps, in order:
     - Run commands in Termux.
     - Copy the line into Termux.
     - Termux's and Mini's battery set to Unrestricted.
     - Display over other apps.
     - Notifications, and the microphone.
     - Update Mini Bot, then Start Mini.
     - Claude Code's folder trust for `~/.mini/work`, answered yourself.
     - Termux's log level left at Normal.
  5. Pair with the PC: the dashboard's Devices > Add device > Phone and the phone's Hub screen. Windows asks about the
     firewall the first time: private networks only.
  6. Perms:
     - Collect switches.
     - Allow call log, SMS, and contacts if wanted.
     - Open notification access, then Choose apps.
     - "Mini on this phone" and "From my PC" choices.
  7. Mini's hands:
     - The accessibility service in Android's settings (and restricted settings if asked).
     - The never list.
     - Do Not Disturb access, Modify system settings, SMS and calls if wanted.
  8. Entries:
     - The quick-settings tile and the widgets.
     - Mini as the digital assistant, then Voice input set back.
     - The Glyph kit (only if the APK was built with it).
  9. Accessibility for yourself: TalkBack, if you use it, and how Yes works with it.
- **Part 3, check it works:** a short list (a call reaches the dashboard; ask Mini on the phone with the PC off; Stop
  from the PC; the lock; a backup made).
- **Part 4, every step only you can do:** the master checklist. One `- [ ]` line per owner step from Phases 2b–7,
  grouped PC / phone / optional (mail, home, Echo Dot, Glyph). Each names the screen it is on, and none is left out.
  Check it against each plan's Owner steps, item by item.
- **Part 5, if something goes wrong:** a table:
  - SmartScreen.
  - "The hub's key is missing" (restore a backup).
  - The phone cannot reach the PC (same Wi-Fi, a private network in Windows, the firewall rule).
  - Termux killed overnight (battery Unrestricted).
  - "Allow restricted settings".
  - A banking app refuses to run with the service on (Turn the service off while paying).
  - A forgotten lock PIN (Windows Hello).
  - The emulator has no Glyph (expected).
- **Appendix, building it yourself:** Node 24, the Rust toolchain and the Visual Studio C++ build tools, then
  `npm install`, `npm run build:shell` (with the cargo PATH); a JDK and the Android SDK, then `./gradlew
  :app:assembleRelease` with the signing keystore kept outside the repository (D12). The Glyph AAR is optional
  (Phase 5).
- **No personal data:** made-up values only, `<your GitHub name>`, no real network, device or account names.
- **README:** add docs/12 (and docs/13, written in Task 9) to the table. The Status line says every phase is built,
  and points to docs/12.

Edge cases: a step that differs on an emulator (no SIM: calls and SMS are tried with the emulator's own extended
controls, by the owner if they want; no Glyph; no fingerprint unless set in the emulator) is marked "On an emulator:".

- [ ] Write the guide and the README rows.
- [ ] Read it once against the real screens: every button name in the guide exists, word for word, in the code (search
  for each quoted label in `ui/` and `android/`).

### Task 9: The security read-through against `docs/03`: a findings list, and the fixes

Its own task, run after Tasks 1–8, by an engineer who did not write them.

**Files:** create `docs/13-security-review.md`. Modify only what the fixes need, in either repository. If the plugin
changes: `.claude-plugin/plugin.json` `0.12.0`, its README's version lines, and Task 3's What changed "Mini Bot" line.
Change `docs/03` and `docs/11` (Risks) where a fix or an accepted risk changes what they say.

Behaviour:

- **Read the whole system against each section of `docs/03`, and against each rule in `AGENTS.md` and
  `.superpowers/build-rules.md`.** For each one, record a verdict (holds / finding) and the evidence (file and line,
  or the command run). At least these:
  1. **Who is calling:**
     - Every route in `core/src/api/routes/*.ts` and every connector route has an explicit `access`.
     - Every person-only route is refused to the agent token. `api.test.ts`'s table covers every route that exists
       now; add missing ones to that existing table only.
     - The person key is never on disk, in an environment variable, a command line, a log or a URL (except
       development's fragment, cleaned at once).
     - `hub_keys` refuses while locked.
  2. **Two switches and the three lists:**
     - Collect off means nothing is fetched, stored or sent (phone collectors, mail IDLE, `home_state`, gadgets).
     - "Mini may use" off means refused with the switch named.
     - The phone's lists decide on the phone. "Mini may use this device" holds for gadgets.
  3. **Risk:**
     - Every action in every connector has a fixed risk and scope. `Registry.add` refuses one without.
     - Guarded kinds go only through `set_guarded`.
     - Unknown counts as important.
  4. **Approvals:**
     - The hub's approvals are answered only with the person key.
     - The phone's are answered by a real touch or `ConfirmYesActivity`, and nothing else.
     - No notification Yes.
     - Expiry means No. A second request needs a second approval.
     - "Always allow" only for `act`.
  5. **The audit log:**
     - One row per agent read, action, approval, grant change, pairing, stop, unlock and wrong PIN.
     - No message, mail, screen, topic or payload text in a row.
     - The chain check, with the pruning anchor.
  6. **The stop button:** every place it is (dashboard, tray, global key, bot, phone, lock screen) ends agent and voice
     calls, computer control, phone control, the mirror and waiting approvals. Resume is person only.
  7. **A turn started by voice:**
     - The plugin's room-turn refusal and the core's voice window.
     - No approval by voice.
     - Gadgets are subject to "safe by voice" like any `home.control` action.
  8. **Mini's own tools on the phone:** `assets/start-mini.sh` writes the exact `--allowedTools` and
     `--disallowedTools` of `docs/03`, the app never writes Termux's or Claude Code's settings, and the Termux log-level
     check exists.
  9. **Keys and secrets:**
     - Every secret in the table is stored where it says, including the new PIN hash, gadget and broker passwords, the
       Hue key and the skill id.
     - None is returned by a route, put in `info`, `state`, an export, an error or a log.
     - `REDACT` covers each field name used.
  10. **The network:**
      - Every listener binds where `docs/03` says: the core on `127.0.0.1`; the device link on private networks only,
        TLS 1.3, closed with no phone paired; the Alexa listener on `127.0.0.1:47801` and only while on.
      - Every outgoing connection in the core is one of: `lanFetch`, `lanSocket`, `lanUdp`, `lanConnect`, the pinned
        Hue request, the Alexa certificate fetch, IMAP or SMTP to the owner's servers, or the mini connector on
        127.0.0.1. Search for `fetch(`, `http.request`, `https.request`, `tls.connect`, `net.connect`, `createConnection`,
        `dgram` and `execFile`.
      - The CSP is unchanged.
      - `ui/dist` contains no `http://` or `https://` URL other than `127.0.0.1` and the local IPC ones (search the
        built files).
  11. **The dashboard itself:** the lock (RF1), and privacy mode (RF5).
  12. **Capture is never hidden:** the mic, the screen, phone control and the mirror each show their indicator, and
      Hide does not hide it (read the code paths).
  13. **The repository:**
      - Run the secrets search of `03` > Keeping the repository clean over the tracked and untracked-but-not-ignored
        files of both repositories.
      - `git status --ignored` shows `local/`, `*.minihub`, `android/app/libs/` and any keystore ignored.
      - No AAR, APK, database or backup is tracked.
  14. **The plugin** (`F:\claude mini-bot`):
      - The `hub_*` tools register only on the PC with Mini Hub installed.
      - The untrusted line is on every tool result with other people's words.
      - Room turns refuse every other tool.
      - On Android, the tools are as in 0.11.0.
- **`docs/13-security-review.md`**:
  - The date, the versions read (Mini Hub 0.7.0, phone 0.7.0, Mini Bot), and the method.
  - A table: ID (`S1`…), the section of `docs/03`, severity (Critical: breaks a rule in `AGENTS.md`; Important: a
    real way round a switch, a secret or a log rule; Minor: hardening or wording), what was found, where, the fix,
    and status (Fixed in this task / Accepted, with the reason and where `docs/11` says so).
  - Then "Holds" with one line per section and its evidence, and "Out of scope, said plainly" (as `docs/03` says).
- **Fixes:**
  - Every Critical and Important finding is fixed here and rechecked. A Minor one is fixed if small; otherwise it is
    accepted with a row in `docs/11` > Risks.
  - A fix that needs a decision of the owner's is not made. It is marked "Needs the owner" and raised in the report.
  - No new tests (Global Constraints). A fix that changes behaviour an existing test pins updates that test minimally.

- [ ] Read through, write `docs/13`, fix.
- [ ] Run every check that the fixes touch. Expected: PASS.

### Task 10: Checks, final review, the installer, the phone release build, and the report

Not a code task beyond fixes found here.

- [ ] Run every check in Global Constraints (the plugin's only if Task 9 changed it). All PASS. Run the secrets search
  of `03` > "Keeping the repository clean" over the tracked and new files of both repositories, and look at every hit.
- [ ] Final review of Tasks 1–9 against the Review Focus (RF1–RF8) and the Global Constraints; one fix pass. Write the
  rulings and deferred minors in the ledger `.superpowers/sdd/2026-11-23-finishing/progress.md`.
- [ ] If Task 9 changed the plugin, wait for the owner to commit and push Mini Bot 0.12.0 (the phone fetches it from
  the public repository).
- [ ] Build the installer: `export PATH="$HOME/.cargo/bin:$PATH" && cd /f/mini-hub && npm run build:shell`.
  Expected: `Mini Hub_0.7.0_x64-setup.exe` under `shell/src-tauri/target/release/bundle/nsis/`. Do not install it; the
  owner does.
- [ ] Build the phone's release: `cd /f/mini-hub/android && ./gradlew :app:assembleRelease`. Expected: a signed
  `app/build/outputs/apk/release/app-release.apk`, version 0.7.0. With the owner's go-ahead, install it over 0.6.0 on
  the owner's phone with `adb install -r` (nothing typed, nothing granted). On the owner's emulator, for the guide's
  trial, install it only if the owner asks.
- [ ] With the owner, the guide's trial (Owner steps 6 and 7). Write down every step where the guide was unclear,
  wrong or missing, fix `docs/12` at once, and note each fix in the report.
- [ ] Write the phase report into `docs/10` > "Results so far" as "Phase 7, <date>", following the template below, and
  add the template itself to `docs/10` > "What a phase report says" for later releases. Write decisions the owner made
  during the phase into `docs/11` > Decided as `YYYY-MM-DD: decision, and what changed`.

**The phase report template:**

```
### Phase 7, <date>: Finishing

**Versions:** Mini Hub 0.7.0 · phone app 0.7.0 · Mini Bot <0.11.0 or 0.12.0>.

**Done when:** "A fresh Windows user account and a factory-fresh test phone (or an emulator for everything but the
Nothing features) can be set up from the guide alone."
- Result: <passed / not yet>, on <date>, by <the owner>, with <Windows account kind> and <emulator image or test phone model, Android version>.
- Steps where the guide was changed during the trial: <list, or none>.
- Steps not tried, and why: <list>.

**Delivers** (one line each: built; how checked; on real devices or only by the checks):
- The lock (idle, Windows Hello, PIN, Stop while locked): …
- Privacy mode: …
- Gadgets you describe (web, MQTT): …
- Backup reminders: …
- What changed: …
- The clean-install guide (docs/12) and the master checklist: …
- Keyboard and screen readers, dashboard: <fixed n, left m (ledger)>; Narrator by the owner: …
- Screen readers, phone: <fixed n, left m>; TalkBack and Yes by the owner: …
- The security read-through (docs/13): <n findings: x Critical, y Important, z Minor; fixed …; accepted …; needs the owner …>.

**Verified on the owner's devices:** …
**Only by the checks:** …
**Not done, and why:** …
**Measurements:** memory with the window closed and open (against T2's target); the phone's battery for a day (against 08's); the APK's size.
**Docs changed:** …
**Secrets search:** the command run, the hits looked at, and the result.
**Open for the owner:** …
```

## Owner steps

Only the owner can do these; nothing in this plan does them for the owner. The full list for a new PC and phone is
`docs/12-setting-up-from-scratch.md` > Every step only you can do.

1. **Install.** Install Mini Hub 0.7.0 over the old one. Say yes to installing the phone app 0.7.0 over 0.6.0 (the
   controller runs `adb install -r`). If Task 9 changed the plugin, commit and push Mini Bot 0.12.0, run
   `claude plugin update mini-bot`, restart Mini's session, and on the phone use Brain > Update Mini Bot. Commit and
   push this phase's Mini Hub changes when you are happy with them.
2. **The lock.**
   - Set up Windows Hello in Windows Settings > Accounts > Sign-in options, if it is not already.
   - In Mini Hub, Settings > Lock: turn it on with Windows Hello (Windows asks once), set 1 minute, and wait. The
     window locks. Unlock with Windows Hello.
   - Then try a PIN: set one, lock with Lock now (top bar or tray), unlock with the PIN.
   - Type a wrong PIN five times and see the wait.
   - Press Stop Mini on the lock screen, then unlock and Resume.
   - Choose the time you want, or turn the lock off.
3. **Privacy mode:** press the eye in the top bar. Names and previews blur. Move to one with Tab and it shows. An
   approval stays readable.
4. **A gadget (optional):** House > Add a home device > A gadget I describe myself.
   - Describe one of your own gadgets, by its web address or its MQTT topics, from its maker's page or manual.
   - Try on and off. Save.
   - Share it with Mini on its page if you want, and ask Mini on the PC to switch it.
5. **Backups:** Settings > Data > "Remind me to back up". Make a backup (Export) and see the Home line go. Open What
   changed from Settings > About.
6. **Screen readers.**
   - On the PC, turn Narrator on (Ctrl+Windows+Enter) and move through Home, the Inbox, Permissions and an approval
     with Tab. Say what was hard.
   - On the phone, turn TalkBack on in Android's accessibility settings. Move through Home and Perms. Ask Mini on the
     phone for something that asks first, double-tap Yes, and confirm with your fingerprint or screen lock: it is
     allowed. Double-tap No on another: it is refused.
   - Turn TalkBack off when done.
7. **The "Done when" trial: set up from the guide alone.**
   - Make a new local Windows account for the trial, and use an Android emulator (Android Studio's Device Manager) or a
     spare phone. **Not** your daily phone: pairing it with the trial's hub would unpair it from yours.
   - Follow `docs/12` from the start, in that account and on that phone, without help. Write down every place you had
     to guess.
   - The Nothing features (Glyph, Nothing's widgets look) are skipped on the emulator.
   - When done, remove the trial account (Windows Settings > Accounts > Other users) and the emulator's data.
8. **Read `docs/13-security-review.md`.** Decide each item marked "Needs the owner", and say whether you accept each
   item marked "Accepted".
9. **Read the phase report** in `docs/10` and say whether Phase 7 is done.

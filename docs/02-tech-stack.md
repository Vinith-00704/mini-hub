# 02. Tech stack

Versions: use the latest stable release of each on the day a phase starts, pin it exactly in the lock file, and
write the version into this page. Minimums are given only where something depends on them. Check each library's
current documentation before using it; do not rely on memory for its API.

## At a glance

| Part | Language | Main choices |
|---|---|---|
| Core | TypeScript, Node 24 LTS | Fastify, `ws`, SQLCipher through `better-sqlite3-multiple-ciphers`, `zod` |
| Dashboard | TypeScript | React, Vite, Tailwind CSS v4, Radix primitives, TanStack Query, `react-grid-layout`, Lucide icons |
| Shell | Rust | Tauri 2, with the tray, single-instance, autostart and global-shortcut plugins, and the `keyring` crate |
| Phone app | Kotlin | Jetpack Compose (Material 3), Room on SQLCipher, OkHttp, kotlinx.serialization, WorkManager, Glance |
| Shared protocol | TypeScript (`zod`) | Schemas written once, exported as JSON Schema and example files |
| Brain | n/a | Claude Code, with the Mini Bot plugin (its own repository) |

## Core

| Choice | Why | Instead of |
|---|---|---|
| **Node 24 LTS, TypeScript** | The Mini Bot runtime is Node, so the team of one already has it, its patterns (token file, local HTTP) carry over, and the same `shared/config.mjs` can be imported for bot profiles. | Rust inside Tauri (one language fewer at run time, but every connector, IMAP included, written in Rust: slower to build and to change). |
| **A bundled `node.exe`** as the shell's sidecar | "Standalone application": the hub must not depend on whatever Node the PC has. | Relying on the installed Node. |
| **Fastify** + **`ws`** | Small, typed routes with schema validation; WebSocket for live updates and the device link. | Bare `node:http` (fine for the bot's small runtime, tedious at this size). |
| **`zod`** | One definition gives run-time checking and the TypeScript type, and exports JSON Schema for the phone side. | Hand-written checks. |
| **SQLCipher** (`better-sqlite3-multiple-ciphers`) | One encrypted file, full-text search (FTS5) still works, no server. | Plain SQLite with encrypted columns (breaks search); `node:sqlite` (no encryption). |
| **`imapflow`, `nodemailer`, `html-to-text`** (2.11.0, 10.4.0, 10.0.1, exact) | The usual, maintained mail libraries for Node: IMAP reading (with IDLE and peeks that never mark mail read), SMTP sending and building messages, and HTML mail turned into plain text. No `mailparser`: the hub fetches only a message's text part, never the whole message. | Gmail's API (needs a Google Cloud project and its review, for no gain here). |
| **`bonjour-service`** | Announces the hub on the home network so the phone finds it without typing an address. | A fixed address typed by hand (kept as the fallback). |
| **`@peculiar/x509`** (or `selfsigned`) | Makes the hub's own certificate at first start. | A public certificate (impossible for a home address). |
| **`qrcode`** | The pairing code on screen. | n/a |
| **`pino`** | Structured logs, with a redaction list so message text and numbers never reach a log file. | `console.log`. |
| **Vitest** | Tests. | Jest. |

The core has no user interface and serves no web pages.

## Dashboard

| Choice | Why |
|---|---|
| **React + Vite + TypeScript** | The most widely known way to build this, which matters when another person or model picks it up. |
| **Tailwind CSS v4** with the design tokens as CSS variables | The tokens in `07-dashboard-design.md` map straight onto it; themes are a change of variables. |
| **Radix primitives**, wrapped in the project's own components (the shadcn/ui pattern: the component code lives in `ui/src/components/ui/`) | Accessible dialogs, menus, switches and tooltips without a look imposed from outside. |
| **TanStack Query** + one WebSocket | Fetching and caching from the core; the socket pushes "this changed" and the query refetches. |
| **TanStack Router** | Typed routes. |
| **`react-grid-layout`** | Drag, resize and rearrange widgets on a board. |
| **Lucide** | One consistent icon set, bundled. |
| **uPlot** | Small, fast charts for battery and usage. |
| **Geist Sans and Geist Mono**, bundled as files | A clean modern face with good numerals. Bundled, because the dashboard loads nothing from the internet. Any open-licence pair may replace them. |
| **Vitest + Testing Library**, **Playwright** against a fake core | Component tests and whole-screen tests. |

Content security policy: `default-src 'self'`; connections only to the core's local address. No remote fonts,
scripts, images or analytics, ever.

## Shell

| Choice | Why | Instead of |
|---|---|---|
| **Tauri 2** | Uses the WebView2 that Windows 11 already has, so the shell itself is a few megabytes and, with the window closed, costs almost no memory. This PC is often short of memory. Gives the installer, the tray, autostart and single-instance for free. | Electron (simpler, one language, but its background process is far heavier); a browser tab (cannot hold the person key safely, and is not a standalone app). |
| **`keyring` crate** | Keeps the database key in Windows Credential Manager. | A key file on disk. |
| **Dashboard files bundled into the shell** (not served by the core) | Only the shell's own window can load the dashboard, and only that window is given the person key. | The core serving the dashboard over HTTP (any browser, and so any program, could open it). |

The shell stays small: start the core, hand it the keys, show the window, own the tray and the global key. No
business logic.

As built (2026-11-22):
- Closing the window destroys it, which frees the web view (about 370 MB); the tray, `Ctrl+Alt+H` and a second
  launch build it again. Started with Windows (`--hidden`), only the tray and the core run (under 100 MB).
- The shell works out the data folder once and always passes it to the core as `MINI_HUB_HOME`.
- For trying a build without touching the owner's data: `MINI_HUB_HOME` (a full path) and `MINI_HUB_KEY_ACCOUNT`
  (the Credential Manager account, default `database`). Development (`npm run tauri dev`) uses
  `.minihub-home/shell-dev`, the account `database-dev`, and leaves the real Mini Bot alone unless `MINI_HUB_DEV_BOT=1`.
- The core is started without `NODE_OPTIONS`, since it holds both keys.

Needs installing on the build PC: the Rust toolchain (`rustup`, the MSVC target) and the Visual Studio C++ build
tools. WebView2 is present.

## Phone app

| Choice | Why |
|---|---|
| **Kotlin, Jetpack Compose, Material 3** | The standard for a new Android app. The theme is the project's own (see `07`), not Material's defaults. |
| **minSdk 33, targetSdk 36** | The owner's phone runs Android 16. A floor of Android 13 keeps the on-device speech recognizer and the newer notification and foreground-service rules without supporting old behaviour. |
| **Room on SQLCipher** (`net.zetetic:sqlcipher-android`), key in the Android Keystore | The phone's record is encrypted at rest. |
| **OkHttp** (WebSocket, certificate pinning) | The link to the hub. |
| **kotlinx.serialization** | The same JSON as the protocol's schemas. |
| **WorkManager** + a foreground service | Periodic "is the hub there?" checks; the service keeps the bot and the collectors alive. |
| **`NsdManager`** | Finds the hub on the home network. |
| **ZXing (`zxing-android-embedded`)** | Reads the pairing QR code on the device, with no Google service involved. |
| **Android `SpeechRecognizer` (on-device) and `TextToSpeech`** | Voice in and out without sending audio anywhere. |
| **Glance** | The home-screen widget. |
| **Nothing's Glyph Developer Kit** (`glyph` AAR from the kit's repository) | The Glyph lights. |
| **JUnit, Robolectric, Turbine**; Compose UI tests for the consent screens | Tests. |

Build: Gradle with the Kotlin DSL. Present on the build PC: JDK 17, the Android SDK (platforms 34 to 36, build
tools 36), `adb`, `scrcpy`. The Android Gradle Plugin version chosen must accept JDK 17, or the JDK is updated.

## Mini's brain on the phone

| Piece | What | Note |
|---|---|---|
| **Termux** | The terminal environment | Installed from the official GitHub release today. See `11-open-decisions.md` about moving to the F-Droid build. |
| **Claude Code** | Anthropic's Linux arm64 program, run through Termux's `glibc-runner` | Installed with the community `claude-code-android` installer. Unofficial. |
| **Node, tmux, git** | Termux packages | Node runs the Mini Bot runtime; tmux gives Claude Code a terminal to live in while nothing is on screen; git lets Claude Code install the plugin from its marketplace. |
| **Termux `RUN_COMMAND`** | How the phone app starts and stops things in Termux | Needs `allow-external-apps = true` in Termux's settings file and the phone app granted Termux's "run commands" permission. The owner sets both by hand, once. |

## Shared protocol

`protocol/` holds the `zod` schemas for events, link messages and commands, a script that exports them as JSON
Schema, and a folder of example messages. The core imports the schemas directly. The phone app has hand-written
Kotlin classes, and a test on each side reads every example file and checks that it parses and round-trips. A
change to the protocol is a change to the schema, the examples and both sides, in one piece of work.

## Repository layout

```
mini-hub/
  AGENTS.md  CLAUDE.md  README.md  .gitignore
  package.json                 npm workspaces: protocol, core, ui
  docs/
  protocol/
    src/                       events.ts, link.ts, commands.ts, scopes.ts
    examples/                  one JSON file per message kind
    schema/                    generated JSON Schema (committed, so the Android side can read it)
  core/
    src/
      main.ts                  reads the keys from stdin, opens the database, starts everything
      api/                     local API routes
      link/                    device link: TLS, pairing, sync
      rules/                   grants, approvals, risk, the stop state
      audit/
      store/                   database, migrations (numbered .sql files)
      connectors/
        pc/  mini/  android/  mail/  home/  alexa/
    test/
  ui/
    src/
      app/                     routes, layout, providers
      components/ui/           the project's own base components
      features/                inbox, devices, home, mini, activity, permissions, settings
      widgets/                 one folder per widget
      design/                  tokens.css, fonts/
    test/
  shell/
    src-tauri/                 Rust, tauri.conf.json, capabilities, icons
  android/
    app/src/main/java/.../     overlay, collect, link, brain, hands, consent, voice, nothing, ui, data
    app/src/test/
  tools/
    dev.mjs                    runs core + dashboard for development
    seed.mjs                   fills a scratch database with made-up people and events
  local/                       ignored by git
```

One npm workspace for `protocol`, `core` and `ui` (npm is already installed; no other package manager is needed).
`shell` and `android` have their own build systems.

## Commands (to exist once the code does)

| To | Run |
|---|---|
| Develop the hub | `npm run dev` (core on a scratch data folder with seeded data, dashboard with hot reload, in the shell) |
| Test | `npm test` (protocol, core, ui); `./gradlew test` in `android/` |
| Type-check and lint | `npm run check` |
| Build the Windows installer | `npm run build`, then `npm run tauri build` in `shell/` |
| Build the APK | `./gradlew assembleRelease` in `android/` |
| Install the APK on the connected phone | `adb install -r app/build/outputs/apk/release/app-release.apk` |

## Left to the builder

- Exact versions, the lint and formatting setup, and the folder structure below the level shown.
- Whether `@peculiar/x509` or `selfsigned` makes the certificate.
- How the bundled `node.exe` and the core's bundle are packed into the installer (one bundled JavaScript file plus
  the native database module is the expected shape).

# Desktop shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mini Hub a standalone Windows app: a tray icon, a window that shows the dashboard, the core started
in the background with its keys, a global key, single instance, optional start with Windows, and an installer.
This is also trial T2 of `docs/10-build-plan.md`.

**Architecture:** A Tauri 2 shell (`shell/src-tauri`, Rust). At start it takes the database key from Windows
Credential Manager (making it the first time), makes a new person key, starts the bundled core (`node.exe` plus
one bundled `core.mjs`) and writes both keys on the core's standard input, then waits for its ready line. The
dashboard is the built `ui/dist`, loaded by the shell's own window, which receives the person key and port from a
Tauri command. Closing the window hides it; the core keeps running until Quit.

**Tech Stack:** Tauri 2.x (Rust 1.100, MSVC), `tauri-plugin-single-instance`, `tauri-plugin-autostart`,
`tauri-plugin-global-shortcut`, `keyring` 3, `rand`, `ureq`; esbuild for the core bundle; `@tauri-apps/api` in the dashboard.

**Spec:** `docs/02-tech-stack.md` (Shell), `docs/03-security-and-permissions.md` (Who is calling, Keys and secrets),
`docs/07-dashboard-design.md` (Settings > Start-up), `docs/10-build-plan.md` (T2, Phase 1).

## Global Constraints

- **The owner commits.** No task commits or pushes.
- The person key is never written to disk, an environment variable or a command line; the database key lives only in
  Windows Credential Manager (service `MiniHub`, account `database`) and the core's standard input.
- The core is started with `MINI_HUB_HOME` unset (so `%APPDATA%\MiniHub`) in the installed app; the developer run
  (`npm run tauri dev`) sets it to `.minihub-home/shell-dev` and uses a separate credential account `database-dev`.
- The shell's window is the only page given the key. The dashboard's origin under Tauri on Windows is
  `http://tauri.localhost`; that exact origin is the core's `uiOrigin`.
- No consent surface is clicked by a script. Testing the real installed app on the owner's PC is done with them.
- Window starts 1280 × 800, minimum 900 × 600. Global key default `Ctrl+Alt+H` (checked free on this PC first).
- Target (T2 pass mark): with the window closed, shell + core under 120 MB of memory together.

## Review Focus

1. **The core exits or fails to start** (wrong key, already running, crash): the window shows the core's own
   message, not a blank page, and Quit still works. (Task 3 test `start errors reach the window`.)
2. **A second launch of the app**: it brings the first window forward and exits; never a second core. (Task 4, by hand.)
3. **The credential exists but the database does not, or the reverse**: never a new key over an existing
   database; a missing key with an existing `hub.db` is an error that says to restore the key. (Task 3 test `refuses to make a new key for an existing database`.)
4. **Quit while a request is in flight**: the core gets end-of-input and removes `hub.json` and its lock. (Task 3, by hand: no `hub.json` after Quit.)
5. **The global key is taken by another program**: the app still starts and Settings says the key is not available. (Task 4 test `a taken shortcut is reported, not fatal`.)

---

### Task 1: Bundle the core for shipping

**Files:** Create `tools/bundle-core.mjs`; Test `core/test/bundle.test.ts`

**Interfaces:**
- Produces: `node tools/bundle-core.mjs <outDir>` writes `<outDir>/core.mjs` (esbuild, platform node, ESM, Node 24,
  `better-sqlite3-multiple-ciphers` external), `<outDir>/migrations/*.sql`, and
  `<outDir>/node_modules/better-sqlite3-multiple-ciphers/` with only `package.json`, `lib/` and `prebuilds/win32-x64.node`
  (plus its runtime dependencies `bindings` and `file-uri-to-path` if it has them). Also copies `process.execPath` to
  `<outDir>/node.exe` unless `--no-node`.
- [ ] **Step 1: Failing test** `the bundled core starts, answers health, and exits on end of input` (bundle into a temp
  folder with `--no-node`, start it with the running Node and a temp `MINI_HUB_HOME`, same keys line as main.test).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 2: The dashboard takes its keys from the shell

**Files:** Modify `ui/src/main.tsx`, `ui/src/app/keys.ts`; Test `ui/test/keys.test.ts`

**Interfaces:**
- Produces: `keysFromShell(invoke = tauriInvoke): Promise<Keys | null>` in `ui/src/app/keys.ts` — when running inside
  Tauri (`'__TAURI_INTERNALS__' in window`), calls the command `hub_keys` and returns `{ api, key }`; outside Tauri returns null.
  `main.tsx` uses the fragment first (development), then the shell.
- [ ] **Step 1: Failing tests** `keys come from the shell inside Tauri`, `outside Tauri nothing is asked`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 3: The shell starts the core with its keys

**Files:** Create `shell/package.json`, `shell/src-tauri/{Cargo.toml, build.rs, tauri.conf.json, capabilities/main.json, icons/*}`,
`shell/src-tauri/src/{main.rs, lib.rs, keys.rs, core.rs}`; Test: Rust unit tests in `keys.rs` and `core.rs`

**Interfaces:**
- `keys.rs`: `new_key() -> String` (64 hex); `database_key(store: &dyn KeyStore, db_exists: bool) -> Result<String, String>` —
  returns the stored key; makes and stores one only when there is none **and** no database yet; with a database
  but no key returns `Err("The hub's key is missing from Windows. Restore it from a backup, or move hub.db away to start fresh.")`.
  `KeyStore` is a trait (`get`, `set`) with a `keyring` implementation and an in-memory one for tests.
- `core.rs`: `parse_ready(line: &str) -> Option<u16>` for `{"ready":true,"port":N}`; `start_core(paths, keys) -> Result<CoreHandle, String>`
  spawns node with `core.mjs`, writes `{"dbKey","personKey","uiOrigin":"http://tauri.localhost"}\n`, waits up to 20 s
  for the ready line, collects standard error for the message on failure; `CoreHandle::stop()` closes standard input
  and waits up to 5 s, then kills.
- `lib.rs`: state `Hub { port, person_key, error }`; command `hub_keys() -> Result<{api, key}, String>` (Err carries the
  core's message); window hides on close; Quit stops the core.
- [ ] **Step 1: Failing tests** `new keys are 64 hex and differ`, `makes a key only when there is no database`,
  `refuses to make a new key for an existing database`, `parse_ready reads the port and ignores other lines`.
- [ ] **Step 2: Run** `cargo test` in `shell/src-tauri` — FAIL.
- [ ] **Step 3: Implement.** The UI shows the core's message when `hub_keys` errs (`start errors reach the window`:
  a dashboard test with a mocked invoke that rejects).
- [ ] **Step 4: Run** `cargo test` and `npx vitest run --project ui` — PASS.

### Task 4: Tray, key, single instance, start with Windows

**Files:** Modify `shell/src-tauri/src/lib.rs`; Create `ui/src/features/settings/StartUp.tsx`; Test `ui/test/startup.test.tsx`

**Interfaces:**
- Tray: icon, tooltip "Mini Hub"; menu **Open Mini Hub**, **Stop Mini** (POST `/v1/stop` with the person key), **Quit**.
  Left click opens the window.
- Global key `Ctrl+Alt+H` toggles the window; if registration fails, `shortcut_status() -> { key, ok }` says so.
- Single instance: a second launch focuses the first window and exits.
- Commands `autostart_get() -> bool`, `autostart_set(on: bool)`; Settings > Start-up shows the switch, the key and
  whether it is available (only inside Tauri).
- [ ] **Step 1: Failing tests** `start-up shows the switch inside the shell and calls autostart_set`, `a taken shortcut is reported, not fatal`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); `cargo build` clean.

### Task 5: Installer and the T2 measurement, by hand

- [ ] **Step 1:** `npm run build:shell` (builds ui, bundles core with node.exe, `tauri build`) makes an NSIS installer.
- [ ] **Step 2:** Run the built app from `target/release` with `MINI_HUB_HOME` pointed at a scratch folder and a dev
  credential account: window opens on the dashboard; close hides it; tray Open brings it back; Quit removes `hub.json`.
- [ ] **Step 3:** Measure memory with the window closed and open (shell, WebView2 children, core). Record against 120 MB.
- [ ] **Step 4:** Installing on the owner's real profile, and turning on start with Windows, are the owner's to do.

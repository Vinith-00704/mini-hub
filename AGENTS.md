# For whoever builds this

You are picking up a planned, unbuilt project. The owner is one person who uses this for their own life: their
phone, their PC, their mail and their home. Read this page, then `docs/` in the order the README gives.

## What must stay true, whatever you build

These come from the owner. A change that breaks one is wrong even if it works.

1. **Nothing acts unless the owner said so.** Every connection has its own switch. Sending, deleting, buying,
   and changing anything outside the hub ask first, every time, even where broad access was given.
2. **Only the owner's own click grants access.** A program, a script, a test or Claude itself never clicks a
   consent surface, never writes a grant into the database by hand, and never passes itself off as the person.
   If a check stops you from doing this, the check is right. Do not look for a way round.
3. **One brain.** Mini is always a real Claude Code session: Mini's own session on the PC, Claude Code in Termux
   on the phone. Do not add a second assistant, a separate model call path, or an API key path, unless the owner
   asks for it in `docs/11-open-decisions.md`.
4. **Local first.** Data stays on the owner's devices. The hub listens on the home network only for paired
   devices, over an encrypted link. Nothing is exposed to the internet except the one Alexa route, and only if
   the owner turns it on. The dashboard loads nothing from the internet: no fonts, scripts or analytics.
5. **Capture is never hidden.** When the screen, the microphone or the phone's controls are in use, something on
   that device shows it, and hiding the bot never hides that.
6. **The PC learns nothing while it is off.** The phone keeps its own record and hands it over when both are home.
7. **Everything is logged, and the log cannot be edited by Mini.**
8. **Secrets and personal data never reach git.** See `.gitignore` and `docs/03-security-and-permissions.md`.
   Do not write the owner's name, mail address, phone number, device serial, home network name or account names
   into any tracked file, test fixture or commit message. Use made-up values.

## How to work here

- **The owner commits and pushes.** Never commit or push unless they ask.
- **One phase at a time.** `docs/10-build-plan.md` gives the order. Before a phase, write its step-by-step plan
  and have the owner approve it. Run the trials in Phase 0 before anything that depends on them.
- **Test against scratch data.** Tests set `MINI_HUB_HOME` (and `MINI_BOT_HOME` for the bot's runtime) to a
  throwaway folder. Never point a test at the owner's real data folder, and never run a test Claude Code session
  that shares the owner's stored plugin settings without reading `docs/10-build-plan.md` > "Testing safely".
- **The phone is the owner's daily phone.** It is nearly full and in use. Do not type into it with `adb input`
  (an open Claude session in Termux will take the keys as a prompt), do not lock or wake it for a test without
  asking, and do not install anything on it that the current phase does not call for.
- **Say what you did not test.** A phase report lists what was verified on real devices and what was not.
- **Keep the docs true.** When a decision changes, change the doc in the same piece of work.

## Where things are

| Path | What |
|---|---|
| `docs/` | The plan |
| `protocol/` | Message and event schemas shared by the hub and the phone app, with example files both sides test against |
| `core/` | The hub core: a Node service (TypeScript) |
| `ui/` | The dashboard: a React app (TypeScript) |
| `shell/` | The desktop shell: Tauri (a small Rust program) that shows the window and the tray icon and starts the core |
| `android/` | The phone app (Kotlin) |
| `tools/` | Scripts for development: run everything, seed made-up data |
| `local/` | Ignored by git. The owner's own notes, device details and keys while developing |

None of these folders except `docs/` exists yet.

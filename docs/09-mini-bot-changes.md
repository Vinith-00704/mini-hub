# 09. Changes to the Claude Mini Bot

The Mini Bot is its own repository (`Claude-Mini-bot`): a Claude Code plugin (`hooks/`, TypeScript), a companion
runtime (`runtime/`, Node with no packages), a Windows overlay (`runtime/overlay/`, C#), and the settings model
both sides share (`shared/config.mjs`). It stays that way. This page lists what changes there for the hub and for
the phone. Each change is its own version of the plugin, with the version number raised in the same commit as the
code, because that is how its updates are found.

Its own rules are unchanged and apply to every change below: consent only by the owner's click in the bot;
capture never hidden; Claude Code itself is never ended; a profile change never resets the session.

## A. The hub's tools (PC)

**What**: four tools for Mini's Claude Code session: `hub_status`, `hub_read`, `hub_act`, `hub_log` (`05`).

**Where**

- `hooks/lib/hub.ts` (new): the tool definitions, and a client that reads `hub.json` from the hub's data folder
  (`%APPDATA%\MiniHub`, or `MINI_HUB_HOME`) and calls the core with the agent token. Modelled on the existing
  `hooks/lib/client.ts` and `hooks/lib/computer.ts`.
- `hooks/register.ts`: register the tools with `$.tool.register`, and serve them in the existing `tool.call` hook.
- The mod loader's rule holds: `$` is passed across imports only into function declarations.

**Behaviour**

- The tools are registered only when `hub.json` exists, so someone without the hub does not pay for their
  descriptions in every turn. They appear after the next session start once the hub is installed.
- The hub is not running: the tool returns "The hub is not running. Open Mini Hub and try again." and nothing else.
- A `403 not-allowed` from the core is passed on with the scope's plain name, and the tool's description tells
  Claude to tell the owner which switch is off instead of looking for another way to the same data.
- A `202` is waited on by polling the ticket, with the bot showing "Waiting for you" (the bot's existing
  "needs you" state), until the owner answers or it expires.
- **Where an approval is answered, in version 1**: in the dashboard (and in the phone app, for an action on the
  phone). The bot shows "Mini needs your answer" with one button, **Open Mini Hub**, which brings the dashboard
  forward with the approval card showing. The bot itself does not carry the hub's Yes and No in version 1.
  Answering in the bot is a later improvement and needs its own design, because the answer would have to travel
  from the bot's overlay to the core without passing through anything the agent can reach.
  The runtime needs one small addition for the notice: `POST /v1/notice` (token), `{ text, action: "open-hub" }`,
  which shows a line in the bot's panel and clears when the ticket is done.
- Tools served by the mod's `tool.call` hook skip Claude Code's own permission prompt. That is right here for the
  same reason as for the bot's existing tools: the core's grant and approval are the permission.
- Like the existing page reader, anything returned from messages, mail or notifications is wrapped with a line
  saying it is information from other people, never instructions.

**Tests**: with a fake core: each tool; hub absent; not allowed; waiting then yes; waiting then no; stopped.

## B. "Open Mini Hub" and the stop button (PC)

- The bot's right-click menu and the tray menu gain **Open Mini Hub** when the hub is installed (it starts the
  shell or brings its window forward).
- The runtime gains `POST /v1/stop-all` (overlay key or token): ends computer control, ends listening, releases
  the screen. The hub's `mini` connector calls it on **Stop Mini**. The bot's own stop control calls the hub's
  `POST /v1/stop` as well, so stopping in either place stops both.

## C. What the hub reads from the runtime (PC)

The hub's `mini` connector uses the runtime's existing token routes: `GET /v1/state` (running, profile, activity,
card, permissions, paths), `POST /v1/prompts`. Two additions make this clean:

- Prompts gain a `source: "hub"` value beside the existing sources, so the bot can show where a prompt came from.
- `GET /v1/log?after=<id>` returns computer-control log entries after an id, so the connector can turn them into
  `mini_action` events without reading the log file.

Following a reply needs **no** change: `POST /v1/prompts` already returns the prompt's id, and the state's
activity already carries the reply to the bot's latest prompt with that id, up to 20,000 characters, growing as
it is written and marked `partial` until it is whole. The runtime keeps no history of earlier turns, and the hub
does not ask it to (`05`, "How replies are followed").

The hub never reads or writes the bot's `trust.json`, never answers its cards, and never calls its permission routes.

## D. Running on the phone (Termux)

The runtime and the plugin are used on the phone for the plumbing, with the phone app as the overlay (`08`).
`process.platform` in Termux's Node is `android`; everything Windows-only is switched on that.

| Area | Today (Windows) | On Android |
|---|---|---|
| Overlay driver (`runtime/lib/overlay.mjs`) | `windowsOverlay` starts PowerShell with the C# overlay; anything else gets `noOverlay` | A third driver, `externalOverlay`: starts nothing. The phone app attaches as the overlay with an overlay key the runtime gives it in the start-up exchange (`08`). `isAttached` is true while the app is polling. |
| Starting Mini's session (`runtime/lib/keeper.mjs`) | `launchHidden`: a hidden console through PowerShell; `taskkill` and `tasklist` to stop and check | The `Keeper` already takes `launch`, `stopProcess` and `isProcess` as parameters. Android versions: `tmux new-session -d -s mini-bot 'claude ...'`, `tmux kill-session`, `tmux has-session`. |
| The session's folders with full access | The PC's drives | Termux's home only. "Full access" is not offered on the phone: the phone's access is the phone app's grants. |
| Autostart (`runtime/lib/autostart.mjs`) | A Startup-folder script | None. The phone app starts things. |
| Computer control (`runtime/lib/computer.mjs`), screenshots, page reading | Jobs done by the Windows overlay | Not loaded. The phone's equivalents are the phone app's `phone_*` tools. |
| Speech (`hooks/lib/speech.ts`, whisper on Windows) | Local whisper | Not loaded. The phone app does speech and sends text prompts with `source: "voice"`. |
| Tools (`hooks/lib/computer.ts`) | `computer_*`, `screen_look`, `read_page`, `show_on_screen`, routines, `design_bot`, `get_bot` | `phone_status`, `phone_read`, `phone_look`, `phone_act`, `phone_send`, `phone_set` (`08`), served by calling the phone app's hands endpoint, whose address and agent token the runtime reports in its state. Routines, `design_bot` and `get_bot` stay. |
| Permission cards in the runtime | Screen, microphone, computer control, full access | None of these exist on the phone. The runtime shows no consent cards there; the phone app does. |
| Settings shared by sessions (`$.store`) | Shared between the installed plugin and every session | The same, within Termux |
| The session's instructions (`keeper.mjs`, `instructions`) | Written for a PC | A phone version: what the phone tools are, that control is one step at a time, that sending and buying always ask, that it is running on a phone with a small screen and should answer briefly |
| The session's own permissions | The owner's choice of Claude Code permission mode (skipping checks is never offered) | Fixed: `dontAsk`, with a settings file that allows the `phone_*` tools, routines, bot design, web search and fetch, and files in `~/.mini/work`, and refuses running commands and all other files (`03`, "Mini's own tools on the phone"). Trial T1 checks that this mode and these rules behave as described in the Claude Code version on the phone. |
| How the overlay proves itself | An overlay key handed to the overlay process the runtime starts | The overlay key, the hands endpoint's address and its agent token arrive on the runtime's standard input from the phone app at start (`08`). The runtime's `server.mjs` reads them when `MINI_BOT_OVERLAY=external`. |

**How the code is organised**: a `platform` module in the runtime and one in the hooks, each exporting what
differs (`overlay`, `launch`, `tools`, `instructions`, which features exist). The rest of the code asks the
platform module instead of testing `process.platform` in many places. The Windows behaviour must be byte-for-byte
unchanged; the existing tests are the check.

**Slash commands on the phone**: `/mini-bot` works in the Termux session as on the PC, minus the commands for
things the phone does not have (`full-access`, `autostart`, `speech install`, `terminal`), which say so.

**Bot profiles**: the active profile (name, art, colours, tone, notes) is synced from the hub to the phone app and
from there into the phone runtime's settings, so the same bot with the same character appears on both. Changes
made on the phone stay on the phone unless the owner sends them to the hub.

## E. Prompts from the room (the Echo Dot)

**What**: a prompt source, `room`, for words spoken to the Echo Dot, and limits that hold for the whole turn it
starts (`03`, "A turn started by voice").

**Where**

- The runtime accepts `source: "room"` on `POST /v1/prompts`.
- `hooks/lib/bridge.ts` already knows which prompt started the turn that is running (it uses this for spoken
  prompts and for streaming the bot's own replies). It records that the running turn is a room turn, from the
  moment the prompt is submitted until the turn ends.
- The `tool.call` hook, during a room turn: refuses `computer_start`, `computer_look`, `computer_act`,
  `screen_look`, `read_page` and `show_on_screen` with "Not available by voice from the room"; and adds
  `x-hub-origin: voice` to every `hub_*` call.
- A room turn's reply is never said aloud by the bot on the PC (the Echo Dot says it), and it does not open the bot's panel.
- The prompt text is wrapped with the note in `06` (who is speaking, answer briefly).

**Tests**: during a room turn each PC tool is refused and each hub call carries the header; the turn after it,
started at the bot, has neither.

## F. Order

| Change | Needed for | Phase (`10`) |
|---|---|---|
| D, as a trial only | Knowing whether the plugin loads and a prompt makes the round trip in Termux | 0 |
| C, B | The dashboard's Mini screen and Stop | 1 |
| D, properly | Mini on the phone | 3 |
| A | Mini using the hub's data on the PC | 4 |
| E | Talking to Mini through the Echo Dot | 6 |

## Risks specific to these changes

- **The plugin's mod system on Android is untested.** If the hooks do not load in Claude Code under Termux, the
  fallback is in `11`: the phone app drives Claude Code in its headless streaming mode and offers the phone tools
  as a local MCP server. The phone app's side (`hands`, `consent`) is the same either way, which is why it is
  designed as the judge.
- **Older sessions.** The owner keeps Claude Code sessions open across updates, and they share stored settings
  with newer ones. Any new field in the shared settings must survive an older session writing them back
  (`keepWhatACopyCannotHold` in `shared/config.mjs` is the existing mechanism).
- **A test session shares the owner's stored settings.** A real Claude Code run against a test copy of the
  runtime pushes the owner's real settings into it. Test the runtime over HTTP with a scratch `MINI_BOT_HOME`
  and no Claude Code session wherever possible (`10`, "Testing safely").

## Left to the builder

- The names and exact shapes of the new routes.
- How the platform modules are split.

# Phase 6: The home and the Echo Dot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 6 of `docs/10-build-plan.md`. The owner adds their own smart devices from **Devices > Add
device > Home device**, either found on the home network or typed in by address. The hub then talks to them on the home
network only, with no maker's cloud and no account. Each added device shows its state and switches from the new
**House** screen and its tiles, and by asking Mini, and only once the owner has shared it with Mini. A device that cannot
be reached or cannot be added is listed with the reason. Scenes switch several devices at once. Separately, the owner can
set up **"Alexa, ask Mini …"**: an Alexa skill of their own, kept in development, that reaches one checked route on the
PC through a tunnel. The route is off until the owner turns it on, and turning it off closes the tunnel and the
listener. Words spoken in the room become a `room` turn in Mini's own session. In that turn the Mini Bot plugin refuses
every tool except the four `hub_*` tools, and the core treats every agent call as voice: voice can read only what "Mini
may use" is **on** for (private things only with `voice.alexa.private` on), can run only actions ticked **safe by
voice**, and never creates an approval. The answer is spoken if it is ready within 6 seconds. Otherwise Alexa says "ask
me what it found", and the answer waits for that.

**Architecture:** Four pieces.

- **The hub core.** A `home` connector (`core/src/connectors/home/`) that is a frame with five **adapters**, one per
  local protocol: `shelly` (Gen2 and later, JSON-RPC over HTTP), `wled` (JSON API), `tasmota` (HTTP commands), `hue` (the
  Philips Hue Bridge's local API v2, paired by pressing the bridge's button), and `kasa` (TP-Link Kasa's older local
  protocol on TCP 9999). Every request goes through one helper that accepts only private IPv4 addresses. An `alexa`
  connector (`core/src/connectors/alexa/`): its own HTTP listener on `127.0.0.1:47801` that knows one path, Amazon's
  signature and timestamp check, the skill's setup steps, `room` prompts through the `mini` connector, and a
  `tunnel.ts` with two kinds: Tailscale Funnel, opened and closed by the hub only when the owner presses, and "a tunnel
  I run myself". There is also a voice-turn window in the core.
- **The Mini Bot** (`F:\claude mini-bot`, plugin **0.11.0**, on top of Phase 5's 0.10.0): change E of `docs/09`. The
  runtime accepts `source: "room"` prompts, gives them only to Mini's own session, keeps their replies off the bot's
  panel, and serves those replies to the hub. During a room turn the plugin refuses every tool except `hub_*` and marks
  every `hub_*` call `x-hub-origin: voice`.
- **The dashboard.** The House screen, a home device's page, scenes, and the `home-room`, `home-device` and
  `home-scenes` tiles. The Echo Dot's setup and page, "safe by voice" ticks in Permissions, and the `voice-requests`
  tile.
- **No new library anywhere.** mDNS uses `bonjour-service` 1.4.4, which the core already has. HTTP is Node's own `fetch`
  and `http`. TLS and X.509 checks are `node:tls` and `node:crypto` (`X509Certificate`, `tls.rootCertificates`). Kasa
  is `node:net` and `node:dgram`. Tailscale is the owner's own `tailscale.exe`, run with `execFile`. No npm package or
  crate is added, so no version needs checking.

```
 House / tiles --person--> /v1/actions home.set ----------------------+
 Mini (PC) --hub_act--> /v1/actions home.set --decide()--------------+--> home connector --lanFetch (10/8,172.16/12,192.168/16 only)--> Shelly / WLED / Tasmota / Hue / Kasa
                                                                       poller (10 s with the dashboard open, 60 s without) -> device state, home_state events

 Echo Dot -> Amazon -> https://<pc>.<tailnet>.ts.net/alexa -> Tailscale Funnel (opened only by the owner's press) -> 127.0.0.1:47801 (alexa listener, on only while the connector is on)
   check: cert-chain URL, chain to a trusted root, SAN echo-api.amazon.com, Signature-256 over the raw body, timestamp within 150 s, skill id
   -> voice.alexa.ask on? -> mini.askRoom(text) -> runtime queue (source room, only Mini's own session claims it)
   -> plugin: room turn: every tool refused except hub_*; hub_* carry x-hub-origin: voice; core: voice window open -> every agent call is voice
   -> reply within 6 s ? speak : "Mini is working on it. Ask me what it found in a moment." (kept in memory for "what did you find")
```

**Tech Stack:** As before (Node 24 core, Fastify, zod 4, SQLCipher; React 19, TanStack Query/Router; Tauri 2.12; the
plugin's mod hooks in TypeScript and the runtime in plain Node). No additions.

**Spec:** `docs/10-build-plan.md` (Phase 6, Testing safely), `docs/03-security-and-permissions.md` (Risk, the lock and
camera rule, A turn started by voice, The network, tests 6 and 11), `docs/06-connectors.md` (`home`, `alexa`),
`docs/07-dashboard-design.md` (House, Permissions, Settings > Network, Widgets), `docs/09-mini-bot-changes.md` (E),
`docs/01-architecture.md` (the Alexa route, flow 6), `docs/04-data-and-sync.md` (`home_state`, `voice_request`),
`docs/05-hub-api.md`, `docs/11-open-decisions.md` (D1, D2, D3).

## What already exists (and what Phases 4 and 5 will have added; not planned again)

- **Core, today:** the scopes `home.read` (collectable, one switch for the whole connector), `home.control`,
  `echo.speak` (both connector `home`), `voice.alexa.ask` and `voice.alexa.private` (connector `alexa`)
  (`protocol/src/scopes.ts`). The event types `home_state` (read under `home.read`) and `voice_request` (person only)
  (`protocol/src/events.ts`); `device_state` of any non-phone, non-PC device is read under `home.read`. `grants.voice_safe`
  and `PUT /v1/grants/:target/:scope { voiceSafe }` exist. `decide()` in `core/src/rules/policy.ts` already applies the
  voice rules: no approvals, nothing `important`, `act` only when safe by voice, private reads only with their switch.
  `Caller` has `voice` from the `x-hub-origin: voice` header (`api/server.ts`). The events route drops private types
  for a voice viewer without `voice.alexa.private`, silently: Task 1 makes that a refusal. `GET /v1/grants` (`allRows`)
  shows a connector-wide scope once that connector has a device. `POST /v1/disconnect` stops Mini and closes the device
  link. `bonjour-service` is used by `link/server.ts` to announce the hub. Test 11 of `docs/03` is covered today by
  `core/test/rules.test.ts` (the voice cases) and `core/test/api.test.ts` ("a voice turn never creates an approval").
- **Phase 4 (plan `2026-11-23-hub-for-mini.md`), finished before this phase:**
  - Task 1's connector plumbing: `Connector.setup?(ctx, session, step, input)` and `remove?(deviceId)`, `SetupStep` with
    `Field` (`text | email | password | number | choice`) and `error?`, `Ctx.secrets` (encrypted `secrets` table),
    `Ctx.settings` (`connectors.settings_json`, merged one level deep), `Ctx.grants`, the setup route
    `POST /v1/connectors/:id/setup` (sessions of 15 minutes), `GET /v1/connectors` with `devices`, `DELETE /v1/devices/:id`
    through `remove`, and `GET /v1/actions` with `args` (JSON Schema) and `devices`.
  - The mail connector. Boards, the widget registry `ui/src/widgets/registry.tsx` (`WidgetDef`, `WIDGETS`), edit mode,
    the gallery and `TileSettings`. `SetupWizard.tsx` and the Add device chooser (`AddDevice.tsx`: Phone, Mail account).
    `GET /v1/network` with `alexa: { state: 'off', note: 'Not set up. It comes with the Echo Dot update.' }` and Settings
    > Network showing that note.
  - Plugin 0.9.0: `hooks/lib/hub.ts` (`HUB_TOOLS`, `hubTool`, `serveHub($, tool, input, signal)`), registered on the PC
    when Mini Hub is installed. The runtime's `POST /v1/notice` and `VERSION` raised by one.
  - It said plainly that `home-room`, `home-device`, `home-scenes`, `voice-requests` and `x-hub-origin: voice` wait for
    this phase.
- **Phase 5 (plan `2026-11-23-phone-control.md`), finished before this phase:** the phone's actions and `phone-actions`
  tile, plugin 0.10.0 (Android-only changes; the PC behaves as 0.9.0). This plan touches nothing on the phone.
- **Mini Bot runtime, today:** `Prompts.enqueue` keeps `source` `voice` or `routine`, else `text`. `claim(bridge)` hands
  the whole queue to `target()`, which may be a terminal session the owner is working in. `POST /v1/activity` carries the
  bot's reply preview `{ id, text, partial }`. The bridge (`hooks/lib/bridge.ts`) knows the prompt that started the
  running turn (`current`, `pending`, `runningTurn`). `tool.call` sees every tool, including Claude Code's own (`Bash`,
  `Read`, …), and `classic.PermissionRequest` answers Claude Code's questions in Mini's own session through the bot's
  cards.
- **Not built anywhere:** any home adapter, the House screen, the Alexa listener, the tunnel, change E.

## Global Constraints

- **The owner commits.** No task runs `git commit`, `push`, `stash`, `reset`, `checkout -- …`, or anything else that
  changes git's index, refs or history, in `F:\mini-hub` or `F:\claude mini-bot`. The plugin's version is raised in the
  same piece of work as its code.
- **No new test files, no seed, demo, example or test data, no fake records, no recorded or made-up Alexa requests, no
  stand-in devices.** The owner tests with their own devices and their own Echo Dot. Existing suites stay green; when a
  change alters behaviour an existing test pins, update that test minimally and say so. No protocol example file is
  added. `tools/seed.mjs` and `tools/dev.mjs` are not changed. **Test 6** of `docs/03` (a wrong or stale signature is
  refused) is checked by hand in Task 10 and the Owner steps: no new test is written for it, because the owner's rule
  wins. **Test 11** is the existing tests plus the voice window in Task 1, checked by hand as well.
- **Decisions in `docs/11`, as this plan builds them:**
  - **D1** is unanswered. The owner wants to test with their own devices, so five local adapters are built. The
    owner's list goes into D1 after the trial.
  - **D2 stays No.** The `alexa-account` adapter is **not built**: no Amazon session, no Echo Dot speech or volume from
    the dashboard, no `echo_say` or `echo_volume`. `echo.speak` is not shown in Permissions while no action uses it.
  - **D3 is unanswered.** The `alexa` connector is built **off**, with two tunnel choices: Tailscale Funnel (the hub runs
    the owner's own `tailscale.exe` when the owner presses) and "a tunnel I run myself" (for example Cloudflare Tunnel).
    Nothing in this plan, no implementer, no check and no script ever opens a tunnel. Only the owner's press of **Turn
    on** or **Open the tunnel** does that.
- **Permission first.**
  - The network is searched only while the owner's Add device wizard or a device's **Look for it again** is running:
    6 seconds at most, never in the background.
  - A found device is not added until the owner ticks it. A newly added home device is **not shared with Mini** until the
    owner turns on "Mini may use this device" on its page, whatever `home.read` and `home.control` say.
  - The `alexa` connector starts off. Its listener exists only while it is on. `voice.alexa.ask`,
    `voice.alexa.private` and every "safe by voice" tick start off. No code, test, script or import writes a grant or a
    tick.
- **Local only for the house.**
  - Every request an adapter makes goes through `lanFetch` / `lanSocket` (Task 2). These accept only an IPv4 literal in
    `10.0.0.0/8`, `172.16.0.0/12` or `192.168.0.0/16`, never a host name, `127.0.0.0/8`, `169.254.0.0/16` or a public
    address.
  - They follow no redirect, time out after 3 s, and read at most 1 MiB.
  - No adapter talks to a maker's cloud. A device that would need one is listed as "cannot be added" with the reason.
- **The internet, for the Alexa route only.** These are the only connections out of the home in this phase:
  - Amazon's requests, through the tunnel, to the listener.
  - The listener fetching Amazon's signing-certificate chain from the URL in the request. That URL must pass the
    `SignatureCertChainUrl` rules below. Redirects are refused, the fetch takes at most 5 s and reads at most 64 KiB,
    and the chain is cached in memory by URL until its first certificate expires (at most 4 entries).
  - The dashboard still loads nothing from the internet.
- **The Alexa check** (exact, in this order; any failure → `400` with an empty JSON body `{}`, one pino line `alexa
  request refused` with `{ why }` (one of the codes in brackets), and no `voice_request` event):
  1. The method is `POST`, the path is `/` or `/alexa`, and the body is at most 65,536 bytes [`shape`].
  2. Both headers `signaturecertchainurl` and `signature-256` are present [`no-signature`].
  3. URL rules, after normalising (remove `.` and `..` segments and duplicate slashes, drop the fragment): scheme `https`
     and host `s3.amazonaws.com`, both case-insensitive; path starts with `/echo.api/`, case-sensitive; a port, if
     given, is `443` [`cert-url`].
  4. Every PEM in the chain parses as `X509Certificate`. Each is within `validFrom`..`validTo` now. Each one
     `checkIssued` and `verify`s against the next. The last one is in `tls.rootCertificates` (same `fingerprint256`) or
     is issued and verified by one of them [`cert-chain`].
  5. The first certificate's `subjectAltName` contains `DNS:echo-api.amazon.com` [`cert-name`].
  6. `crypto.verify('sha256', rawBody, first.publicKey, base64Decode(signature-256))` is true. The `Signature` (SHA-1)
     header is never used [`signature`].
  7. The body parses as JSON. `request.timestamp` is within **150 seconds** of now, either way [`stale`].
  8. `context.System.application.applicationId` (else `session.application.applicationId`) equals the stored skill
     id, compared in constant time [`skill`].
  - Requests that pass are rate-limited to 30 a minute. Above that: `200` with the speech "Too many questions at once.
    Try again in a minute."
- **Voice limits are code, not wording.**
  - The plugin refuses, during a room turn, every tool except `hub_status`, `hub_read`, `hub_act` and `hub_log` called
    by the main agent. That includes Claude Code's own tools and every subagent call. The refusal is the exact text
    **"Not available by voice from the room."** Every `hub_*` call in the turn carries `x-hub-origin: voice`, and Claude
    Code's own questions are answered no without a card.
  - The core treats **every** agent call as voice while a room prompt is open (Task 1's `VoiceTurns`): from the moment
    it is queued until its reply is complete, it fails, or 180 s pass. This holds even without the header.
  - A voice read on **ask** is refused, never asked.
  - A voice read of calls, messages, mail or notifications with `voice.alexa.private` off is refused with the exact text
    in Task 1, never silently emptied.
- **Locks, cameras, alarms and garages always confirm** (`docs/03`, `docs/07` House). A device whose kind is `lock`,
    `camera`, `alarm` or `garage` (the guarded kinds, set by the owner on its page) is changed only through
    `set_guarded`, which is `important`: it always asks Mini's approval, is never run by voice, and its House tile has no
    switch, only **Change…**, which opens a confirmation. `set` refuses such a device. A scene cannot include one.
- **Secrets.**
  - The Hue application key, Shelly and Tasmota passwords, and the Alexa skill id live only in the encrypted `secrets`
    table: `connector_id 'home'` with the names `<endpointId>.key` and `<endpointId>.password`, and `connector_id 'alexa'`
    with the name `skillId`.
  - They are never returned by a route, never put in a device's `info` or `state`, never logged, never audited, never
    exported, and never put in an error.
  - pino's `REDACT` gains `key`, `skillId`, `userId`, `signature`, `query`, `speech`, `reply` and the same names under
    `*.`.
  - No log line holds what was said to the Echo Dot, Mini's reply, a request body, an Amazon user or device id, a
    device's MAC address, or a home device's name. An address and an adapter name are fine.
- **What is stored.** The Echo Dot's words are kept only as a `voice_request` event's `title` (at most 300 characters),
  person only, as `docs/04` says. Mini's spoken reply is kept **in memory only**, for "what did you find", for at most
  10 minutes, and never in the database. `home_state` events are stored only while `home.read`'s Collect is on.
- **Limits** (exact):
  - At most 100 home devices, 30 scenes, and 20 steps per scene. A scene name is 1–40 characters, a device name 1–60.
  - Brightness is 1–100. A colour is `#rrggbb`, lower case.
  - A setup search runs 6 s. Discovery is 6 s, then at most 16 probes at once, each with a 3 s timeout.
  - A room prompt is at most 1,000 characters. One room prompt is open at a time. The spoken reply is at most 900
    characters.
- **Timings** (exact):
  - Polling: each endpoint every **10 s** while a dashboard is connected (`hub.live.listenerCount('topic') > 0`), every
    **60 s** otherwise. At once, and again 1.5 s later, after a set. An endpoint unreachable three times in a row is
    marked unreachable and polled every 60 s.
  - Alexa: the reply is waited for up to **6.0 s** from receipt, polling every 250 ms. A deferred reply is kept 10
    minutes.
  - Tailscale commands time out after 20 s. Hue pairing waits up to 30 s for the button.
- **Words** are plain and short, sentence case, no exclamation marks, no "successfully". Exact strings are given in
  the tasks; where a task gives none, follow `docs/07` > Words.
- **The look:** dashboard parts from `ui/src/components/look/` and tokens from `design/tokens.json`; never edit the
  generated token files by hand. Every tile and screen handles loading, empty, error and "not allowed". Everything new
  works by keyboard, with visible focus, `Esc` closing the top layer, names for screen readers and changes announced.
- **Made-up values only** in code, comments and docs: `192.168.1.20`, `pc-example.tailnet-example.ts.net`,
  `amzn1.ask.skill.00000000-0000-0000-0000-000000000000`, `Bedroom lamp`, `asha@example.com`.
- **Project facts:** Node 24 type stripping in the core (no enums, parameter properties or namespaces; `.ts` imports);
  the plugin's mod loader passes `$` across imports only into function declarations; in Git Bash write files with the
  editor tools (long heredocs fail); `npm run tokens` for tokens.
- **Testing safely** (`docs/10`): any manual run uses a scratch `MINI_HUB_HOME` and a scratch `MINI_BOT_HOME`; no real
  Claude Code session against a test runtime; no Alexa request is made up or replayed; no tunnel is opened by anyone but
  the owner; no device is switched by anyone but the owner.
- **Checks** (run what the task touches; all of them in Task 10):
  `cd /f/mini-hub && npm run check` · `npm test` · `npm run build -w @minihub/ui` ·
  `cd "/f/claude mini-bot" && claude plugin validate . && claude plugin test . && node --test "runtime/test/*.test.mjs"`
  (scratch `MINI_BOT_HOME`).

**Rulings made while planning** (the owner may want to know; each changes a doc in the task named):

- **Five local adapters, chosen for how common they are and how simple they are to speak, with no account and no
  cloud:**
  - **Shelly** (Gen2, Plus, Pro, Gen3 and Gen4). Very common relays and plugs, with a documented local RPC.
  - **Philips Hue Bridge.** The best-known bulbs. The pairing is a press of the bridge's own button, so the owner's hand
    is the consent.
  - **WLED.** The usual firmware for LED strips; one JSON call.
  - **Tasmota.** The usual firmware for re-flashed plugs; HTTP commands.
  - **TP-Link Kasa, older local protocol.** Very common plugs and bulbs.
  - Left out, said plainly:
    - **Matter.** Docs/06 calls it the preferred way, but it needs a whole controller, commissioning and its own
      certificate store (`matter.js`). It comes when D1 says there are Matter devices.
    - **Tuya and Smart Life** (`tuya-local`). Their keys must be fetched from Tuya's cloud with a developer account.
    - **Newer Kasa firmware and Tapo** (the "KLAP" sign-in). It needs the owner's TP-Link account.
    - **Shelly first generation**, **ESPHome** (its native API is a protobuf protocol with its own encryption), **LIFX**
      and **Yeelight**. Each is a later small adapter if the owner has one.
  - Each left-out device the hub can recognise is listed in the wizard as "cannot be added", with the reason (Tasks 3,
    4; `docs/06`, `docs/11` D1).
- **"Mini may use this device"**: a per-device switch, off for every new device, on top of the connector-wide
  `home.read` and `home.control`. Adding a second lamp therefore never hands it to Mini by itself. A scene that includes
  a device not shared with Mini cannot be run by Mini (Task 2; `docs/03`, `docs/06`).
- **Guarded devices are the owner's choice of kind.** None of the five protocols has a real lock, camera or alarm. A
  relay that opens a garage or a door is marked so by the owner ("What is it?" on its page). From then on it is changed
  only through the `important` `set_guarded` and a confirmation on its tile. Risk is fixed per action in code, as
  `docs/03` requires, so this is a second action, not a risk chosen at run time (Task 2; `docs/06`).
- **The Echo Dot is not a House device.** D2 is No, so it cannot be made to speak or change volume from the dashboard.
  It appears in Devices as "Echo Dot", the way into the `alexa` connector's page (Task 9; `docs/07`).
- **Turning the Echo Dot route on is one press with a confirmation.** **Turn on** opens the listener and, for Tailscale,
  runs `tailscale funnel --bg --https=443 --set-path=/alexa http://127.0.0.1:47801`. **Turn off**, **Disconnect
  everything** and removing the Echo Dot run `tailscale funnel --https=443 --set-path=/alexa off` and close the listener.
  The hub never runs `tailscale funnel reset` and never touches another path of the owner's Funnel.
  - If the command fails (Tailscale missing, signed out, Funnel not allowed in the owner's tailnet, Windows refusing),
    the page shows the exact command for the owner to run in their own terminal.
  - At the hub's start, an "on" connector reopens its **listener** (the owner's standing choice) but never opens the
    tunnel. It only reports the tunnel's state (Task 7; `docs/01`, `docs/03`, `docs/11` D3).
- **A tunnel I run myself** (for example Cloudflare Tunnel, which needs a domain): the owner points it at
  `http://127.0.0.1:47801`. Turning off then closes the listener, so the address no longer reaches the hub, and the page
  says to stop their own tunnel too (Task 7; `docs/11` D3).
- **The voice window in the core.** While a room prompt is open, every call with the agent token counts as voice, with
  or without the header. Mini could otherwise run a command that calls the core without the header. A terminal session
  of the owner's that calls the hub tools during those seconds is limited the same way. That is safer, and said in
  `docs/03` (Task 1).
- **During a room turn the plugin refuses all of Claude Code's own tools too** (commands, files, web), not only the
  bot's PC tools listed in `docs/09` E. A voice in the room could otherwise ask for a command that reaches the PC or the
  hub (Task 5; `docs/09`, `docs/03`).
- **Room prompts go only to Mini's own session**, never to a terminal the owner is working in. With Mini's own session
  not running, Alexa says so (Task 5; `docs/09`).
- **The invocation name is "mini"** (Alexa, ask Mini …). Amazon's rules allow a one-word name only for a brand, and
  checks that only at certification, which a skill kept in development never reaches. If the console refuses it, the
  setup says to use "my mini" (Task 6; `docs/06`).
- **No progressive response.** Calling Amazon's progressive-response API would be a second connection out. Past 6 s,
  Alexa says "Mini is working on it. Ask me what it found in a moment." (Task 6).
- **Deferred, said plainly:** Matter, Tuya, Tapo, ESPHome, LIFX; temperature, speed and volume traits (none of the five
  adapters has them in a way worth building now); Hue's live event stream (polling is enough for a few devices);
  answering an Alexa request as a running conversation (each question is one turn).

## Review Focus

1. **RF1 The house stays home:** no adapter request can reach anything but a private IPv4 address. No discovery runs
   unless the owner's wizard or "Look for it again" is running. Nothing goes to a maker's cloud (Tasks 2–4).
2. **RF2 Off means nothing:** an unshared device is invisible to Mini and refused. The Alexa listener does not exist
   while the connector is off. Turning it off closes the listener and the tunnel the hub opened. No code path opens a
   tunnel except the owner's press (Tasks 2, 6, 7).
3. **RF3 The check is the check:** every Alexa request is refused before any parsing that acts, unless all eight steps
   pass. The raw bytes are what is verified. A stale, unsigned, wrongly signed or other-skill request gets `400` and
   nothing else (Task 6).
4. **RF4 Voice is limited in code:** during a room turn no non-`hub_*` tool runs. Every agent call to the core is voice
   while the window is open. Voice never creates an approval, never runs `important` or unticked `act`, and private
   reads are refused with the exact text (Tasks 1, 5, 6).
5. **RF5 Guarded means asked:** a guarded device is never switched by `set`, by a scene or by voice. Its tile always
   confirms. `set_guarded` always asks Mini's approval (Tasks 2, 8).
6. **RF6 Secrets and words stay inside:** application keys, passwords and the skill id are never returned, logged or
   exported. What was said and what Mini answered never reach a log (all tasks).
7. **RF7 The bot elsewhere is unchanged:** outside a room turn, on Android and on a PC without Mini Hub, every hook and
   tool behaves as in 0.10.0, and the existing suites pass (Task 5).
8. **RF8 Unreachable is explained:** every device or endpoint that cannot be reached or added shows one of the exact
   reasons, on the wizard, the tile and the page (Tasks 2–4, 8).

---

### Task 1: Protocol and core groundwork: home shapes, connector switches, voice-safe rows, the voice window

**Files:** create `protocol/src/home.ts`, `core/src/rules/voice.ts`; modify `protocol/src/index.ts`,
`protocol/src/events.ts`, `core/src/connectors/types.ts`, `core/src/connectors/registry.ts`,
`core/src/api/routes/connectors.ts` (Phase 4's), `core/src/api/routes/rules.ts`, `core/src/api/routes/events.ts`,
`core/src/api/server.ts`, `core/src/hub.ts`, `core/src/log.ts`; `docs/04-data-and-sync.md` (Event types: `home_state`,
`voice_request`), `docs/05-hub-api.md` (connector switch routes, grants rows, the voice window, the private-read
refusal), `docs/03-security-and-permissions.md` (A turn started by voice: the core's window, ask refused for voice,
safe by voice only for `act` scopes).

**Interfaces — Produces:**

```ts
// protocol/src/home.ts
export const HOME_KINDS = ['light', 'plug', 'switch', 'fan', 'ac', 'tv', 'speaker', 'sensor', 'lock', 'camera', 'alarm', 'garage', 'other'] as const
export const GUARDED_KINDS = ['lock', 'camera', 'alarm', 'garage'] as const
export const HOME_TRAITS = ['onoff', 'brightness', 'color', 'reading'] as const
export const ADAPTERS = ['shelly', 'hue', 'wled', 'tasmota', 'kasa'] as const
export type HomeKind; export type HomeTrait; export type AdapterId
export const isGuarded = (kind: string): boolean
export const COLOR = /^#[0-9a-f]{6}$/
export const homeChange = z.object({ on: z.boolean().optional(), brightness: z.number().int().min(1).max(100).optional(),
  color: z.string().regex(COLOR).optional() }).strict().refine(c => c.on !== undefined || c.brightness !== undefined || c.color !== undefined, 'Say what to change: on, brightness or color.')
export type HomeChange = z.infer<typeof homeChange>
export const reading = z.object({ name: z.string().max(40), value: z.number(), unit: z.string().max(10) })
export type HomeState = { reachable: boolean; reason?: string; on?: boolean; brightness?: number; color?: string;
  readings?: Array<z.infer<typeof reading>>; at: number }
export const sceneSchema = z.object({ id: z.string().regex(/^s-[0-9a-f]{8}$/), name: z.string().min(1).max(40),
  steps: z.array(z.object({ device: z.string().max(100) }).and(homeChange)).min(1).max(20) })
export type Scene = z.infer<typeof sceneSchema>
// protocol/src/events.ts: EVENT_DATA gains
export const homeStateData = z.looseObject({ property: z.enum(['on', 'brightness', 'color', 'reachable']), value: z.unknown(), cause: z.enum(['pc', 'mini', 'voice', 'outside']) })
export const voiceRequestData = z.looseObject({ intent: z.enum(['ask', 'found', 'launch', 'help', 'other']),
  answered: z.enum(['now', 'later', 'refused', 'failed']), reason: z.string().max(40).optional() })

// core/src/connectors/types.ts
// Field.kind gains 'checks' (several ticks; the answer is the ticked values joined by ','), and a form or show step
// gains `copy?: Array<{ label: string; text: string }>` (blocks the wizard shows with a Copy button).
// Connector gains:  switchable?: { isOn(): boolean; turn(on: boolean): Promise<{ ok: boolean; note?: string }> }

// core/src/rules/voice.ts
export class VoiceTurns { constructor(now?: () => number)
  open(id: string): void          // until close(id) or 180 s
  close(id: string): void
  active(): boolean }
// Hub gains  voice: VoiceTurns
```

Behaviour:

- **Connector switches** (`routes/connectors.ts`): `POST /v1/connectors/:id/enable` and `/disable` (person only,
  `audit: 'connector-on'` / `'connector-off'`). A connector without `switchable` → `404` "This connection has no on and
  off switch." They call `turn(true | false)` and answer `{ on, ok, note? }`; `ok: false` is `200` with its `note`, not
  an error. `GET /v1/connectors` items gain `on` for switchable connectors. `LiveTopic` gains `'home'` and `'voice'`.
- **Grants rows** (`allRows`):
  - A scope that is not collectable, whose kind is `act` or `important`, and that no registered action uses, is left
    out. Today that is `echo.speak`, because D2 is No.
  - Each row gains `voiceAllowed: boolean`: true when the scope's kind is `act` **and** the `alexa` connector has its
    device (it is set up).
  - `PUT /v1/grants/:target/:scope` refuses `voiceSafe: true` for a scope whose kind is not `act` with `400` "Only
    switches that change something can be safe by voice. What voice may read follows Mini may use and Private details in
    spoken answers."
- **The voice window:** `whoIs` in `server.ts` gives `{ kind: 'agent', voice: header === 'voice' || hub.voice.active() }`.
  The audit row's `detail: 'voice'` follows `caller.voice` as today. `VoiceTurns` is in memory only and has no route.
  `stopMini` closes every open turn.
- **Voice reads refused, not emptied** (`routes/events.ts`, `GET /v1/events`, `/v1/events/:id`, `/v1/people`, for a voice
  viewer):
  - A scope on **ask** counts as off.
  - When the query names only private types (`call`, `sms`, `chat`, `notification`, `mail`) and `voice.alexa.private`
    is not on → `403 not-allowed`, scope `voice.alexa.private`, the exact text **"Calls, messages, mail and
    notifications are not read out by voice. The owner can allow it in Mini Hub > Permissions > Private details in
    spoken answers."**
  - With mixed types or no types, the rest is returned and `notAllowed` gains `{ scope: 'voice.alexa.private', label:
    'Private details in spoken answers' }`.
  - `/v1/events/:id` of a private type → the same `403`. `/v1/people` → the same `403`, because its rows are people from
    calls, messages and mail.
- **Redaction:** add the `REDACT` names in Global Constraints to `core/src/log.ts`.
- **docs:**
  - `docs/04` Event types: `home_state` `data_json` per `homeStateData` (title "Bedroom lamp on"); `voice_request`
    `data_json` per `voiceRequestData`, its title is what was asked, at most 300 characters.
  - `docs/05`: the two switch routes, `on` in connectors, `voiceAllowed`, the `voiceSafe` rule, the voice window and the
    private-read refusal.
  - `docs/03` > A turn started by voice: the core's window ("every agent call counts as voice while a question from the
    Echo Dot is open, from the moment it is queued until its answer is complete, it fails, or 3 minutes pass"); ask counts
    as off for voice; ticks only on switches that change something.

Edge cases: two room prompts never overlap (Task 6 keeps one open); `close` of an unknown id is a no-op; a 180 s expiry
needs no timer (`active()` drops expired ones); the existing `api.test.ts` voice test and `rules.test.ts` stay green;
a grants test that pins the whole rows shape is updated only for `voiceAllowed`.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS.

### Task 2: Hub: the `home` connector's frame — adapters, local-only requests, setup, polling, actions, scenes

**Files:** create `core/src/connectors/home/index.ts` (the connector), `lan.ts` (`lanFetch`, `lanSocket`, `lanUdp`,
`isLan`), `adapter.ts` (the adapter contract and reasons), `discover.ts`, `setup.ts`, `poller.ts`, `actions.ts`,
`scenes.ts`, `core/src/api/routes/home.ts`; modify `core/src/hub.ts` (register; `GET /v1/devices` for the agent),
`core/src/api/server.ts` (register the routes), `core/src/api/routes/devices.ts` (PATCH for home devices),
`docs/06-connectors.md` (`home`), `docs/05-hub-api.md` (home routes), `docs/03-security-and-permissions.md` (the
guarded kinds by the owner's choice; "Mini may use this device").

**Interfaces — Consumes:** Task 1's `protocol/src/home.ts`, Phase 4's `setup`, `remove`, `Ctx.secrets`,
`Ctx.settings`, `Ctx.grants`. **Produces:**

```ts
// adapter.ts
export type Found = { adapter: AdapterId; address: string; port?: number; makerId: string; name: string; model?: string;
  needs?: 'password' | 'button'; reason?: Reason }          // reason set: it cannot be added
export type Endpoint = { id: string; adapter: AdapterId; address: string; port?: number; makerId: string; model?: string;
  firmware?: string; pin?: string /* hue cert sha256 */; extra?: Record<string, unknown> }
export type Thing = { key: string; name: string; kind: HomeKind; traits: HomeTrait[]; room?: string }
export type Adapter = {
  id: AdapterId; title: string
  discover?(signal: AbortSignal): Promise<Found[]>                    // 6 s at most
  probe(address: string, signal: AbortSignal): Promise<Found>          // never throws; a failure is a Found with reason
  connect(f: Found, secret: string | undefined, signal: AbortSignal): Promise<{ endpoint: Endpoint; secret?: string; things: Thing[] } | { reason: Reason }>
  read(ep: Endpoint, secret: string | undefined, signal: AbortSignal): Promise<Map<string, Omit<HomeState, 'at'>>>
  set(ep: Endpoint, secret: string | undefined, key: string, change: HomeChange, signal: AbortSignal): Promise<void>
}
export const REASONS: Record<Reason, string>   // the exact lines below
export class HomeFailure extends Error { reason: Reason }
// lan.ts
export const isLan = (address: string): boolean
export function lanFetch(address: string, path: string, init?: { method?: 'GET' | 'POST' | 'PUT'; body?: string | Uint8Array; headers?: Record<string, string>; port?: number; signal?: AbortSignal }): Promise<{ status: number; headers: Headers; text: string }>
export function lanSocket(address: string, port: number, payload: Uint8Array, readFrame: (buf: Buffer) => Buffer | null, signal?: AbortSignal): Promise<Buffer>
export function lanUdp(port: number, payload: Uint8Array, ms: number, signal: AbortSignal): Promise<Array<{ address: string; data: Buffer }>>   // sends to each private interface's broadcast address
// index.ts
export function homeConnector(d: { adapters: Adapter[]; live: () => boolean; tell: () => void }): Connector
// manifest: { id: 'home', name: 'Home device', kind: 'device', icon: 'lamp', scopes: ['home.read', 'home.control'],
//   eventTypes: ['home_state'], widgets: ['home-room', 'home-device', 'home-scenes'], multiple: true }
```

Behaviour:

- **Local only.** `isLan(a)` is true only for a dotted IPv4 literal in `10/8`, `172.16/12` or `192.168/16`.
  `lanFetch` and the other helpers throw `HomeFailure('not-local')` before any socket opens for anything else. They use
  `http://<address>[:port]<path>`, `redirect: 'error'`, a 3 s `AbortSignal.timeout` joined with the caller's signal,
  and stop reading after 1 MiB (`too-large`). Hue's pinned HTTPS is in Task 4 and uses the same address check.
- **Records.**
  - Connector settings: `{ endpoints: { [endpointId]: Endpoint }, shared: { [deviceId]: true }, scenes: Scene[] }`.
    Secrets are named `<endpointId>.key` and `<endpointId>.password`.
  - Endpoint id: `ep-<adapter>-<first 10 hex of sha256(makerId)>`. Device id: `home-<adapter>-<first 10 hex of
    sha256(makerId + '|' + thing.key)>`.
  - A device row: `connectorId 'home'`, `kind` from the thing (the owner may change it), `name` the thing's name, `room`
    the thing's room if the bridge has one; `info: { adapter, endpoint, key, address, model, firmware, traits }` (no MAC,
    no secret); `state: HomeState`.
- **Reasons** (`REASONS`, exact lines shown on the wizard, the tile and the page; `<address>` and `<model>` filled in):

  | Reason | Line |
  |---|---|
  | `unreachable` | "Cannot be reached at `<address>`. Check it is switched on and on the same Wi-Fi as this PC." |
  | `not-local` | "Mini Hub talks only to addresses on your home network, like 192.168.1.20." |
  | `not-this` | "Something answered at `<address>`, but it is not a `<adapter title>`." |
  | `password` | "It asks for a password. Enter the one set in its own web page." |
  | `wrong-password` | "It did not accept that password." |
  | `button` | "Press the round button on top of the Hue Bridge, then press Try again within 30 seconds." |
  | `needs-cloud` | "This model only works through the maker's cloud and your account with them, which Mini Hub does not use. It cannot be added." |
  | `old-model` | "This older model has no local control Mini Hub can use (`<model>`)." |
  | `unsupported` | "Mini Hub does not know this kind of device yet (`<model>`)." |
  | `sleeping` | "It runs on a battery and sleeps between readings, so it cannot be switched from here." |
  | `cert-changed` | "The bridge's certificate changed since it was added, so Mini Hub stopped talking to it. If you replaced the bridge, remove it and add it again." |
  | `too-large` | "It sent back more than Mini Hub reads. It cannot be added." |
  | `failed` | "It did not answer as expected. Try again." |

- **Discovery** (`discover.ts`): runs every adapter's `discover` in parallel under one 6 s signal, removes duplicates by
  `adapter|makerId`, drops anything not `isLan`, then `probe`s each, at most 16 at once. Tasmota has no discovery.
  mDNS uses one `new Bonjour()` per run (`find({ type })`, then `destroy()` at the end, always). It runs only from the
  setup step and the "look again" route.
- **Setup steps** (`setup.ts`, Phase 4's form, show and done; exact words):
  1. `step: null` with `input.endpoint` = a known endpoint → straight to its `password` step (or `button` for Hue), and
     on success only its secret is replaced. Otherwise form `how`, title "Add a home device", text "Mini Hub talks to these on your home network only:
     Shelly, Philips Hue Bridge, WLED, Tasmota and TP-Link Kasa (older models). Nothing goes through a maker's cloud.",
     field `how` choice `look` "Look on my network" / `address` "I know its address".
  2. `how: look` → discovery → form `found`. Its text lists, one per line, everything found that **cannot** be added:
     "`<name>` (`<model>`, `<address>`): `<reason line>`". Its field `pick` is a `choice` of the addable ones
     "`<name>` · `<model>` · `<address>`" (already-added endpoints left out). No addable one → text "Nothing new was
     found. Some devices do not announce themselves (Tasmota never does). Add one by its address instead." with `how`
     again. `how: address` → form `address` with `adapter` choice (the five titles) and `address` text, hint "Its
     address on your home network, like 192.168.1.20. Your router's list of devices shows it."
  3. A pick or an address → `probe`. With `needs: 'password'` → form `password` (one `password` field, text the
     `password` line). With `needs: 'button'` → show `button` (the `button` line), with Next = "Try again". `connect`
     failing with `wrong-password` or `button` → the same step with `error`. Other reasons → form `address` with
     `error`.
  4. Connected → form `things`, title "Choose what to add", text "Each one starts not shared with Mini. You can share
     it on its page.", field `add` of kind `checks` with every thing (`<name> (<kind>)`), **none ticked**. Submitting
     with none → the same step with `error` "Tick at least one.".
  5. Done → the endpoint and its secret saved, one device per ticked thing upserted (first state read at once), and
     `{ kind: 'done', devices }`. Adding an endpoint already known by `makerId` updates its address and adds the newly
     ticked things.
- **Polling** (`poller.ts`):
  - One loop per endpoint with at least one device, at the Global Constraints' timings. `read` gives state per key, and
    each device's `state` is replaced with `{ ...read, at: now }` only when something changed.
  - Then `d.tell()` (live topic `home`) and, while `ctx.grants.collecting('home', 'home.read')`, one `home_state` event
    per changed property among `on`, `brightness`, `color`, `reachable`. The event's `title` is "`<name>` on", "`<name>`
    off", "`<name>` `<n>`%", "`<name>` colour changed", "`<name>` cannot be reached" or "`<name>` is back"; its `data`
    is `{ property, value, cause }`.
  - `cause` is `pc` within 5 s after a person's set, `mini` or `voice` after an agent's (`how.origin` plus the voice
    window), else `outside`. Readings change only `state`, never events.
  - A failure sets every device of the endpoint to `{ reachable: false, reason }` on the third failure in a row.
  - `stop()` and `ctx.signal` end every loop.
- **Actions** (`actions.ts`; `device` is in `args` because the scopes are connector-wide; every `describe` uses the
  device's name):

  | Name | Args | Risk / scope | Does |
  |---|---|---|---|
  | `list` | `{ room?: string (max 60) }` | read / `home.read` | `{ items: [{ id, name, room, kind, guarded, traits, state }], scenes: [{ id, name }] }`: devices shared with Mini (for the person, all) |
  | `get` | `{ device }` | read / `home.read` | reads its endpoint now, returns the one item |
  | `set` | `{ device } & homeChange` | act / `home.control` | the adapter's `set`, then a read; refuses a guarded device: "`<name>` is marked as a `<kind>`, so it is changed only with set_guarded, which always asks the owner." |
  | `set_guarded` | the same | important / `home.control` | the same, only for a guarded device; else "Use set for `<name>`." |
  | `scene` | `{ scene: string }` | act / `home.control` | each step in order, then reads; `{ done: n, failed: [{ device, reason }] }` |

  - `describe`:
    - `set`: "Turn `<name>` on" / "Turn `<name>` off", plus " at `<n>`%" when brightness is given, and " in colour
      `<#rrggbb>`".
    - `set_guarded`: "Switch `<name>` `<on|off>`? It is marked as a `<kind>`, so this always asks." (with the brightness
      and colour parts when given).
    - `scene`: "Run the scene `<name>`: `<n>` devices".
  - **For the agent** (`how.origin === 'agent'`): a device not in `shared` → `ApiFailure(403, 'not-allowed', "<name> is
    not shared with Mini. The owner can share it on its page in Mini Hub.", 'home.control')`. A scene with an unshared
    device → "The scene `<name>` includes devices not shared with Mini.". `list` and `get` show shared devices only. An
    unknown device id → `404` "There is no such home device."
  - A device that cannot be reached → the action fails with its reason line.
  - The trait must exist: brightness on a plug → `400` "`<name>` has no brightness."
- **Scenes** (`scenes.ts`, through `routes/home.ts`, person only, `audit: 'scene'`): `PUT /v1/home/scenes/:id` (create
  or replace; `sceneSchema`; at most 30), `DELETE /v1/home/scenes/:id`. A step on a guarded device → `400` "A scene
  cannot include a lock, a camera, an alarm or a garage." An unknown device → `400` "That device is not in Mini Hub." A
  removed device is dropped from every scene.
- **Home routes** (`routes/home.ts`):
  - `GET /v1/home` (person): `{ devices: [{ id, name, room, kind, guarded, traits, shared, state, endpoint: { id,
    adapter, address, model, firmware } }], rooms: string[] (sorted; "No room" last), scenes }`.
  - `PATCH /v1/home/devices/:id` (person, `audit: 'home-device'`): `{ kind?: HomeKind, shared?: boolean }`. Changing
    to a guarded kind drops the device from every scene and says so in the answer, `{ …, note: 'Removed from 2
    scenes.' }`.
  - `POST /v1/home/devices/:id/find` (person): runs discovery once for that adapter (6 s), matches by `makerId`, updates
    the endpoint's address, answers `{ found: boolean, address? }`.
  - Rename and room stay `PATCH /v1/devices/:id`.
- **Removing** (`remove(deviceId)`): drops the device from `shared` and scenes. When it was the endpoint's last device,
  it drops the endpoint and deletes its secrets.
- **The agent's `GET /v1/devices`** leaves out home devices not shared with Mini.
- **docs:**
  - `docs/06` > `home`: the five adapters as built (the table replaces `matter`, `tuya-local`, `kasa, hue, others` with
    what was built and what was left out and why); local only; discovery only on the owner's press; "Mini may use this
    device"; `set_guarded`; scenes and their limits; the reasons table; `alexa-account` not built (D2 No); `echo_say`
    and `echo_volume` struck.
  - `docs/05`: the home routes.
  - `docs/03`: the guarded kinds are the owner's choice on a device's page, and a per-device share sits on top of the
    connector-wide switches.

Edge cases: a device's address changes (DHCP) → unreachable, and "Look for it again" finds it by `makerId`; an endpoint
with two devices (a two-channel relay) is read once per round; a set while a read is running waits for it (one promise
chain per endpoint); 100 devices → the wizard's `done` refuses the 101st with "Mini Hub holds 100 home devices at
most."; the Stop button does not stop polling (the record keeps working) but agent actions are refused by the core
already; `home.read` Collect off → no events, state still shown to the owner.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS (the connector starts with no endpoints and polls nothing).

### Task 3: Hub: the Shelly, WLED and Tasmota adapters (plain HTTP)

**Files:** create `core/src/connectors/home/adapters/shelly.ts`, `wled.ts`, `tasmota.ts`, `color.ts` (hex ↔ rgb ↔
hsb); modify `core/src/connectors/home/index.ts` (the adapter list), `docs/06-connectors.md` (each adapter's line).

**Interfaces — Consumes:** Task 2's `Adapter`, `lanFetch`, `REASONS`, `HomeFailure`. **Produces:** `shellyAdapter`,
`wledAdapter`, `tasmotaAdapter` (each an `Adapter`).

Behaviour:

- **Shelly** (Gen2 and later, "Shelly"):
  - Discovery: mDNS `_shelly._tcp`. Probe: `GET /shelly`. With `gen >= 2` → `makerId` = `id`, `model` = `model`,
    `name` = `name ?? app`, and `needs: 'password'` when `auth_en`. Without `gen` (Gen1) → `old-model`. Anything else →
    `not-this`.
  - Calls: `GET /rpc/<Method>?<params>`.
  - **Password:** digest auth (RFC 7616, SHA-256), user `admin`. On `401`, read `WWW-Authenticate` (`realm`, `nonce`).
    The answer is `sha256hex(HA1:nonce:00000001:cnonce:auth:HA2)` with `HA1 = sha256hex("admin:" + realm + ":" +
    password)`, `HA2 = sha256hex(method + ":" + uri)`, and `cnonce` 16 random hex. Send `Authorization: Digest
    username="admin", realm="…", nonce="…", uri="…", algorithm=SHA-256, response="…", qop=auth, nc=00000001,
    cnonce="…"` once; a second `401` → `wrong-password`.
  - **Things:** from `GET /rpc/Shelly.GetStatus` and `Shelly.GetConfig`, one thing per component:
    - `switch:N` → kind `plug` when the model id contains `PLUG`, else `switch`; traits `onoff`, plus `reading` when
      `apower` is present. Name: the component's config `name`, else "`<device name>` `<N+1>`".
    - `light:N` → `light`, `onoff`, `brightness`.
    - `rgb:N` / `rgbw:N` → `light`, `onoff`, `brightness`, `color`.
    - `temperature:N`, `humidity:N`, `pm1:N` → `sensor`, `reading`.
    - With `devicepower:0` in the status (a battery device) → `sleeping`. `cover:N` → `unsupported` "(blinds and
      covers)".
  - Read: one `Shelly.GetStatus`. `output` → `on`, `brightness`, `rgb` → `color`. Readings: `apower` "Power" W,
    `temperature.tC` / `tC` "Temperature" °C, `rh` "Humidity" %.
  - Set: `Switch.Set?id=N&on=true|false`, `Light.Set?id=N&on=…&brightness=…`, `RGB.Set?id=N&on=…&brightness=…&rgb=[r,g,b]`
    (`RGBW.Set` likewise).
- **WLED:**
  - Discovery: mDNS `_wled._tcp`. Probe: `GET /json/info`, which must have `ver` and `leds` (else `not-this`);
    `makerId` = `mac`, `name` = `name`, `model` = "WLED `<ver>`".
  - One thing: `light`, `onoff`, `brightness`, `color`.
  - Read: `GET /json/state` → `on`, `bri` 0–255 → brightness `max(1, round(bri / 255 * 100))`, `seg[0].col[0]` → colour.
  - Set: `POST /json/state` `{ on?, bri?: round(b / 100 * 255), seg?: [{ id: 0, col: [[r, g, b]] }] }` with
    `content-type: application/json`.
- **Tasmota** (no discovery; added by address):
  - Probe: `GET /cm?cmnd=Status%200`. The JSON `{ WARNING: … }` asking for a user → `needs: 'password'`. Must have
    `Status` (else `not-this`). `makerId` = `StatusNET.Mac`, `name` = `Status.DeviceName ?? Status.FriendlyName[0]`,
    `model` = "Tasmota `<StatusFWR.Version>`". With a password, every call adds `&user=admin&password=<url-encoded>`.
  - Things: one per `POWER`, `POWER1`…`POWER8` key in `StatusSTS`. Kind `light` when `Dimmer` exists and it is the only
    relay, else `plug`. Traits `onoff`, plus `brightness` with `Dimmer`, plus `color` with `HSBColor`, plus `reading`
    when `StatusSNS.ENERGY.Power` or any `*.Temperature` exists. Names from `FriendlyName[i]`.
  - Read: `Status 0` again, giving `on` (`"ON"`), `Dimmer`, `Color`, and readings (Power W, Temperature with
    `StatusSNS.TempUnit`, Humidity %).
  - Set: `cmnd=Power<n> On|Off`, `cmnd=Dimmer <n>`, `cmnd=Color <#rrggbb>`, each URL-encoded, one request per part.
- Every adapter maps network errors to `unreachable`, a body it cannot parse to `failed`, and `not-local` from `lanFetch`
  as is.
- **docs/06:** one line each, how it is found, what it controls, and what it cannot do.

Edge cases: a Shelly Pro with four switches gives four things; a Shelly whose password is changed later → reads fail
with `wrong-password` on the device page (the page offers "Enter the password again", Task 8); WLED off with `bri` 0
→ `on: false`, brightness unchanged; a Tasmota with no relays (a sensor only) → kind `sensor`, `reading`; a Tasmota
`Status 0` larger than 1 MiB is impossible but would be `too-large`.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS.

### Task 4: Hub: the Philips Hue Bridge and TP-Link Kasa adapters

**Files:** create `core/src/connectors/home/adapters/hue.ts`, `hue-tls.ts` (the pinned HTTPS request), `kasa.ts`;
modify `core/src/connectors/home/index.ts`, `core/src/connectors/home/adapters/color.ts` (rgb ↔ CIE xy),
`docs/06-connectors.md`.

**Interfaces — Consumes:** Task 2's `Adapter`, `isLan`, `lanSocket`, `lanUdp`. **Produces:** `hueAdapter`,
`kasaAdapter`;
`pinnedRequest(address: string, pin: string | null, method, path, headers, body?): Promise<{ status: number; text: string; fingerprint: string; cn: string }>`.

Behaviour:

- **The pinned request** (`hue-tls.ts`):
  - Refuse unless `isLan(address)`. Open `tls.connect({ host: address, port: 443, rejectUnauthorized: false, timeout:
    3000 })`.
  - On `secureConnect`, read `getPeerCertificate()`. When `pin` is given and its `fingerprint256` differs, `destroy()`
    and fail `cert-changed`. This happens **before** any byte of the request is written.
  - Then `http.request({ method, path, headers, createConnection: () => socket })`, the response read to at most 1 MiB.
  - It returns the certificate's `fingerprint256` and subject `CN` so pairing can pin them.
- **Hue** ("Philips Hue Bridge"):
  - Discovery: mDNS `_hue._tcp`. Probe: `pinnedRequest(addr, null, 'GET', '/api/0/config')` must give `bridgeid` and
    `swversion` (else `not-this`). A bridge whose `modelid` is `BSB001` (the round first bridge) or whose `apiversion`
    is below `1.46.0` → `old-model`. Otherwise `makerId` = `bridgeid` lower case, `name` = `name`, `needs: 'button'`.
  - Connect: `POST /api` `{"devicetype":"mini_hub#pc","generateclientkey":true}`. `[{ error: { type: 101 } }]` →
    `button`. `[{ success: { username } }]` → the secret is `username`, and the endpoint's `pin` is the certificate's
    `fingerprint256` of that same connection. The certificate's CN must equal `bridgeid` (any case), else `not-this`.
  - Things: `GET /clip/v2/resource/light` and `/clip/v2/resource/room`, with header `hue-application-key`. One thing per
    light: key = its `id`, name = `metadata.name`, room = the room whose `children` hold the light's `owner.rid`, kind
    `light`, traits `onoff` plus `brightness` with `dimming` plus `color` with `color`.
  - Read: `GET /clip/v2/resource/light` → `on.on`, `dimming.brightness` (rounded, at least 1), `color.xy` → hex. A
    light's `status` of `connectivity_issue`, from `GET /clip/v2/resource/zigbee_connectivity`, → `{ reachable: false,
    reason: 'unreachable' }` for that light only.
  - Set: `PUT /clip/v2/resource/light/<id>` `{ on: { on }, dimming: { brightness }, color: { xy: { x, y } } }` with only
    the given parts.
  - Every request uses the stored `pin`. The bridge's own gamut clamps colours.
- **Colour (`color.ts`):** hex → xy by sRGB gamma expansion (`c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92`),
  then X = 0.4124r + 0.3576g + 0.1805b, Y = 0.2126r + 0.7152g + 0.0722b, Z = 0.0193r + 0.1192g + 0.9505b, and
  x = X/(X+Y+Z), y = Y/(X+Y+Z) (black → 0.3127, 0.3290). xy → hex by the inverse at Y = 1, normalised so the largest
  channel is 1. Four decimals for xy.
- **Kasa** ("TP-Link Kasa (older models)"):
  - The cipher: key starts at 171; encrypt each byte `c = key ^ b; key = c`; decrypt `p = key ^ c; key = c`. TCP frames
    start with a 4-byte big-endian length; UDP has none.
  - Discovery: `lanUdp(9999, encrypt('{"system":{"get_sysinfo":{}}}'), 3000, signal)`; each answer that decrypts to
    JSON with `system.get_sysinfo` is a found device.
  - Probe: the same over TCP 9999 (`lanSocket`). A refused connection on 9999, with `lanFetch(addr, '/')` answering on
    port 80 → `needs-cloud` (newer firmware, Tapo). Neither answers → `unreachable`.
  - From `get_sysinfo`: `makerId` = `deviceId`, `name` = `alias`, `model` = `model`.
  - Things:
    - `children` (power strips) → one `plug` per child (key = child `id`, name = child `alias`).
    - Otherwise `mic_type`/`type` containing `SMARTBULB` → `light` (`brightness` when `is_dimmable`, `color` when
      `is_color`). A model starting `HS2` or `KS2` → `switch` (with `brightness` when `brightness` is in sysinfo).
      Otherwise a `plug`.
    - `reading` when `feature` contains `ENE`.
  - Read:
    - `get_sysinfo` gives `relay_state` / children `state` / `light_state.on_off`, brightness, and `hue`/`saturation`
      → hex (HSV with value 100).
    - With `ENE`, also `{"emeter":{"get_realtime":{}}}` → "Power" W, from `power_mw / 1000` or `power`.
  - Set:
    - Plug: `{"system":{"set_relay_state":{"state":1|0}}}`; a child adds `"context":{"child_ids":["<id>"]}`.
    - Dimmer switch: `{"smartlife.iot.dimmer":{"set_brightness":{"brightness":n}}}`.
    - Bulb: `{"smartlife.iot.smartbulb.lightingservice":{"transition_light_state":{"on_off":1|0,"brightness":n,"hue":h,"saturation":s,"color_temp":0}}}`
      with only the given parts.
    - A reply with `err_code` ≠ 0 → `failed`.
- **docs/06:** Hue is paired with the bridge's button and its certificate pinned; Kasa covers the older local protocol
  only, and newer firmware and Tapo are listed as "cannot be added" with the reason.

Edge cases: a Hue bridge whose certificate changes (a factory reset) → `cert-changed` on every device, and nothing is
sent; 30 Hue lights → `things` lists 30, none ticked; a Kasa answer split across TCP packets is read to its length (at
most 65,536 bytes); a UDP answer from a public address is dropped; Windows asks the owner whether Mini Hub may use
private networks the first time mDNS or UDP binds. That is the owner's answer, and without it discovery finds nothing
and adding by address still works.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS.

### Task 5: Mini Bot 0.11.0: room prompts and the limits of a room turn (change E)

**Repository:** `F:\claude mini-bot` (the owner commits it). **Files:** modify `runtime/lib/prompts.mjs`,
`runtime/lib/runtime.mjs`, `hooks/lib/bridge.ts`, `hooks/lib/hub.ts` (Phase 4's), `hooks/register.ts`,
`hooks/lib/types.ts` (`QueuedPrompt.source` gains `'room'`), `.claude-plugin/plugin.json` (`"version": "0.11.0"`),
`README.md` ("Through the Echo Dot": what a room turn may and may not do); `runtime/test/runtime.test.mjs` only if it pins
the list of sources (update minimally); in `F:\mini-hub`: `docs/09-mini-bot-changes.md` (E as built).

**Interfaces — Produces:**

```js
// runtime/lib/runtime.mjs
//   POST /v1/prompts { text, source: 'room' }   (token) -> { id, state }; 503 when Mini's own session is not there
//   POST /v1/prompts/reply { id }               (token) -> { id, text, partial, isError } | 404 { error: 'No such question.' }
//   VERSION raised by one from what Phase 5 left (expected 9); the hub's ROOM_RUNTIME_VERSION (Task 6) is the new number
```
```ts
// hooks/lib/bridge.ts
export function isRoomTurn(): boolean
// hooks/lib/hub.ts:  serveHub($, tool, input, signal, origin?: 'voice')  — adds header x-hub-origin: voice when given
```

Behaviour:

- **Runtime, queue** (`prompts.mjs`):
  - `enqueue` keeps `source: 'room'` (beside `voice` and `routine`, and `hub` if Phase 4 added it). A room prompt has no
    attachments and is at most 1,000 characters (`413` "A question from the room is 1,000 characters at most.").
  - With no live `main` bridge and `canWait()` false → `503` "Mini's own session is not running, so the Echo Dot cannot
    ask it."
  - `claim(bridge)`: room items are handed **only** to a bridge with `role: 'main'`, whatever `target()` is. The other
    items go to the target as today, and the order is kept within each group. A terminal target never receives a room
    item.
- **Runtime, replies** (`runtime.mjs`):
  - It keeps the ids of room prompts it queued (at most 10, each for 10 minutes).
  - In `POST /v1/activity`, a `preview` whose `id` is a room prompt is stored as that prompt's reply (`text`,
    `partial`, `isError`). The activity the overlay sees has `preview: null` and `detail: 'Answering the Echo Dot'`.
    The overlay therefore neither shows nor speaks a room reply and does not open its panel, and the C# overlay does
    not change.
  - `POST /v1/prompts/reply` serves the stored reply. The enqueue's `activity.set` for a room prompt uses the detail "A
    question from the Echo Dot".
- **Bridge** (`bridge.ts`):
  - `submitPrompt` for a room prompt adds the note (exact) **"(Spoken to the Echo Dot by someone in the room, who may
    not be the owner. Answer in one or two short spoken sentences, in plain words, with no lists, links or formatting.
    You can use only the hub tools, and only for what the owner allows by voice; say plainly when something is not
    available by voice. Never ask for or accept an approval by voice.)"** in place of the persona and spoken notes.
  - It sets `roomOpen = prompt.id` **before** `$.prompt.submit`. `isRoomTurn()` is true from then until the main turn
    that carries that prompt ends (`turnEnded` for the main agent after it began), or the submit fails, or
    `session.end`.
  - Fail closed: a turn already running when the room prompt is submitted is limited for the rest of it.
- **Hooks** (`register.ts`, before every other branch in `tool.call`, PC and Android alike):
  - While `isRoomTurn()`: `hubTool(e.tool)` with no `agentId` → `serveHub(…, 'voice')`; **anything else**, including
    `Bash`, `Read`, `Write`, `Edit`, `WebFetch`, `WebSearch`, `Task`, other MCP tools and every subagent call →
    `{ deny: 'Not available by voice from the room.' }`.
  - `classic.PermissionRequest` during a room turn → `{ decision: { behavior: 'deny', message: 'Not available by voice
    from the room.' } }`, and no card.
  - `turn.complete` still calls `endControl` as today.
  - Outside a room turn nothing changes (RF7).
- **docs/09 E (this task):** as built: the runtime's two routes and `VERSION`; room prompts claimed by Mini's own session
  only; replies kept off the bot's panel and served to the hub; every non-hub tool refused during a room turn (wider
  than the list it had), Claude Code's questions answered no; the note's exact words; plugin 0.11.0; "Tests: none added
  (the owner's rule); the existing suites stay green."

Edge cases: the owner types to the bot while a room prompt waits → their prompt queues behind it; the room turn is
limited and theirs is not, because `roomOpen` clears at the room turn's end (if theirs was already running, it is
limited, as above); Claude Code refuses the submit → `roomOpen` clears and the activity reports the error, which the hub
reads as a failed reply; a room prompt in a session that has no hub tools (Mini Hub not installed) → every tool
refused, Mini answers in words only; **RF7** Android's phone branches stay as 0.10.0 outside a room turn; `$` only into
function declarations.

- [ ] Implement.
- [ ] Run `claude plugin validate .`, `claude plugin test .` and `node --test "runtime/test/*.test.mjs"` with a scratch
  `MINI_BOT_HOME` — Expected: PASS.
- [ ] By hand, with a scratch `MINI_BOT_HOME`, no Claude Code session and hotkeys off: start `node runtime/server.mjs
  --serve`, `POST /v1/prompts { text: 'x', source: 'room' }` with the token → `503` (no main session); stop the runtime.
  No room prompt is put into a real session.

### Task 6: Hub: the `alexa` connector — the checked route, the skill's setup, room prompts, spoken answers

**Files:** create `core/src/connectors/alexa/index.ts` (the connector), `listener.ts` (the HTTP listener), `verify.ts`
(the check), `skill.ts` (the interaction model and the setup steps), `speech.ts` (reply → speech), `tunnel.ts` (the
`Tunnel` type and the "own" tunnel; Task 7 adds Tailscale); modify `core/src/connectors/mini.ts` (`askRoom`,
`roomReply`), `core/src/hub.ts` (register; `hub.voice` given to it), `core/src/api/routes/rules.ts` (`POST
/v1/disconnect` turns alexa off), `docs/06-connectors.md` (`alexa`), `docs/01-architecture.md` (the Alexa route's port
47801), `docs/10-build-plan.md` (Testing safely > The Alexa route).

**Interfaces — Consumes:** Task 1's `VoiceTurns`, `switchable`, `copy` and `voiceRequestData`; Task 5's runtime routes.
**Produces:**

```ts
export const ALEXA_PORT = 47801
export const ROOM_RUNTIME_VERSION: number            // Task 5's new runtime VERSION
export type TunnelStatus = { kind: 'tailscale' | 'own'; state: 'open' | 'closed' | 'unknown' | 'missing'; address?: string; note?: string; command?: string }
export type Tunnel = { status(): Promise<TunnelStatus>; open(): Promise<TunnelStatus>; close(): Promise<TunnelStatus> }
export function verifyAlexa(raw: Buffer, headers: IncomingHttpHeaders, skillId: string, now: number, fetchChain: (url: string) => Promise<string>): Promise<{ ok: true; body: AlexaRequest } | { ok: false; why: string }>
export function alexaConnector(d: { mini: MiniLink; voice: VoiceTurns; grants: Grants; stop: StopState; tunnels: { own: Tunnel; tailscale: Tunnel }; tell: () => void }): Connector
// manifest: { id: 'alexa', name: 'Echo Dot (Alexa)', kind: 'service', icon: 'speaker', scopes: ['voice.alexa.ask', 'voice.alexa.private'],
//   eventTypes: ['voice_request'], widgets: ['voice-requests'], multiple: false }
// MiniLink gains: askRoom(text: string): Promise<string>; roomReply(id: string): Promise<{ text: string; partial: boolean; isError: boolean } | null>
// connector settings: { on: boolean, tunnel: 'tailscale' | 'own', publicUrl?: string }; secret 'skillId'
// device: { id: 'alexa-echo', connectorId: 'alexa', kind: 'speaker', name: 'Echo Dot', info: { tunnel, publicUrl?, invocation: 'mini' } }
```

Behaviour:

- **Switch** (`switchable`):
  - `turn(true)` needs the device and skill id (else `{ ok: false, note: 'Set up the Echo Dot first.' }`). It starts the
    listener (a port in use → `{ ok: false, note: 'Port 47801 is in use by another program, so the Echo Dot route
    cannot open.' }`), saves `on: true`, then for Tailscale runs `tunnels.tailscale.open()` and puts its note in the
    answer.
  - `turn(false)` closes the tunnel (Tailscale), closes the listener (`server.close()` plus
    `closeAllConnections()`), saves `on: false`, and closes the voice window.
  - `start(ctx)` with `on: true` reopens the **listener only** and reads the tunnel's status. `stop()` closes the
    listener and leaves the tunnel to the owner.
  - Health: `off` "Off."; `ok` "On. Amazon can reach it."; `degraded` "On, but the tunnel is closed, so Amazon cannot
    reach it." / "On, with your own tunnel."; `down` with the port note.
- **The listener** (`listener.ts`): `http.createServer` on `127.0.0.1:47801` only.
  - Header timeout 10 s, request timeout 15 s. The raw body is read as bytes up to 65,536 (more → `413 {}`).
  - `GET /` and `GET /alexa` → `405` text "Mini Hub's Echo Dot route. It answers only Amazon's signed requests." Any
    other path or method → `404 {}`.
  - `POST` → `verifyAlexa` (Global Constraints, in that order) → a refusal is `400 {}` and the one log line.
  - The chain is fetched with `fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })`, at most 64 KiB,
    and cached as Global Constraints say.
- **Handling a verified request** (`index.ts`; every answer is `200` JSON `{ version: '1.0', response: { outputSpeech: {
  type: 'PlainText', text }, shouldEndSession } }`; every one except `SessionEndedRequest` writes one `voice_request`
  event from the hub device, `title` what was asked, else the intent's name in words):
  - `LaunchRequest` → "Mini is listening. What would you like to ask?" with `shouldEndSession: false` and the same
    reprompt (`intent 'launch'`).
  - `SessionEndedRequest` → `{ version: '1.0', response: {} }`, no event.
  - `AMAZON.HelpIntent` → "Say: ask Mini, then your question. For a long answer, ask Mini what it found." Stop, Cancel
    and NavigateHome → "Bye." Fallback → "I did not catch that. Say: ask Mini, then your question." (`intent 'help'` /
    `'other'`).
  - `AskIntent` with the `query` slot's value (empty → the fallback line):
    1. Mini is stopped (`stop.stopped`) → "Mini is stopped. The owner can resume it in Mini Hub." (`refused`, reason
       `stopped`).
    2. `voice.alexa.ask` not `on` → "Asking Mini through the Echo Dot is switched off in Mini Hub." (`refused`,
       `switched-off`).
    3. A room question is already open → "Mini is still answering the last question. Ask me what it found in a moment."
       (`refused`, `busy`).
    4. The runtime missing or older than `ROOM_RUNTIME_VERSION` (`GET /v1/health`) → "Mini Bot needs updating before
       the Echo Dot can ask it." (`failed`).
    5. `askRoom(text)` with the text **`Asked through the Echo Dot: "<query, at most 1,000 characters>"`** → `id`; a
       `503` → "Mini's own session is not running on the PC right now." (`failed`).
    6. `voice.open(id)`, then `roomReply(id)` every 250 ms until it is complete or 6.0 s have passed since the request
       arrived. Complete → `toSpeech(text)`, `voice.close(id)` (`now`). Not complete → "Mini is working on it. Ask me what
       it found in a moment." (`later`). The prompt id is kept as `waiting` (one slot) and followed every second in the
       background until complete (then `voice.close(id)`) or 180 s (`voice.close(id)`, and the reply becomes "Mini did
       not finish that answer.").
  - `FoundIntent` → `waiting` complete → its speech, and the slot is cleared (`now`, intent `found`); still being
    written → "Mini is still working on it. Ask me again in a moment." (`later`); nothing → "There is nothing waiting
    from Mini." A reply older than 10 minutes is dropped.
  - `isError` replies → "Mini could not answer that. Try again in a moment."
- **`toSpeech`** (`speech.ts`):
  - Drop fenced code blocks; `[text](url)` → text; a bare URL → "a link".
  - Remove `*`, `_`, `` ` ``, `#` and `>` at line starts; bullets and numbered list markers → sentences joined by ". ".
  - Collapse whitespace. Cut at the last sentence end before 900 characters (else at 900).
  - Empty → "Mini had nothing to say."
- **The skill and setup** (`skill.ts`; steps through Phase 4's setup route; the skill id is held in the session until
  done):
  1. `step: null` → confirm `intro`, title "Talk to Mini through your Echo Dot", text: "You make an Alexa skill of your
     own, kept in development so only Echo devices on your Amazon account can use it. Amazon reaches this PC through a
     tunnel that publishes one address, which answers only Amazon's signed requests. It stays off until you turn it
     on." With the device already set up, it starts at step 2 with the current values.
  2. Form `tunnel`, field `tunnel` choice: `tailscale` "Tailscale Funnel (free; Mini Hub opens and closes it when you
     press)" / `own` "A tunnel I run myself (for example Cloudflare Tunnel)". For `own`: a field `publicUrl`, "Its public
     address", which must match `^https://[A-Za-z0-9.-]{1,253}(/[A-Za-z0-9._~/-]{0,200})?$` ("Use the https address your
     tunnel gives you.").
  3. Show `skill`, title "Make the skill in Amazon's developer console". The text, one step per line:
     - "1. Sign in at developer.amazon.com with the Amazon account your Echo Dot uses, and open the Alexa Developer
       Console."
     - "2. Create a skill: name Mini, the language your Echo Dot uses, the Custom model, Provision your own, Start from
       scratch."
     - "3. In Build > Interaction Model > JSON Editor, paste the model below and Save, then Build."
     - "4. In Build > Endpoint choose HTTPS, paste the address below as the Default Region, and choose: My development
       endpoint has a certificate from a trusted certificate authority. Save."
     - "5. In Test, set Skill testing to Development."
     - "6. Copy the Skill ID (Build > Endpoint, or the skill list) for the next step."
     - "If the console refuses the name mini, change invocationName to my mini and say: Alexa, ask my Mini."

     `copy`: "Interaction model" with the JSON below; "Endpoint address":
     - Tailscale: `https://<Self.DNSName without its trailing dot>/alexa` from Task 7's `status()`, else
       "https://<this PC's name>.<your tailnet>.ts.net/alexa" with a note to install Tailscale first.
     - Own: `<publicUrl>`, and a note "Point your tunnel at http://127.0.0.1:47801."
  4. Form `skillId`: one field "Skill ID", which must match `^amzn1\.ask\.skill\.[0-9a-f-]{36}$` ("A skill id looks like
     amzn1.ask.skill. followed by 36 letters, numbers and dashes.").
  5. Done → device `alexa-echo` upserted, settings saved with `on` unchanged (false for a new one), the secret saved, `{
     kind: 'done', devices: ['alexa-echo'] }`. The connector is still **off**.

  The interaction model (exact):

  ```json
  {
    "interactionModel": {
      "languageModel": {
        "invocationName": "mini",
        "intents": [
          { "name": "AskIntent", "slots": [{ "name": "query", "type": "AMAZON.SearchQuery" }],
            "samples": ["whether {query}", "if {query}", "to {query}", "about {query}", "for {query}", "what {query}",
              "who {query}", "when {query}", "how {query}", "why {query}", "where {query}", "tell me {query}",
              "can you {query}", "please {query}"] },
          { "name": "FoundIntent", "slots": [],
            "samples": ["what did you find", "what you found", "what it found", "what have you found", "what did it find",
              "did you find anything"] },
          { "name": "AMAZON.HelpIntent", "samples": [] },
          { "name": "AMAZON.StopIntent", "samples": [] },
          { "name": "AMAZON.CancelIntent", "samples": [] },
          { "name": "AMAZON.FallbackIntent", "samples": [] },
          { "name": "AMAZON.NavigateHomeIntent", "samples": [] }
        ],
        "types": []
      }
    }
  }
  ```

- **Mini link** (`mini.ts`): `askRoom` → `POST /v1/prompts { text, source: 'room' }` (not added to the dashboard's
  conversation); `roomReply` → `POST /v1/prompts/reply { id }`, with `404` → null.
- **Removing** the Echo Dot (`remove`): `turn(false)`, then delete the secret and the settings.
- **Disconnect everything** (`POST /v1/disconnect`) also calls the alexa connector's `turn(false)`.
- **docs:**
  - `docs/06` > `alexa`: the setup steps as built, the model, the 6 s rule and its words, one question at a time, the
    voice window, no progressive response, that the reply is memory only.
  - `docs/01`: the Alexa route listens on `127.0.0.1:47801`.
  - `docs/10` > Testing safely > The Alexa route: "No recorded or made-up requests (the owner's rule for Phases 2b–7).
    The owner checks with their own Echo Dot and the Alexa console; a wrong or old signature is checked by hand with
    curl through the owner's own tunnel (Task 10)."

Edge cases: Amazon retries a request → a second question gets "still answering"; the owner presses Stop Mini while a
room question waits → the agent is refused by the core, the reply says so, and the voice window closes; a request
arrives while the connector is being turned off → the socket is closed and Amazon hears nothing; the skill id changed
in the console → every request is refused at step 8 until the owner enters the new one (the page says to); a query
with a quote in it is put into the prompt as it is, never as a command.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS (the connector is off; no port is opened by the tests).

### Task 7: Hub: the tunnel — Tailscale Funnel on the owner's press, and the network summary

**Files:** modify `core/src/connectors/alexa/tunnel.ts` (add `tailscaleTunnel`), `core/src/connectors/alexa/index.ts`
(**Open the tunnel** and **Close the tunnel** as person-only actions), `core/src/api/routes/network.ts` (Phase 4's);
`docs/03-security-and-permissions.md` (The network), `docs/11-open-decisions.md` (D3), `docs/05-hub-api.md` (network).

**Interfaces — Consumes:** Task 6's `Tunnel`, `TunnelStatus`, `ALEXA_PORT`. **Produces:**
`tailscaleTunnel(d: { exec?: (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>; exe?: () => string | null }): Tunnel`;
alexa actions `tunnel_open`, `tunnel_close` (`personOnly`, scope `voice.alexa.ask`, risk `act`, `describe` "Open the
Echo Dot's tunnel" / "Close the Echo Dot's tunnel").

Behaviour:

- **Finding Tailscale:** `%ProgramFiles%\Tailscale\tailscale.exe` if it exists, else `tailscale.exe` found on `PATH`
  (by checking each folder of `PATH`, not by a shell). None → status `missing`, note "Tailscale is not installed on this
  PC. Install it from tailscale.com and sign in, or choose your own tunnel." All commands use `execFile` (never a
  shell), `windowsHide: true` and a 20 s timeout; their output is never logged.
- **Status:**
  - `tailscale status --json`: `BackendState` must be `Running` (else `closed`, note "Tailscale is not signed in on this
    PC."). The address is `https://<Self.DNSName without the trailing dot>/alexa`.
  - `tailscale funnel status --json`: the tunnel is `open` when `Web["<dns>:443"].Handlers["/alexa"].Proxy` is
    `http://127.0.0.1:47801` **and** `AllowFunnel["<dns>:443"]` is true. Otherwise it is `closed`. Unparseable output →
    `unknown`.
- **Open** (only from `turn(true)` with `tunnel: 'tailscale'` and from `tunnel_open`; never from `start`, a timer, a
  retry or a setup step): `tailscale funnel --bg --https=443 --set-path=/alexa http://127.0.0.1:47801`, then status.
  - A non-zero exit → status `closed` with `command` set to that exact line and a note:
    - stderr naming funnel not enabled, or an `https://login.tailscale.com/` address → "Funnel is not allowed in your
      tailnet yet. Open the address Tailscale gave in a terminal run of the command below, allow it, then press Open the
      tunnel again.";
    - "Access denied" → "Windows did not let Mini Hub change Tailscale. Run the command below in your own terminal.";
    - else "Tailscale did not open the tunnel. Run the command below in your own terminal to see why."
  - The listener must be on first (else `tunnel_open` fails "Turn the Echo Dot route on first.").
- **Close** (from `turn(false)`, `tunnel_close`, `remove`, Disconnect everything):
  `tailscale funnel --https=443 --set-path=/alexa off`. Its failure is reported with the same `command` treatment, and
  the listener is closed whatever happens. `tailscale funnel reset` is **never** run, and no other path is touched.
- **The own tunnel:** `status()` is `{ kind: 'own', state: 'unknown', address: publicUrl, note: 'Your own tunnel: Mini
  Hub cannot see whether it is running. Point it at http://127.0.0.1:47801.' }`; `open` and `close` change nothing. On
  turning off, the answer's note is "The route is closed. Stop your own tunnel too."
- **Network** (`GET /v1/network`): `alexa` becomes:
  - `{ state: 'off', note: 'Not set up.' }` without the device;
  - `{ state: 'off', note: 'Off.' }` while off;
  - `{ state: 'on', listener: '127.0.0.1:47801', tunnel: TunnelStatus }` while on.
- **docs:**
  - `docs/03` > The network: the hub opens the Funnel only on the owner's press, for one path, `/alexa`, to
    `127.0.0.1:47801`; turning off, Disconnect everything and removing close it; the listener is closed in every case.
  - `docs/11` D3: what is built (Tailscale Funnel on the owner's press, or their own tunnel), still off by default,
    with the owner's choice to be written there with the date.
  - `docs/05`: network's `alexa`.

Edge cases: the owner already serves something else on their Funnel → untouched, because only `/alexa` is set and
unset; Tailscale updated or reinstalled while on → `status` re-reads every time the page asks; the owner closes the
Funnel by hand → the page shows "closed" with **Open the tunnel**; turning off while Tailscale is not running → the
listener closes, and the note shows the off command to run later.

- [ ] Implement.
- [ ] Run `npm run check` and `npm test` — Expected: PASS. Do **not** run any `tailscale` command, by hand or by
  script; the owner does that, in Owner steps.

### Task 8: Dashboard: House, a home device's page, scenes, and the home tiles

**Files:** create `ui/src/features/house/House.tsx`, `ui/src/features/house/DeviceTile.tsx` (a device's control,
shared by the screen and the tiles), `ui/src/features/house/Scenes.tsx` (the editor), `ui/src/features/house/Guarded.tsx`
(the confirmation), `ui/src/features/devices/HomeDevicePage.tsx`, `ui/src/widgets/home-room.tsx`,
`ui/src/widgets/home-device.tsx`, `ui/src/widgets/home-scenes.tsx`, `ui/src/app/home.ts` (queries: `useHome`, `setHome`
through `/v1/actions` and the ticket); modify `ui/src/app/router.tsx` (`/house`), `ui/src/features/frame/Frame.tsx`
(`SECTIONS` gains House after Devices), `ui/src/app/live.ts` (topic `home`), `ui/src/features/devices/AddDevice.tsx`
(Home device), `ui/src/features/devices/SetupWizard.tsx` (`checks` fields; `copy` blocks), `ui/src/features/devices/DevicePage.tsx`
(route home devices), `ui/src/features/devices/Devices.tsx` (home cards), `ui/src/widgets/registry.tsx` and
`TileSettings` (the three tiles); `docs/07-dashboard-design.md` (House, Devices > Add device, Widgets).

**Interfaces — Consumes:** Task 2's `GET /v1/home`, `PATCH /v1/home/devices/:id`, `POST …/find`, scenes routes, the
`home` actions, the reasons; Phase 4's wizard, registry and gallery.

Behaviour:

- **SetupWizard additions:**
  - A `checks` field shows one `Switch` per choice with its label, none on unless `value` names it. The answer is the
    ticked values joined by `,`.
  - A step's `copy` blocks show a heading, the text in a mono box (`whitespace-pre`, scrolls, at most 40vh,
    `tabIndex={0}`) and **Copy** (`navigator.clipboard.writeText`, then "Copied.").
  - A form's `text` keeps line breaks (`whitespace-pre-line`).
  - The `look` step's busy line is the `Munch` loader "Looking on your home network".
- **Add device** gains "Home device" ("A lamp, a plug or a switch on your home network: Shelly, Hue, WLED, Tasmota or
  Kasa.") → the wizard for `home`; `#/devices?add=home` opens it directly. Done → `#/house`.
- **House** (`/house`, title "House"):
  - Head: **Add a home device** and **Scenes**. Scenes along the top, one `Button` each, which runs `scene` and shows
    "Done." or "<n> did not change: <names>".
  - Rooms as sections in `rooms` order. Each device is a `DeviceTile`:
    - icon by kind, name, state line, and its control. `onoff` → a `Switch` named "`<name>`".
    - `brightness` → a range input 1–100 (styled with the look's tokens, `aria-label "<name> brightness"`, the value as
      "40%"); it is sent on release or after 300 ms without movement.
    - `color` → a native colour input, `aria-label "<name> colour"`.
    - Readings as `Stat` lines ("Power 12 W").
  - A guarded device has **no switch**: its state as words and **Change…**, which opens `Guarded`: "`<name>` is marked
    as a `<kind>`. Switch it `<on|off>`?" with **Yes, switch it** and **No**. Yes runs `set_guarded`.
  - An unreachable device is muted, with its reason line and **Try again** (runs `get`).
  - Every change is optimistic and goes back with "That did not change: <error>" on failure. Results are announced in a
    `role="status"` region.
  - States: loading (skeleton tiles); error (Retry); empty "No home devices yet. Add one from your home network." with
    the button.
- **Scenes editor** (`Scenes`, a dialog, focus kept inside, `Esc` closes):
  - The scenes with Run, Edit and Delete (confirm "Delete the scene `<name>`?"). **New scene**: a name (1–40) and steps,
    each a device (guarded ones left out of the list), On or Off, and an optional brightness and colour when the device
    has them. Add a step, Move up, Move down, Remove. At most 20.
  - Save → `PUT /v1/home/scenes/:id` (a new id `s-<8 hex>`). The core's errors show at the top.
- **A home device's page** (`HomeDevicePage`, for `connectorId === 'home'`):
  - **Status**: the `DeviceTile` larger, then address, model, firmware, "Through `<adapter title>`", and last read `ago`.
    The reason line when unreachable, with **Look for it again** (`POST …/find` → "Found it at `<address>`." / "Not
    found on the network.") and, for `password` / `wrong-password`, **Enter the password again** (the wizard with
    `input: { endpoint }`; Task 2's setup accepts it and goes straight to the password step).
  - **Name and room**: inline fields → `PATCH /v1/devices/:id`; a room is chosen from the existing ones or typed.
  - **What is it?**: a `Choice` of kinds. The guarded ones come with the line "A lock, camera, alarm or garage is never
    switched without asking: its tile asks you first, Mini's requests always ask, and it cannot be used by voice or in a
    scene."
  - **Mini may use this device**: a `Switch`, off at first, with "Mini can see and switch this device only when this is
    on, and only as far as the switches below allow." Then the `home.read` Collect and Mini rows, and the `home.control`
    Mini row (`GrantRowItem`), with "These apply to every home device."
  - **Remove**: "Remove `<name>`? Mini Hub stops talking to it.", with the tick "Also delete its history".
  - `?new=1` opens with "What should this device share?" above the switch.
- **Devices:** home device cards show the state line and link to the page.
- **Tiles** (registry: default `w × h`, minimum):
  - `home-room` "A room" 3×3 (3×2). Setting `room` (default the first room), its devices as `DeviceTile`s in compact
    form. No devices → `not-connected` "Add a home device to see it here." with "Add a home device"; a room that is gone →
    "This room has no devices now. Choose another in this tile's settings."
  - `home-device` "Home device" 3×2 (2×2). Setting `device` (default the first). A removed one falls back to the first.
  - `home-scenes` "Scenes" 6×1 (2×1). Setting `scenes`, ticks (none ticked means all). None saved → "No scenes yet.
    Make one on the House screen."
  - Each handles loading and error. Privacy mode blurs device names in tiles until hovered.
- **docs/07:**
  - House as built (rooms, scenes on top, guarded tiles confirm, unreachable reasons, no Echo Dot device because D2 is
    No).
  - Devices > Add device gains Home device, and a home device's page.
  - Widgets: the three home tiles with their settings.

Edge cases: a 1,000-character reason cannot happen (they are fixed); 100 devices in one room scroll inside the section;
a device switched outside Mini Hub shows its new state at the next poll (10 s with the window open); both themes, at 900
and 1280 px, keyboard only (the range input moves with the arrow keys and commits on keyup after 300 ms).

- [ ] Implement, in both themes, with the look's parts only.
- [ ] Run `npm run check`, `npm test` and `npm run build -w @minihub/ui` — Expected: PASS.
- [ ] Look at House (empty), the Add device chooser and the home wizard's first step on a scratch hub (`node
  tools/dev.mjs --no-open` with a temporary `MINI_HUB_HOME`); do not start a network search and add no device.

### Task 9: Dashboard: the Echo Dot's setup and page, "safe by voice", the `voice-requests` tile

**Files:** create `ui/src/features/devices/AlexaPage.tsx`, `ui/src/widgets/voice-requests.tsx`; modify
`ui/src/features/devices/AddDevice.tsx` (Echo Dot), `ui/src/features/devices/DevicePage.tsx` (route `alexa-echo`),
`ui/src/features/permissions/Permissions.tsx` (the tick; the Echo Dot's section),
`ui/src/features/settings/Network.tsx` (Phase 4's; the Alexa route), `ui/src/features/activity/Activity.tsx` (words),
`ui/src/widgets/registry.tsx`, `ui/src/app/queries.ts` (types: `GrantRow.voiceAllowed`, `Connector.on`, network's
`alexa`), `ui/src/app/live.ts` (topic `voice`); `docs/07-dashboard-design.md` (Permissions, Settings > Network, Devices,
Widgets).

**Interfaces — Consumes:** Task 1's connector switch routes and `voiceAllowed`; Task 6's setup steps, health and events;
Task 7's `tunnel_open`, `tunnel_close` and `GET /v1/network`.

Behaviour:

- **Add device** gains "Echo Dot (Alexa)" ("Ask Mini through your Echo Dot, with a skill of your own.") → the wizard for
  `alexa` (it shows the model and the address as `copy` blocks); `#/devices?add=alexa`. If it is already set up, the
  card says "Set up. Open its page." and links there.
- **The Echo Dot's page** (`AlexaPage`):
  - **The route**: a big state line from health. **Turn on** opens a confirm: "This publishes one address on the
    internet, `<address>`, which answers only Amazon's signed requests for your skill. Turn it on?" → `POST
    /v1/connectors/alexa/enable` → its note. **Turn off** (no confirm; closing is always allowed) → `/disable` → its note.
  - **The tunnel**: the kind; the state (open, closed, unknown, missing) with its note; the address with **Copy**; for
    Tailscale while on, **Open the tunnel** / **Close the tunnel** (the person actions). When a status carries `command`,
    show it in a mono box with **Copy** and "Run this in your own terminal."
  - **The skill**: the skill id as "Set", with **Change the skill or the tunnel** (the wizard again); **Show the skill's
    setup** (the wizard's `skill` step as a read-only view).
  - **What voice may do**:
    - the `voice.alexa.ask` row ("Questions through the Echo Dot"), with its line "Anyone in the room can ask Mini
      questions. Mini answers only from what is on here.";
    - the `voice.alexa.private` row, with "Spoken answers may then include your calls, messages, mail and notifications.
      Anyone in the room will hear them.";
    - then a list of every row with `voiceAllowed` and its tick "Safe by voice" (`PUT … { voiceSafe }`), with the line
      "Things ticked here can be done by anyone speaking to the Echo Dot, as long as Mini may use them. Important things
      never can."
  - **Asked lately**: the last 8 `voice_request` events (time, what was asked, a chip: `answered`, `answered later`,
    `refused: switched off`, `refused: stopped`, `refused: busy`, `failed`).
  - **Remove**: "Remove the Echo Dot's setup? The route and the tunnel close, and the skill id is forgotten. Delete the
    skill in Amazon's console too."
- **Permissions:**
  - Rows with `voiceAllowed` show a "Safe by voice" tick beside Mini may use, `aria-label "<label>: safe by voice"`,
    disabled with the title "Mini may use must be on first" while `mini !== 'on'`.
  - Rows of kind `important` never show it.
  - The Echo Dot's two rows sit in their own section "Echo Dot", with the lines above.
- **Settings > Network:** "Echo Dot route": off/on, "Listening on 127.0.0.1:47801", the tunnel's state and address, and
  "Open its page".
- **`voice-requests` tile** (registry: "Echo Dot", 4×3, min 3×2, about "What was asked through the Echo Dot"):
  - the last 6 requests, one line each with the time and the chip;
  - not set up → `not-connected` "Set up the Echo Dot in Devices to see what is asked here." with "Set up the Echo Dot";
  - none → "Nothing asked yet.";
  - the title is blurred in privacy mode.
- **Activity:** rows with `detail: 'voice'` read "Mini · by voice"; new words: `connector-on` "Turned a connection on",
  `connector-off` "Turned a connection off", `scene` "Changed a scene", `home-device` "Changed a home device".
- **docs/07:**
  - Permissions: the tick as built (only on switches that change something, only once the Echo Dot is set up, only
    with Mini may use on).
  - Settings > Network: the Echo Dot route.
  - Devices: the Echo Dot's page.
  - Widgets: `voice-requests`.

Edge cases: the enable answer `ok: false` (port in use, no skill id) shows its note in the danger tone and the state
stays off; the tunnel's `missing` state offers only "choose your own tunnel" (the wizard); turning off while a question
is being answered closes it at once; both themes, at 900 and 1280 px, keyboard only.

- [ ] Implement, in both themes, with the look's parts only.
- [ ] Run `npm run check`, `npm test` and `npm run build -w @minihub/ui` — Expected: PASS.
- [ ] Look at the Echo Dot wizard's first two steps and the Permissions screen on a scratch hub; do not finish the
  setup and do not turn anything on.

### Task 10: Checks, final review, and the installer build

Not a code task beyond fixes found here.

- [ ] Run every check in Global Constraints; all PASS. Run the secrets search of `03` > "Keeping the repository clean"
  over the tracked and new files of both repositories and look at every hit. In particular there must be no real skill
  id, tailnet name, home address list, device name or MAC address.
- [ ] Final review of Tasks 1–9 against the Review Focus (RF1–RF8) and the Global Constraints; one fix pass. In
  particular:
  - search the core for every `fetch(`, `http.request`, `tls.connect`, `net.connect` and `dgram`, and check each is
    `lanFetch`/`lanSocket`/`lanUdp`/`pinnedRequest`, the Alexa chain fetch, the mini connector (127.0.0.1) or the
    existing link;
  - search for every `tailscale` call, and check it can run only from `turn`, `tunnel_open`, `tunnel_close`, `remove`
    or disconnect.
  - Write the rulings and deferred minors in the ledger `.superpowers/sdd/2026-11-23-home-and-alexa/progress.md`.
- [ ] Build the installer: `export PATH="$HOME/.cargo/bin:$PATH" && cd /f/mini-hub && npm run build:shell`
  — Expected: an NSIS installer under `shell/src-tauri/target/release/bundle/nsis/`. Do not install it; the owner does.
- [ ] With the owner, after their steps below, check test 6 by hand through **their** tunnel while it is on:
  - `curl -i -X POST https://<their address>/alexa -H "content-type: application/json" -d "{}"` → `400`;
  - the same with a `SignatureCertChainUrl: https://example.com/echo.api/x.pem` and any `Signature-256` header → `400`;
  - nothing in Activity or the Echo Dot's "Asked lately".

  Then they turn it off, and the same address no longer reaches Mini Hub (Tailscale answers an error, or nothing). Write
  what was seen.
- [ ] The phase report (`docs/10` > What a phase report says): each "Done when" line and how it was checked (test 6 by
  hand, test 11 by the existing tests and the room trial); what was verified on the owner's devices and what only by the
  checks; the devices that could not be added and why. The owner's D1, D2 and D3 answers go into `docs/11` with the date.

## Owner steps

Only the owner can do these; nothing in this plan does them for the owner.

1. **Install and update.** Install the new Mini Hub over the old one. Commit and push the plugin (0.11.0), run `claude
   plugin update mini-bot`, and restart Mini's session.
2. **List your devices (D1).** Write down each smart device: brand, model, the app it is set up in, and whether its own
   app shows a "local control", "LAN" or web page. Mini Hub can use Shelly (second generation or later), a Philips Hue
   Bridge (the square one), WLED, Tasmota and older TP-Link Kasa models. Others will show why not.
3. **Add them:** House > Add a home device > Look on my network (Windows may ask whether Mini Hub may use private
   networks: that is your choice). Tasmota, and anything not found, are added by address (your router's device list
   shows it). For a Hue Bridge, press its round button when asked. For a Shelly or Tasmota with a password, enter it.
   Tick only what you want.
4. **Check and share:** each device's state shows and its switch works from House. Mark any relay that opens a garage
   or a door as Garage or Lock on its page. Turn on **Mini may use this device** for the ones Mini may use, then set
   Permissions > The state of home devices and Switching home devices. Ask Mini on the PC "is the bedroom lamp on?" and
   "turn it off".
5. **Choose the tunnel (D3).** Either install Tailscale on this PC and sign in, then in Tailscale's admin console allow
   HTTPS certificates and Funnel for this PC, or run your own tunnel (Cloudflare Tunnel needs a domain) pointed at
   `http://127.0.0.1:47801`. Or choose "not at all" and skip the rest.
6. **Make the skill in Amazon's console:** Devices > Add device > Echo Dot (Alexa), and follow its steps: create the
   skill (Custom, Provision your own), paste the interaction model, Build, set the endpoint to the address shown with
   "a certificate from a trusted certificate authority", set Test to Development, then paste the Skill ID back into Mini
   Hub.
7. **Turn it on:** on the Echo Dot's page, Turn on (and Open the tunnel if it did not open; if Tailscale refuses, run
   the command shown in your own terminal). Set Permissions > Questions through the Echo Dot to **on**. Leave Private
   details in spoken answers **off** for now.
8. **The "Done when" checks:**
   - "Alexa, ask Mini whether I have any missed calls" → a polite refusal (private details are off).
   - Turn Private details on and ask again → an answer, or "working on it", then "Alexa, ask Mini what it found".
   - "Alexa, ask Mini to open my browser" → not available by voice, and nothing happens on the PC.
   - Tick **Safe by voice** for Switching home devices, share a lamp with Mini, and "Alexa, ask Mini to turn on the
     bedroom lamp". An approval is never asked for by voice.
9. **Test 6 and turning off:** with the controller, the two `curl` checks in Task 10. Then **Turn off** and open the
   address from your phone with Wi-Fi off: it no longer reaches Mini Hub.
10. **Answer D1, D2 and D3** so they can be written into `docs/11` with today's date: which devices you have, whether
    the Amazon session adapter stays No, and which tunnel (if any) you keep.

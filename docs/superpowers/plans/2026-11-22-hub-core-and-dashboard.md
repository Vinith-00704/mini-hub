# Hub core and dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The PC half of Phase 1: an encrypted hub core with grants, approvals, the audit log and Stop, the `pc`
and `mini` connectors, its local API, and the dashboard's frame with the Home, Mini, Activity, Permissions and
Settings screens, runnable for development with one command against made-up data.

**Architecture:** npm workspaces `protocol`, `core`, `ui`. The core is TypeScript run directly by Node 24's type
stripping (no build step in development), Fastify on `127.0.0.1`, SQLCipher through
`better-sqlite3-multiple-ciphers`. The dashboard is React + Vite + Tailwind v4. Until the Tauri shell exists
(next plan), `tools/dev.mjs` plays the shell's part: makes the keys, starts the core, and opens the dashboard
with the person key in the address's `#fragment`.

**Tech Stack:** Node 24, TypeScript 5, Fastify 5, `@fastify/websocket`, `zod` 3, `better-sqlite3-multiple-ciphers`
13.2.0, `pino`, Vitest; React 19, Vite, Tailwind CSS 4, Radix primitives, TanStack Query and Router, Lucide,
`@fontsource-variable/geist` and `geist-mono`, Testing Library.

**Spec:** `docs/00-overview.md` to `docs/11-open-decisions.md`, chiefly `03`, `04`, `05`, `06` (`pc`, `mini`), `07`.

## Global Constraints

- **The owner commits.** No task commits or pushes. Each task ends with its tests green and the files left for the owner.
- Node 24; TypeScript files use only erasable syntax (no `enum`, no parameter properties, no namespaces), and
  relative imports carry the `.ts` extension, so Node runs them unbuilt.
- The core binds `127.0.0.1` only. Nothing in the dashboard loads from the internet (fonts are bundled).
- Data folder: `MINI_HUB_HOME`, else `%APPDATA%\MiniHub`. Every test uses a fresh temporary folder; no test
  touches `%APPDATA%\MiniHub` or `%APPDATA%\ClaudeMiniBot`.
- No test starts a Claude Code session, and no code answers the Mini Bot's consent cards or calls its
  `/v1/trust/*` or `/v1/permissions/*` routes.
- Test data is made up: names from `tools/seed.mjs`, numbers `+1 555 01xx`, addresses `@example.com`.
- Approvals live 2 minutes. Ticket waits are at most 2000 ms. Default page size 50, maximum 200.
- Logs never contain message or mail text, `who`, tokens, keys or action arguments.
- The default accent is the Mini Bot's own default, `#d77757`. Named bot accents: blue `#4c8dff`, green `#2fbf71`,
  pink `#ef5da8`, orange `#f58f29`, purple `#8e5cf0`, claude `#d77757`; a hex accent is used as is.
- Copy follows `07` > Words: sentence case, plain words, no exclamation marks.

## Review Focus

1. **The wrong database key, or a damaged file**: the core must exit with "The hub's data could not be opened"
   and never create a fresh database over the old file. (Task 2 test `refuses a wrong key and keeps the file`.)
2. **The Mini Bot is not running, or `runtime.json` is stale**: the Mini screen and tile say "Mini is not running"
   with Start; nothing throws. (Task 7 test `reports not running when runtime.json is missing or its port is dead`.)
3. **A second core started while one runs**: it must refuse, not overwrite `hub.json`. (Task 9 test `a second start refuses while the first is alive`.)
4. **An approval answered twice, or after it expired**: `409` with code `decided` or `expired`; the action runs at
   most once. (Task 4 test `an approval cannot be decided twice or after expiry`.)
5. **Long and non-Latin text in events** (300-character names, emoji, Tamil script): tiles truncate on one line
   with an ellipsis and the full text in the title attribute. (Task 12 test `tiles truncate long and non-Latin text`.)

---

## File Structure

```
package.json                     workspaces, scripts: dev, test, check
tsconfig.base.json
protocol/
  package.json                   name @minihub/protocol, exports ./src/index.ts
  src/index.ts  scopes.ts  events.ts  errors.ts
  test/protocol.test.ts
core/
  package.json
  src/main.ts                    entry: keys from stdin, data folder, hub.json, start/stop
  src/paths.ts                   data folder, hub.json, Mini Bot folder
  src/log.ts                     pino with redaction
  src/store/db.ts                open, migrate
  src/store/migrations/001-init.sql
  src/audit/audit.ts
  src/rules/policy.ts            decide(): the one place that says run / ask / refuse
  src/rules/grants.ts
  src/rules/approvals.ts
  src/rules/stop.ts
  src/tickets.ts
  src/events.ts                  event queries, seen, delete
  src/connectors/types.ts
  src/connectors/registry.ts
  src/connectors/pc.ts
  src/connectors/mini.ts
  src/api/server.ts              Fastify, auth, errors, CORS
  src/api/routes/*.ts            one file per group in 05
  src/api/live.ts                WebSocket topics
  test/*.test.ts
ui/
  package.json  vite.config.ts  index.html
  src/main.tsx
  src/app/{router.tsx, api.ts, live.ts, keys.ts}
  src/design/{tokens.css, color.ts}
  src/components/ui/{Button, Switch, Segmented, Tile, Dot, Chip, Empty}.tsx
  src/components/BotSprite.tsx
  src/features/frame/{Frame, Rail, TopBar, StopBar, ApprovalCards}.tsx
  src/features/home/Home.tsx
  src/widgets/{today, mini, device-status, calls, messages, mail, mini-activity, approvals}.tsx
  src/features/{mini/MiniScreen, activity/Activity, permissions/Permissions, settings/Settings}.tsx
  test/*.test.tsx
tools/dev.mjs  tools/seed.mjs
```

---

### Task 1: Workspace and the shared protocol

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `protocol/package.json`, `protocol/src/{index,scopes,events,errors}.ts`
- Test: `protocol/test/protocol.test.ts`

**Interfaces:**
- Produces:
  - `type Risk = 'read' | 'act' | 'important'`; `type GrantState = 'off' | 'ask' | 'on'`
  - `SCOPES: Record<ScopeId, { label: string; kind: Risk; connector: string; perDevice: boolean; collectable: boolean }>`
    with exactly the scopes of `03` > Scopes (17 of them, including `mail.change`, `pc.status.read`, `pc.power`).
  - `type EventType` (the 11 of `04`); `eventScope(type): ScopeId | 'own' | 'person'` per `04`'s table
    (`device_state` resolves by device kind: `eventScope('device_state', 'phone') === 'phone.usage.read'`,
    `'pc'` → `pc.status.read`, anything else → `home.read`).
  - `newEventSchema` (zod): `{ type, occurredAt:number, who?, whoKey?, app?, title?, body?, data?: record }`,
    `title` ≤ 300 chars, `body` ≤ 20,000, `who` ≤ 200.
  - `ERROR_CODES` = `unauthorized, forbidden, not-allowed, stopped, not-found, bad-request, too-large, expired, decided, unavailable`;
    `type ApiError = { error: string; code: ErrorCode; scope?: string }`.

- [ ] **Step 1: Write the failing tests** in `protocol/test/protocol.test.ts`:
  `every scope in 03 exists with its kind` (assert `SCOPES['phone.reply'].kind === 'important'`,
  `SCOPES['mail.change'].kind === 'act'`, `Object.keys(SCOPES).length === 17`);
  `event types map to their scopes` (`eventScope('sms') === 'phone.messages.read'`, `eventScope('mini_action') === 'own'`,
  `eventScope('system') === 'person'`, the three `device_state` cases);
  `the event schema refuses oversize text` (`title` of 301 chars fails, 300 passes).
- [ ] **Step 2: Run** `npx vitest run protocol` — expected FAIL (modules missing).
- [ ] **Step 3: Implement** the four files. Root `package.json`: `"private": true`, `"type": "module"`,
  `"workspaces": ["protocol","core","ui"]`, scripts `test: vitest run`, `check: tsc -b`, `dev: node tools/dev.mjs`.
  `tsconfig.base.json`: `strict`, `module`/`moduleResolution` `nodenext`, `allowImportingTsExtensions`, `noEmit`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- [ ] **Step 4: Run** `npm install` then `npx vitest run protocol` — expected PASS. Also run
  `node -e "import('@minihub/protocol').then(m=>console.log(Object.keys(m.SCOPES).length))"` from `core/` — expected `17`
  (proves Node strips types through the workspace link; if it fails, core imports `../../protocol/src/index.ts` instead and this plan's later imports follow suit).

### Task 2: The encrypted store

**Files:**
- Create: `core/package.json`, `core/tsconfig.json`, `core/src/store/db.ts`, `core/src/store/migrations/001-init.sql`
- Test: `core/test/store.test.ts`

**Interfaces:**
- Produces: `openStore(file: string, key: string): Store`, where `Store` is the `better-sqlite3` `Database`
  with the schema applied; throws `StoreError('The hub\'s data could not be opened')` on a wrong key or a damaged
  file. `getMeta(db, key): string | undefined`, `setMeta(db, key, value)`; `getSetting<T>(db, key, fallback: T): T`,
  `setSetting(db, key, value: unknown)`.
- The migration is `04`'s schema exactly, with `collect`/`grants` keyed `(target, scope)`, `approvals` without
  `caller` and `decided_on`, plus `boards` and `settings`. `meta.schema = '1'`.

- [ ] **Step 1: Failing tests**: `creates an encrypted database that a plain open cannot read`;
  `applies migrations once` (open twice, `meta.schema === '1'`, no error);
  `refuses a wrong key and keeps the file` (open with `k1`, close, open with `k2` throws `StoreError`, file size unchanged,
  open with `k1` still works); `full-text search works on events` (insert an event, `SELECT rowid FROM events_fts WHERE events_fts MATCH 'lamp'`).
- [ ] **Step 2: Run** `npx vitest run core/test/store.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Pragmas in order: `cipher='sqlcipher'`, `key=<key>` (key passed as a bound-safe hex
  literal: `key="x'<hex>'"` with the key hex-encoded), then `journal_mode=WAL`, `foreign_keys=ON`; probe with
  `SELECT count(*) FROM sqlite_master` and convert its error to `StoreError`. Migrations: read numbered `.sql` files,
  apply those above `meta.schema` in one transaction each. FTS kept in step with triggers on `events` insert/delete.
- [ ] **Step 4: Run** — PASS.

### Task 3: The audit log

**Files:** Create `core/src/audit/audit.ts`; Test `core/test/audit.test.ts`

**Interfaces:**
- Produces: `class Audit { constructor(db: Store, now?: () => number); append(e: AuditInput): AuditRow;
  list(q: { caller?: string; action?: string; scope?: string; after?: number; before?: number; limit?: number; agentOnly?: boolean }): AuditRow[];
  check(): { ok: true } | { ok: false; brokenAt: number } }`
- `AuditInput = { caller: 'person'|'agent'|'device'|'voice'|'system'; detail?: string; action: string; target?: string; scope?: string; risk?: Risk; outcome: 'done'|'refused'|'failed'|'waiting'; data?: Record<string, string|number|boolean|string[]|number[]> }`
- `hash = sha256(prev_hash + JSON.stringify([at, caller, detail, action, target, scope, risk, outcome, data]))`, first `prev_hash` is 64 zeros.

- [ ] **Step 1: Failing tests**: `rows chain by hash`; `check finds a row changed by hand` (UPDATE one row's
  `outcome`, `check()` returns `{ ok:false, brokenAt: <its id> }`); `agentOnly lists only agent rows`;
  `data refuses free text over 200 characters` (throws — message bodies must not be logged).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 4: Grants, approvals, Stop and the policy

**Files:** Create `core/src/rules/{policy,grants,approvals,stop}.ts`, `core/src/tickets.ts`; Test `core/test/rules.test.ts`

**Interfaces:**
- Produces:
  - `decide(i: { caller: 'person'|'agent'; voice?: boolean; risk: Risk; grant: GrantState; voiceSafe?: boolean; voicePrivate?: boolean; isPrivateRead?: boolean; stopped: boolean }): { kind: 'run' } | { kind: 'ask' } | { kind: 'refuse'; code: 'not-allowed'|'stopped' }`
  - `class Grants { constructor(db); get(target, scope): { collect: boolean; mini: GrantState; voiceSafe: boolean }; set(target, scope, patch: { collect?: boolean; mini?: GrantState; voiceSafe?: boolean }): void; list(): Array<{ target; scope; collect; mini; voiceSafe }> }` — a missing row is `{ collect:false, mini:'off', voiceSafe:false }`.
  - `class Approvals { constructor(db, now?); request(a: { scope; risk; deviceId?: string; action: string; args: unknown; summary: string }): Approval; decide(id, decision: 'yes'|'no'): Approval /* throws ApiFailure 409 decided|expired, 404 */; expireDue(): Approval[]; noAll(): void; list(): Approval[]; onChange(fn): () => void }`, `APPROVAL_MS = 120_000`.
  - `class StopState { constructor(db); get stopped(): boolean; stop(): void; resume(): void }` (kept in `settings.stopped`).
  - `class Tickets { create(): string; settle(id, result: TicketResult): void; wait(id, ms): Promise<TicketResult | { done:false; waitingFor?: 'approval' }> }`, `TicketResult = { done:true; ok:boolean; data?: unknown; error?: string; code?: ErrorCode }`.
  - `class ApiFailure extends Error { status: number; code: ErrorCode; scope?: string }` in `core/src/rules/policy.ts`.

- [ ] **Step 1: Failing tests** — a table test `policy` covering every row below, then the class tests:

| caller | voice | risk | grant | other | expect |
|---|---|---|---|---|---|
| person | | important | off | | run |
| agent | | read | off | | refuse not-allowed |
| agent | | read | ask | | ask |
| agent | | act | on | | run |
| agent | | important | on | | ask |
| agent | | read | on | stopped | refuse stopped |
| agent | yes | act | on | voiceSafe false | refuse not-allowed |
| agent | yes | act | on | voiceSafe true | run |
| agent | yes | important | on | voiceSafe true | refuse not-allowed |
| agent | yes | read | on | isPrivateRead, voicePrivate false | refuse not-allowed |
| agent | yes | read | ask | | refuse not-allowed |

  `grants are per target` (on for `phone-a` leaves `phone-b` off); `an approval cannot be decided twice or after expiry`
  (`decide` twice → 409 `decided`; with `now` past 120 s → 409 `expired`); `noAll answers every waiting approval no`;
  `stop survives a reopen`; `a ticket wait returns at its deadline` (≤ 2000 ms, `done:false`).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 5: Connectors and the `pc` connector

**Files:** Create `core/src/connectors/{types,registry,pc}.ts`; Test `core/test/pc.test.ts`

**Interfaces:**
- Consumes: `Risk`, `ScopeId` (Task 1); `Store` (Task 2).
- Produces:
  - `Connector` as in `06` > The interface, minus `setup` (later phases): `manifest`, `start(ctx)`, `stop()`, `health()`, `actions`.
  - `Ctx = { emit(e: NewEvent & { deviceId: string }): void; devices: DeviceStore; log: Logger; signal: AbortSignal }`.
  - `class DeviceStore { constructor(db); upsert(d: { id; connectorId; kind; name; info?; state? }): Device; setState(id, patch): void; list(): Device[]; get(id) }`.
  - `class Registry { constructor(deps); add(c: Connector): void /* throws if an act/important action lacks describe, or any action lacks scope/risk */; startAll(); stopAll(); actions(): ActionInfo[]; find(connector, name): ActionDef }`.
  - `pcConnector({ exec?: (cmd: string, args: string[]) => Promise<void>; os?: OsInfo }): Connector`, device id `pc`, kind `pc`, actions
    `status` (`pc.status.read`, read), `lock` (`pc.power`, act: `rundll32.exe user32.dll,LockWorkStation`),
    `sleep`, `restart`, `shut_down` (`pc.power`, important: `rundll32.exe powrprof.dll,SetSuspendState 0,1,0`,
    `shutdown /r /t 0`, `shutdown /s /t 0`). `describe` texts: "Lock this PC", "Put this PC to sleep", "Restart this PC", "Shut down this PC".

- [ ] **Step 1: Failing tests**: `registry refuses an action without a risk`; `pc status reports memory, disk and uptime`;
  `pc lock runs the lock command` (fake `exec` records `rundll32.exe`); `pc registers itself as a device`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 6: Events

**Files:** Create `core/src/events.ts`; Test `core/test/events.test.ts`

**Interfaces:**
- Produces: `class Events { constructor(db, grants: Grants, now?); add(deviceId: string, seq: number, e: NewEvent): number | null /* null when its collect switch is off or (deviceId, seq) exists */; query(q: EventQuery, as: Viewer): { items: EventRow[]; cursor?: string }; get(id, as: Viewer): EventRow; markSeen(ids: number[]): void; remove(ids: number[]): void; people(as: Viewer): PersonRow[]; counts(since: number, as: Viewer): Record<EventType, number> }`
- `Viewer = { caller: 'person' } | { caller: 'agent'; voice?: boolean }`. For an agent, each row's scope (`eventScope`)
  must have `mini` not `off` for its device (an `ask` row is not returned by `query`; the API turns that into an
  approval, Task 8); `own` rows only if `type === 'mini_action'`; `person` rows never.
- `EventQuery = { types?: EventType[]; device?: string; who?: string; after?: number; before?: number; q?: string; unseen?: boolean; limit?: number; cursor?: string }`; cursor is the base64 of `occurredAt:id`.
- The hub's own events (`mini_action`, `system`) use device `hub` and a counter kept in `meta.hubSeq`.

- [ ] **Step 1: Failing tests**: `a duplicate (device, seq) is stored once`; `collect off stores nothing`;
  `the agent sees only granted types, per device`; `the agent never sees system events`; `search finds words in body`;
  `paging returns every row once` (120 rows, pages of 50).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 7: The `mini` connector

**Files:** Create `core/src/connectors/mini.ts`; Test `core/test/mini.test.ts`

**Interfaces:**
- Produces: `miniConnector({ botHome: string; fetch?: typeof fetch; spawn?: SpawnFn; now?; pollMs?: { busy: 300; idle: 2000 } }): Connector & MiniLink`
- `MiniLink = { snapshot(): MiniState; prompt(text: string): Promise<string /* prompt id */>; conversation(): Turn[]; startBot(): Promise<void>; stopBot(): Promise<void>; stopControl(): Promise<void> }`
- `MiniState = { running: boolean; profile?: { name; avatar; accent: string /* hex, resolved */; sprite?: unknown }; phase?: string; detail?: string; card?: { kind; text }; permissions?: Record<string, boolean>; error?: string }`
- `Turn = { id: string; text: string; reply?: string; partial: boolean; isError: boolean; at: number }`.
- Reads `<botHome>/runtime.json` (`port`, `token`) on each poll; `GET /v1/state` with `Authorization: Bearer`;
  `POST /v1/prompts` `{ text, source: 'hub' }` (an older runtime that refuses the source is retried with `source: 'bot'`);
  `POST /v1/computer/stop` `{ reason: 'Stopped from Mini Hub' }` for `stopControl`; `POST /v1/shutdown` `{}` for
  `stopBot`; `startBot` spawns `node <botHome>/start-mini.mjs` detached. The reply to a turn is the state's
  `activity.preview` whose `id` equals the turn's id. Accent names map to the hex values in Global Constraints.
- Emits `mini_action` events from the runtime's `GET /v1/computer/log` entries it has not seen (by entry time).

- [ ] **Step 1: Failing tests** against a fake runtime (a `node:http` server on a random port and a temp `runtime.json`):
  `reports not running when runtime.json is missing or its port is dead`; `follows a reply as it grows` (fake state
  returns partial then whole text for the turn's id; `conversation()` shows both stages); `maps named accents to hex`;
  `stopControl calls the computer stop route`; `never calls trust or permission routes` (the fake fails the test on any
  `/v1/trust` or `/v1/permissions` request across all the other tests).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 8: The local API

**Files:** Create `core/src/api/server.ts`, `core/src/api/live.ts`, `core/src/api/routes/{basics,events,devices,actions,rules,mini,settings}.ts`; Test `core/test/api.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildServer(hub: Hub, keys: { person: string; agent: string }, opts?: { uiOrigin?: string; logger?: Logger }): FastifyInstance`,
  where `Hub = { db; audit; grants; approvals; stop; tickets; events; devices; registry; mini: MiniLink; version: string }` (built by `createHub(db, deps)` in `core/src/hub.ts`).
- Routes from `05` for this phase: basics (`/v1/health`, `/v1/state`, `WS /v1/live`), events (all), devices
  (`GET`, `PATCH`), `GET /v1/connectors`, actions and tickets, rules (grants, approvals, stop, resume, audit, audit/check),
  mini (all), settings (`GET`, `PATCH`). Pairing, boards, data export and disconnect come with later phases.
- Auth: `x-hub-ui` equal (constant-time) to the person key → person; `Authorization: Bearer <agent>` → agent, plus
  `x-hub-origin: voice` → voice. Anything else `401`. A person-only route called by the agent → `403 forbidden`.
  After Stop, agent routes other than health and stop → `423 stopped`. Errors are `ApiError`.
- Agent action flow: `POST /v1/actions` → `decide()` → run (ticket settles with the result) / ask (`approvals.request`
  with the action's `describe(args)`; on yes the ticket runs the action; on no or expiry it settles `ok:false,
  code:'not-allowed'`) / refuse (`403 not-allowed` with `scope`). Agent event reads of an `ask` scope create an
  approval the same way and settle with the rows.
- Every agent request, every person change and every action outcome is audited.
- `WS /v1/live` needs the person key as the first message `{ key }` (browsers cannot set headers on WebSockets);
  then pushes `{ topic }` for `events, devices, approvals, grants, audit, state, mini`.
- CORS: only `opts.uiOrigin`. Body limit 256 KB.

- [ ] **Step 1: Failing tests** (Fastify `inject`, scratch store, fake `mini`): the numbered checks of `03` that
  this phase owns: `1 the agent cannot reach person routes` (grants PUT, approvals POST, resume, settings PATCH,
  events DELETE, mini prompt → all 403); `2 an important action never runs without an approval` (grant on and off);
  `3 an approval cannot be answered by the agent or without a key`; `4 after Stop every agent route but health and stop is 423`;
  `7 the audit chain check reports a hand-edited row`; plus `an ask grant turns an agent read into an approval and yes returns the rows`;
  `live sockets without the person key are closed`; `a request from another origin gets no CORS header`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 9: The entry point, logs and `hub.json`

**Files:** Create `core/src/main.ts`, `core/src/paths.ts`, `core/src/log.ts`, `core/src/hub.ts`; Test `core/test/main.test.ts`

**Interfaces:**
- Produces: `node core/src/main.ts` reads one JSON line from standard input `{ dbKey: string; personKey: string; uiOrigin?: string }`
  (64 hex characters each), opens `<home>/hub.db`, starts connectors and the API on port 0, writes
  `<home>/hub.json` `{ port, token, pid, version }` atomically, prints `{"ready":true,"port":N}` on standard output,
  and on `SIGINT`/`SIGTERM`/stdin end stops connectors, deletes `hub.json` and exits 0.
- `createLogger(dest?: DestinationStream): Logger` with `redact` paths `*.body, *.text, *.who, *.args, *.token, *.key, *.dbKey, *.personKey, req.headers["x-hub-ui"], req.headers.authorization`, censor `[hidden]`; written to `<home>/logs/core.log`.
- Single instance: if `hub.json` exists and its `pid` is alive and `/v1/health` answers, exit 3 with "Mini Hub is already running".

- [ ] **Step 1: Failing tests** (spawn the real entry with a temp `MINI_HUB_HOME`): `starts, writes hub.json, answers health, and removes hub.json on exit`;
  `a second start refuses while the first is alive`; `a wrong key exits with the data message and leaves hub.db as it was`;
  `logs never contain a body, a token or a key` (run requests carrying a marker string in a body and the keys, then grep the log file for the marker and the keys).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 10: Development launcher and made-up data

**Files:** Create `tools/dev.mjs`, `tools/seed.mjs`; Test `core/test/seed.test.ts`

**Interfaces:**
- `node tools/seed.mjs <home> <dbKeyHex>`: adds devices `pc` (if absent), `phone-test` (kind `phone`, "Test phone"),
  `mail-test` (kind `mail-account`, "Mail (test)"); 60 made-up events over the last two days of types `call`, `sms`,
  `chat`, `mail`, `notification`, `device_state`, `mini_action`; collect on for those; `mini` grants left off.
  Names: Asha, Ravi, Priya, Arjun, Meera, Kabir, Zoya, Dev; one 300-character name; one Tamil-script and one emoji
  message. Refuses unless `<home>` is under the repository's `.minihub-home/` or the system temp folder.
- `node tools/dev.mjs`: `MINI_HUB_HOME=<repo>/.minihub-home`, dev db key kept in `<repo>/local/dev-db-key` (made once),
  a new person key each run; seeds when the database is new; starts the core (stdin keys, `uiOrigin: http://127.0.0.1:5173`)
  and `vite` for `ui`; prints `Dashboard: http://127.0.0.1:5173/#api=<port>&k=<personKey>` and opens it.

- [ ] **Step 1: Failing test**: `seed refuses a real data folder` (`%APPDATA%\MiniHub` path → exits non-zero, nothing written);
  `seed fills a scratch hub` (counts per type).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 11: The dashboard's frame and design system

**Files:** Create `ui/*` as in File Structure for `app/`, `design/`, `components/`, `features/frame/`; Test `ui/test/{color,frame}.test.tsx`

**Interfaces:**
- Produces:
  - `readKeys(): { api: string; key: string } | null` — from `location.hash` (`#api=<port>&k=<key>`), moved into memory
    and removed from the address bar with `history.replaceState`. (The shell will supply these another way.)
  - `api<T>(path, init?): Promise<T>` adds `x-hub-ui`, throws `ApiFailure` with `code`.
  - `useLive()` — opens `/v1/live`, sends `{ key }`, invalidates TanStack queries by topic.
  - `color.ts`: `accentFor(profileAccent?: string): string`, `textOn(hex): '#000000'|'#ffffff'` (whichever has the higher WCAG contrast),
    `readable(accent, surface, min = 4.5): string` (lightens or darkens in 5% steps of lightness until it meets `min`).
  - Tokens exactly as `07` > Tokens, both themes, `data-theme` on `<html>` (`dark` default, `light`, `system`), `data-density`.
  - Base components: `Button` (`primary|secondary|ghost|danger`), `Switch`, `Segmented` (off/ask/on), `Tile` (title, action slot, four states `loading|empty|error|not-allowed`), `Dot` (ok/warn/danger/muted + label), `Chip`, `Empty`.
  - `BotSprite({ sprite?, accent, state, size })`: draws a `profile.sprite` (palette + frames, `.` = empty) on a canvas with
    the idle/blink cycle; without a sprite draws a built-in 12×10 Clawd-like character in the accent colour. Holds still with reduced motion.
  - Frame per `07` > The frame: rail (bot, Home, Mini, Activity, Permissions, Settings, collapse below 1100 px),
    top bar (title, command box placeholder that asks Mini on Enter, approvals count, Stop), stopped bar with Resume,
    approval cards bottom right with Yes/No and a countdown.
- [ ] **Step 1: Failing tests**: `textOn picks black on the default accent and white on purple`; `readable meets 4.5 on both surfaces for every named accent`;
  `readKeys takes the key from the fragment and clears it`; `Stop is shown on every screen and calls /v1/stop` (mocked `api`);
  `an approval card shows the summary and answers yes`.
- [ ] **Step 2: Run** `npx vitest run ui` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, and `npm run check` clean.

### Task 12: Home and its tiles

**Files:** Create `ui/src/features/home/Home.tsx`, `ui/src/widgets/*.tsx`; Test `ui/test/home.test.tsx`

**Interfaces:**
- Consumes: `api`, `Tile`, `BotSprite` (Task 11); routes of Task 8.
- The default board of `07` > Home, fixed in code for this phase (editing is Phase 4): `today`, `mini`,
  `device-status` (the first phone, else the PC), `calls`, `messages`, `mail`, `mini-activity`. Each tile handles
  loading, empty ("Nothing yet. Turn on what to collect in Permissions.", with a button), error with Retry.
  Relative times ("2m", "1h") with the exact time in the title. One-time codes (4–8 digits next to "OTP" or "code")
  are masked as `••••••` until hovered.
- [ ] **Step 1: Failing tests**: `tiles truncate long and non-Latin text`; `empty tiles say what to switch on`;
  `codes are masked until hover`; `the Mini tile asks Mini on Enter` (posts `/v1/mini/prompt`).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 13: Mini, Activity, Permissions and Settings

**Files:** Create `ui/src/features/{mini/MiniScreen,activity/Activity,permissions/Permissions,settings/Settings}.tsx`; Test `ui/test/screens.test.tsx`

**Interfaces:**
- Mini (`07` > Mini): large bot, state line, the conversation from `/v1/mini/conversation` with the latest reply
  growing, the prompt box; "Now" (what the bot is doing, access in use); a waiting bot card shown as "A question is
  open on the bot. Answer it there." with no buttons; Start/Stop the bot when it is not running/running.
- Activity (`07` > Activity): `/v1/audit` timeline with outcome chips (`allowed`, `you said yes`, `you said no`,
  `refused: switched off`, `failed`), filters by who and date, a broken-chain banner from `/v1/audit/check`.
- Permissions (`07` > Permissions): rows per device and scope from `/v1/grants` with `Switch` (collect, only for
  `collectable` scopes) and `Segmented` (Mini); "always asks first" on `important` kinds; the one-line meaning when
  turning something on; the PC's bot permissions read-only from `/v1/mini` with "Change these in the bot"; Stop.
- Settings: theme, accent ("Follow my bot" or one of the named colours or a hex), density, privacy mode (blurs
  message previews until hover), the data folder path (read-only). Saved with `PATCH /v1/settings`.
- [ ] **Step 1: Failing tests**: `the Mini screen never shows Yes or No for a bot card`; `turning a scope to on calls PUT /v1/grants/:target/:scope`;
  `important scopes say always asks first`; `the activity banner shows when the chain is broken`; `changing theme sets data-theme`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).

### Task 14: Whole run, by hand

- [ ] **Step 1:** `npm test` and `npm run check` — all green.
- [ ] **Step 2:** `npm run dev`; open the printed address; check Home with seeded data in dark and light at 1280×800 and
  900×600; turn a grant on and off; press Stop and Resume; open Activity and see those rows.
- [ ] **Step 3:** With the owner's Mini Bot running, the Mini screen shows its real state and bot. Sending a prompt from
  the dashboard is the owner's call to make (it goes to their real session); do not send one without asking.
- [ ] **Step 4:** Search the tracked files for personal data and secrets (`03` > Keeping the repository clean) and
  report what was verified and what was not.

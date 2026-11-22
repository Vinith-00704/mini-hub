# Phase 2a: the phone joins the hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner asked to "connect the dashboard on the mobile first" and to have "dashboard features in my
mobile APK app". Deliver the first half of Phase 2 (`docs/10-build-plan.md`): the phone pairs with the hub on the
PC, keeps its own encrypted record, and syncs it over home Wi-Fi; the dashboard gets the Devices screen and the
phone's page and tile; the phone app gets its own screens (Home, Activity, Record, Permissions, Hub, Brain).
The only collector in this half is the phone's state (battery, charging, network). Calls, SMS, chats,
notifications, the Inbox and their tiles are the second half (Phase 2b), which needs trial T4 with the owner.

**Architecture:** The core opens a second listener, the **device link** (`wss://<private address>:47800/v1/link`,
TLS 1.3, the hub's own self-made certificate), only while a phone is paired or a pairing is under way. Pairing
follows `04` > "Pairing a device": QR code, pinned certificate hash, four matching words, the owner presses Pair,
the phone gets a 256-bit token once. The `android` connector turns link frames into events, device state and
commands. On the phone, one foreground service holds two parts, the bot (v1) and the link; the link keeps an
encrypted SQLite record (SQLCipher, key wrapped by the Android Keystore), numbers every event, and hands it over
in batches of at most 200 with acks, resuming from the hub's position after any break.

**Tech Stack:** Hub: Node 24, Fastify, `ws` (already under `@fastify/websocket`), `@peculiar/x509` (certificate),
`bonjour-service` (announcing `_minihub._tcp`), `qrcode` (dashboard). Phone: Kotlin, Android Views, OkHttp 5
(WebSocket), `net.zetetic:sqlcipher-android` with `androidx.sqlite`, `com.journeyapps:zxing-android-embedded`
(QR scanning, on the device only). Exact versions: the newest stable release at least two weeks old, checked at
install time (`npm view`, Maven Central) and written in the ledger.

**Spec:** `docs/04-data-and-sync.md` (pairing, link protocol, whose switches win), `docs/03-security-and-permissions.md`
(network, keys, tests 1, 5, 9, 12, stop), `docs/06-connectors.md` (`android`), `docs/07-dashboard-design.md`
(Devices), `docs/08-android-app.md` (record, screens, staying light), `docs/05-hub-api.md` (pairing routes).

## Global Constraints

- **The owner commits.** No task commits.
- Nothing is typed into the phone with `adb input`. Consent surfaces are the owner's: Windows' firewall prompt,
  Android's camera and permission dialogs, the four-word check and **Pair**.
- Test data is made up (`tools/seed.mjs` names, `+1 555 01xx`, `example.com`). The on-device trial uses a scratch hub
  (`tools/dev.mjs` with a temporary data folder), never the owner's real hub data.
- Pairing code: 128 random bits, valid 5 minutes, used once. Device token: 256 random bits, sent once; the hub keeps
  only its SHA-256. Five wrong tokens from one address close the link to it for 10 minutes.
- The link: TLS 1.3 only; listens only on private IPv4 addresses (10/8, 172.16/12, 192.168/16), port 47800; closed
  when no device is paired and no pairing is under way. The local API stays on `127.0.0.1`.
- Frames: JSON text, one object per frame, field `t`, version 1. `events` carries at most 200 items. Ping every 30 s;
  two missed close the link. A command's deadline is 30 s; `waiting` extends it to at most 2 minutes.
- A new phone starts with every collect, "Mini may use", "Mini on this phone" and "From my PC" switch **off**.
- The phone's switches win (`04`). A collect switch that is off on the phone means nothing of that kind is read,
  stored or sent. The phone's state frame leaves out battery, charging and network unless `phone.usage.read` is collected.
- A `stop` frame is never refused. On it the phone stops Mini on the phone and shows "Stopped from your PC".
- No log on either side contains a token, a pairing code, an event body or a full phone number.
- The phone links only while on Wi-Fi, and only to a hub whose certificate matches the pinned hash.

**Rulings made while planning** (each is a deviation from the spec's letter; the spec's aim is kept):

- Views, not Compose, as in v1. No Room: SQLCipher through its own `SQLiteOpenHelper` (no annotation processing,
  smaller app). Cost if wrong: a later move to Room.
- The hub's certificate and private key are kept in the encrypted database (`meta`), not in a separate file
  encrypted with the database key: the same protection, one place. Cost if wrong: none.
- The four words come from `SHA-256("minihub-pair-v1" | fp | code | phoneNonce)`, the nonce sent by the phone inside
  the pinned TLS session, rather than from TLS keying material (not reliably exposed on Android 13). A device that
  used the code first shows different words. Cost if wrong: a weaker check than an exporter-based one.
- The firewall rule comes from Windows' own prompt the first time the link listens (the owner chooses "Private
  networks"), not from a rule the app adds. Cost if wrong: the owner must find the rule if they click Cancel.
- The phone's Activity screen shows the phone's own audit rows (commands from the PC, stops, pairing) until
  `mini_action` arrives in Phase 3. The Settings screen waits for Phase 3.

## Review Focus

1. **The PC's address changes** (DHCP): the phone finds the hub again by `_minihub._tcp`, and still refuses any
   certificate that is not the pinned one.
2. **Wi-Fi drops in the middle of a batch**: the phone resends from the hub's `ackSeq + 1`; nothing is stored twice
   and nothing is missing.
3. **The phone is removed while it is connected**: the connection closes at once and the token never works again.
4. **A pairing code that has expired, was already used, or was cancelled**: refused, with words the owner understands
   on both screens.
5. **The hub restarts or the PC sleeps**: the certificate is the same, and the phone reconnects by itself with backoff
   (2 s doubling to 60 s) without draining the battery or holding a wake lock.

Each has a test in the task that owns it (marked **RF1**–**RF5**).

---

### Task 1: Protocol: link frames, pairing words, the pairing link

**Files:** create `protocol/src/link.ts`, `protocol/src/words.ts`, `protocol/examples/link/{valid,invalid}/*.json`,
`protocol/test/link.test.ts`; export from `protocol/src/index.ts`.

**Interfaces — Produces:** `linkFrame` (zod discriminated union on `t`: `hello`, `welcome`, `refused`, `pair`,
`paired`, `events`, `ack`, `gap`, `cmd`, `waiting`, `result`, `stop`, `stop-request`, `ping`, `pong`, `settings`,
`state`), `type LinkFrame`, `LINK_VERSION = 1`, `MAX_BATCH = 200`; `pairingWords(fp: string, code: string, nonce: string): string[]`
(four words from a 256-word list in `words.ts`); `pairingLink(p: {host, port, fp, code, name}): string` and
`parsePairingLink(uri: string): {host, port, fp, code, name}` (throws on another `v`). `pair` carries
`{ code, nonce, deviceName, model, appVersion }`; `paired` carries `{ deviceId, token, hubName }`.

- [ ] Write `link.test.ts`: "every valid example parses and every invalid one is refused" (reads both folders);
  "an events frame with 201 items is refused"; "the four words are the same for the same inputs and differ when the
  nonce differs"; "the words for example `pairing-words.json` are exactly the listed four"; "a pairing link
  round-trips, and v=2 is refused". Run `npm test -w protocol` — Expected: FAIL, module missing.
- [ ] Write the schemas, the word list (256 short, distinct, everyday English words) and the link helpers. The
  examples are the shared contract: the phone's tests (Task 7) read the same files.
- [ ] Run `npm test -w protocol` — Expected: PASS.

### Task 2: Hub: certificate, the device link, device tokens

**Files:** create `core/src/link/{cert.ts, addresses.ts, guard.ts, server.ts}`, `core/test/link.test.ts`; modify
`core/src/hub.ts`, `core/src/main.ts`, `core/package.json`.

**Interfaces — Produces:** `loadOrMakeCert(db: Store): { certPem: string; keyPem: string; fp: string }` (ECDSA
P-256, 10 years, `fp` = hex SHA-256 of the SPKI DER, kept in `meta`); `privateAddresses(ifaces): string[]` (pure);
`class Guard { allowed(addr): boolean; failed(addr): void; succeeded(addr): void }` (5 failures, 10 minutes);
`class DeviceLink` with `open(): Promise<void>`, `close(): Promise<void>`, `isOpen`, `send(deviceId, frame): boolean`,
`connected(deviceId): boolean`, `drop(deviceId): void`, `onFrame(fn: (deviceId, frame) => void)`,
`onPair(fn: (socket, frame, nonce) => void)`, and `opts { port (0 in tests), host override for tests, now }`. The link
announces `_minihub._tcp` with `name` and `fp` while open. `Hub` gains `link: DeviceLink` and `fp`.

- [ ] Write `link.test.ts`: "a client without a valid token is refused" (**test 9**: no `hello`, wrong token,
  unknown device — each gets `refused` and the socket closes); "five wrong tokens close the door to that address for
  ten minutes" (fake clock); "a removed device's token stops working and its open connection closes" (**test 5**,
  **RF3**); "TLS 1.2 is refused"; "the link listens only on private addresses" (`privateAddresses` on a made-up table
  with public, loopback, link-local and the three private ranges); "the certificate is the same after a restart"
  (**RF5**: two `loadOrMakeCert` calls on one store); "two missed pings close the link". Run `npm test -w core -- link`
  — Expected: FAIL.
- [ ] Implement. Token check: SHA-256 of the presented token compared with `timingSafeEqual` to `devices.token_hash`
  of a device that is not removed. The link opens when the hub starts if any phone is paired.
- [ ] Run `npm test -w core` — Expected: PASS, the earlier tests included.

### Task 3: Hub: pairing

**Files:** create `core/src/link/pairing.ts`, `core/src/api/routes/pairing.ts`, `core/test/pairing.test.ts`; modify
`core/src/api/server.ts`, `core/test/api.test.ts` (person-only rows).

**Interfaces — Consumes:** `DeviceLink.onPair`, `pairingWords`, `pairingLink`. **Produces:** `class Pairing` with
`start(): { qr: string; address: string; code: string; expiresAt: number }`, `current(): { state: 'waiting' |
'check' | 'done' | 'expired' | 'cancelled'; words?: string[]; deviceName?: string; deviceId?: string } | null`,
`confirm(): string` (the new device id), `cancel()`; routes `POST/GET /v1/pairing`, `POST /v1/pairing/confirm`,
`POST /v1/pairing/cancel` (person only, audited without the code); live topic `devices` on every change.

- [ ] Write `pairing.test.ts`: "a pairing code works once and only for five minutes" (**RF4**: second use, expired,
  cancelled each refused with `refused { reason }` in plain words); "the device gets its token only after the owner
  presses Pair, and the hub keeps only its hash"; "the words on the hub are the words the phone computes"; "a new
  phone starts with every switch off" (all `phone.*` collect and mini off for the new id); "one pairing at a time:
  a second start replaces the first". In `api.test.ts` add pairing and its confirm/cancel to the **test 1** table.
  Run — Expected: FAIL.
- [ ] Implement. The device: `connector_id 'android'`, `kind 'phone'`, name from `deviceName`, info `{ model, appVersion }`.
  The QR's address prefers a `192.168.` address, else the first private one.
- [ ] Run `npm test -w core` — Expected: PASS.

### Task 4: Hub: the `android` connector — sync, settings, stop, status

**Files:** create `core/src/connectors/android.ts`, `core/test/android.test.ts`; modify `core/src/hub.ts`,
`core/src/api/routes/{rules.ts, devices.ts}`.

**Interfaces — Consumes:** `DeviceLink`, `Events.add(deviceId, seq, e)`, `DeviceStore`. **Produces:**
`androidConnector(link: DeviceLink, deps): Connector` (manifest per `06`: scopes `phone.*`, event types, widgets
`device-status`; action `status`, scope `phone.usage.read`, risk read); `DELETE /v1/devices/:id` with
`{ deleteEvents?: boolean }` (person only): token hash cleared, `removed_at` set, `link.drop`, events deleted when asked.

- [ ] Write `android.test.ts`: "a resent batch is stored once" (**RF2**); "an out-of-order batch is answered with the
  hub's real position"; "10,000 events with the connection dropped midway end as exactly 10,000, in order" (**T3**
  in process, with a fake phone client over the real link); "a gap is recorded in sync_state"; "a collect change on
  the dashboard reaches the phone as settings with a new rev"; "Stop Mini sends stop to every linked phone and nothing
  else is needed for it"; "status goes to the phone and its answer comes back; no answer in 30 s fails; waiting
  extends to at most 2 minutes"; "a not-allowed answer from the phone reaches the agent as 403 with the scope"
  (**test 13**, hub half); "grants are per device: turning usage on for one phone does not open another" (**test 12**);
  "the state frame updates the device and tells the dashboard". Run — Expected: FAIL.
- [ ] Implement. `welcome` carries `ackSeq` from `sync_state.last_seq` and the hub's copy of the device's collect
  switches; a batch goes into one transaction; `sync_state.last_sync_at` is set; `devices.last_seen_at` on every frame.
  `hub.stopMini` also calls `link.send(id, {t:'stop'})` for each connected phone. `stop-request` from a phone runs
  `hub.stopMini` audited as caller `device`.
- [ ] Run `npm test -w core` — Expected: PASS.

### Task 5: Dashboard: Devices, Add phone, the phone's page, the status tile

**Files:** create `ui/src/features/devices/{Devices.tsx, AddPhone.tsx, DevicePage.tsx}`,
`ui/src/widgets/DeviceStatus.tsx`, `ui/test/devices.test.tsx`; modify `ui/src/app/{router.tsx, api.ts, queries.ts}`,
`ui/src/features/frame/Frame.tsx` (nav item), the Home board's tile list, `tools/seed.mjs` (one made-up phone).

**Interfaces — Consumes:** the routes from Tasks 3–4, `GET /v1/grants`. **Produces:** routes `/devices` and
`/devices/$id`.

Layout and words follow `07` > Devices. Add phone: step 1 the QR (SVG from `qrcode`), the address and code to type,
"Valid for 5 minutes", and one line: "Windows may ask whether Mini Hub can use private networks. Choose Allow." Step 2
the four words, large, "Do these match the words on your phone?", **Pair** and **Cancel**. Done: the phone's page,
with "What should this phone share?" above its switches, all off. The phone's page: Status (online dot, battery,
charging, network, last sync, app version), What it shares, What Mini may do with it, the phone's own two lists
(read-only, "as the phone last reported"), Actions (Check status now), Remove (confirm, "also delete what it sent").

- [ ] Write `devices.test.tsx`: "Add device shows the QR, then the four words, and Pair confirms"; "an expired code
  offers a new one"; "the new phone's page shows every switch off"; "Remove asks, and can delete what it sent";
  "the phone's own lists are shown and cannot be changed here"; "the status tile shows battery and last seen, and
  'Not at home' when offline". Run `npm test -w ui` — Expected: FAIL.
- [ ] Implement, in both themes, using the existing tokens and components.
- [ ] Run `npm test -w ui` and `npm run build -w ui` — Expected: PASS. Look at both themes in a browser with the
  seeded data (`tools/dev.mjs`), as in Phase 1.

### Task 6: Phone: the record and the switches

**Files:** create `android/app/src/main/java/app/minihub/phone/data/{DbKey.kt, RecordDb.kt, Record.kt}`,
`consent/{Switches.kt, Audit.kt}`, `collect/DeviceState.kt`; tests `app/src/test/.../{SwitchesTest.kt,
DeviceStateTest.kt}`; modify `app/build.gradle.kts` (dependencies; debug `applicationIdSuffix = ".trial"` so a
trial build installs beside the owner's app).

**Interfaces — Produces:** `Record.add(e: NewEvent): Long?` (the new `seq`, or null when collecting is off: the only
door in); `Record.after(seq: Long, limit: Int): List<StoredEvent>`; `Record.latestSeq()`, `search(q, limit)`,
`delete(seqs)`, `countsSince(time)`; `Switches` with `collect(scope)`, `mini(scope)`, `pc(scope)`, `setters`,
`lockedOnPhone`, `onChange`; `Audit.add(who, action, scope?, outcome)`; `DeviceState.reading(level, scale, plugged,
network): StateReading?` (battery rounded down to 5%; null when nothing changed). Events deleted by the owner are
deleted on the phone; if not yet sent, a `gap` is reported for them.

- [ ] Write the tests: "with collect off nothing is stored"; "the battery is reported in steps of five and only when
  the step changes"; "every switch starts off"; "a locked phone ignores a collect change from the hub". The database
  itself runs only on the device: its checks are in Task 9. Run `./gradlew :app:testDebugUnitTest` — Expected: FAIL.
- [ ] Implement. `Record`'s SQL sits behind a small interface so its logic is tested with an in-memory fake. The
  database key: 32 random bytes, wrapped with an AES-GCM Keystore key `mini-record`, kept in `noBackupFilesDir`.
- [ ] Run `./gradlew :app:testDebugUnitTest` — Expected: PASS.

### Task 7: Phone: the link

**Files:** create `link/{Frames.kt, Words.kt, PairingLink.kt, Pin.kt, Sync.kt, LinkClient.kt, Discovery.kt,
Commands.kt}`; tests `FramesTest.kt` (reads `../../protocol/examples/link`), `PinTest.kt`, `SyncTest.kt`,
`CommandsTest.kt`; modify `MiniService.kt` (two parts: bot and link; the notification says what is on, e.g. "Mini:
linked to your PC · bot shown"), `AndroidManifest.xml` (`CAMERA`, network state, Wi-Fi state).

**Interfaces — Consumes:** Task 1's examples and words, Task 6's `Record`, `Switches`, `Audit`. **Produces:**
`PinnedTrust(fpHex): X509TrustManager` (accepts only a leaf whose SPKI SHA-256 matches); `Sync` (pure: `welcome(ackSeq)`,
`ack(seq)`, `next(): List<StoredEvent>?`, at most 200, from `ackSeq + 1`); `Commands.handle(cmd, switches, ask):
Answer` (`not-allowed` for off; `waiting` then the owner's answer for ask, through a notification with Yes and No;
runs for on; `stop` always runs); `LinkClient` (OkHttp WebSocket, only on Wi-Fi, backoff 2 s doubling to 60 s, no
wake lock, JSON ping every 30 s, two missed close); `Discovery` (NsdManager, on network change and every 15 minutes
on Wi-Fi, falling back to the saved address). The token and the hub's address, name and `fp` are kept wrapped by a
Keystore key, never logged.

- [ ] Write the tests: "every valid example parses and every invalid one is refused" and "the pairing words match
  `pairing-words.json`" (the same files as the hub); "a certificate with another key is refused" (**test 9**, phone
  half); "after a break the phone resends from ackSeq + 1" and "an ack for an older position restarts from there"
  (**RF2**); "a command whose From my PC switch is off is refused, whoever started it" (**test 13**); "an important
  command with approved false is always asked"; "stop is never refused"; "backoff doubles to 60 s and resets after a
  good connection" (**RF5**). Run `./gradlew :app:testDebugUnitTest` — Expected: FAIL.
- [ ] Implement. On `stop`: the bot part runs `stop-mini.sh`, the panel shows "Stopped from your PC", and the phone's
  stop state is set until the owner resumes on the phone.
- [ ] Run `./gradlew :app:testDebugUnitTest` — Expected: PASS.

### Task 8: Phone: the app's screens

**Files:** create `ui/{Kit.kt, HomeScreen.kt, ActivityScreen.kt, RecordScreen.kt, PermissionsScreen.kt, HubScreen.kt,
BrainScreen.kt}`; modify `MainActivity.kt` (bottom navigation for Home, Activity, Record, Permissions; a menu for Hub
and Brain); move v1's setup list into `BrainScreen.kt` unchanged.

Per `08` > The app's own screens, in the look of `07` (the dashboard's tokens, the same bot):

- **Home**: the bot and its state, a box to ask Mini, today's counts by kind, the hub's state ("Synced 2 min ago",
  "Not at home: 143 waiting", "Not paired" with a Pair button).
- **Activity**: the phone's audit rows, newest first ("Your PC asked for the status: allowed").
- **Record**: what has been recorded, searchable, with delete (confirm).
- **Permissions**: one row per phone scope with Collect (on/off), Mini on this phone (off/ask/on) and From my PC
  (off/ask/on); "Only change these on the phone"; Stop (and "Stop on my PC too" while linked).
- **Hub**: Pair with a hub (scan, or type the address and code; the camera is asked for only here), the four words
  and "Check they match the words on your PC", the paired hub, Sync now, Forget this hub (confirm).
- **Brain**: v1's setup steps and Start/Stop.

- [ ] Write `ScreensTest.kt` for the pure parts: "the hub line reads 'Synced 2 min ago' / 'Not at home: 143
  waiting' / 'Not paired'"; "counts group by kind for today". Run — Expected: FAIL.
- [ ] Implement.
- [ ] Run `./gradlew :app:testDebugUnitTest :app:assembleRelease` — Expected: PASS and an APK.

### Task 9: Build, install, pair with the owner, and trial T3 on the real devices

Not a code task; the owner is at both screens.

- [ ] Start a scratch hub: `node tools/dev.mjs` with a temporary data folder. Install the release APK over v1
  (`adb install -r`), and the debug build (`app.minihub.phone.trial`) for the trial.
- [ ] The owner: Devices > Add device > Phone on the dashboard; on the phone Hub > Pair, scan, compare the words,
  press Pair; allow Windows' prompt for private networks if it appears.
- [ ] Check, and write down: battery and network show on the dashboard within 5 s of a change; switching a collect
  switch on the dashboard reaches the phone; Stop Mini on the dashboard shows "Stopped from your PC"; removing the
  phone stops it syncing at once; on the device, the record file is not readable as plain SQLite.
- [ ] T3: the trial build sends 10,000 made-up events; the owner switches Wi-Fi off and on midway; the scratch hub
  ends with exactly 10,000. Then the trial app is uninstalled and the scratch folder deleted.
- [ ] Measure the app's memory and the battery over the day; run the secrets search of `03` > "Keeping the repository clean".
- [ ] Final review of the phone app (v1 and this plan together) and of the hub changes; one fix pass; report the rulings.
  Tell the owner how to pair with their real hub (the installed Mini Hub) once they choose to.

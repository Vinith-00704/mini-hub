# 04. Data and sync

## The hub's database

One SQLCipher file, `hub.db`, in the data folder. Migrations are numbered `.sql` files in `core/src/store/migrations/`,
applied in order at start; the current number is kept in `meta`. Times are milliseconds since 1970, UTC.

```sql
-- Small facts about this installation: schema version, hub id, hub name, when it was made.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- One row per connector the hub knows. Settings are the non-secret choices; secrets are separate.
CREATE TABLE connectors (
  id            TEXT PRIMARY KEY,            -- 'pc' | 'mini' | 'android' | 'mail' | 'home' | 'alexa'
  enabled       INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at    INTEGER NOT NULL
);
CREATE TABLE secrets (
  connector_id TEXT NOT NULL REFERENCES connectors(id),
  name         TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (connector_id, name)
);

-- Anything that can be shown as a device: this PC, a phone, a mail account, a lamp, the Echo Dot.
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,             -- a random id made by the hub
  connector_id TEXT NOT NULL REFERENCES connectors(id),
  kind         TEXT NOT NULL,                -- 'pc' | 'phone' | 'mail-account' | 'speaker' | 'light' | 'plug' | 'sensor' | ...
  name         TEXT NOT NULL,                -- the owner's name for it
  room         TEXT,
  info_json    TEXT NOT NULL DEFAULT '{}',   -- model, software version, capabilities
  state_json   TEXT NOT NULL DEFAULT '{}',   -- the latest known state: battery, on/off, online
  token_hash   TEXT,                         -- for devices that connect to the link
  added_at     INTEGER NOT NULL,
  last_seen_at INTEGER,
  removed_at   INTEGER
);

-- Everything that happened, from every source. One table on purpose: a new kind of device adds a type, not a table.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id),
  seq         INTEGER NOT NULL,              -- the device's own counter; the hub's own events count from 1 too
  type        TEXT NOT NULL,                 -- see "Event types"
  occurred_at INTEGER NOT NULL,              -- on the device's clock
  received_at INTEGER NOT NULL,              -- on the hub's clock
  who         TEXT,                          -- the other party, as the device named it: a contact name, an address
  who_key     TEXT,                          -- a stable key for the same party: a normalized number or address
  app         TEXT,                          -- the app or account it came through
  title       TEXT,                          -- one line for lists
  body        TEXT,                          -- the text, if any
  data_json   TEXT NOT NULL DEFAULT '{}',    -- the rest, by type
  seen_at     INTEGER,                       -- when the owner marked it read in the dashboard
  UNIQUE (device_id, seq)
);
CREATE INDEX events_time ON events (occurred_at DESC);
CREATE INDEX events_type_time ON events (type, occurred_at DESC);
CREATE INDEX events_who ON events (who_key, occurred_at DESC);
CREATE VIRTUAL TABLE events_fts USING fts5 (who, title, body, content='events', content_rowid='id');

-- How far each device's record has been taken in.
CREATE TABLE sync_state (
  device_id      TEXT PRIMARY KEY REFERENCES devices(id),
  last_seq       INTEGER NOT NULL DEFAULT 0,
  last_sync_at   INTEGER,
  gaps_json      TEXT NOT NULL DEFAULT '[]'  -- ranges the device said it had to drop
);

-- Collect and "Mini may use", per target and scope (see 03). The target is a device id, or a connector id for
-- connectors whose devices share one decision ('home', 'alexa'). A missing row means off.
CREATE TABLE collect (
  target TEXT NOT NULL, scope TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (target, scope)
);
CREATE TABLE grants (
  target TEXT NOT NULL, scope TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('off','ask','on')),
  voice_safe INTEGER NOT NULL DEFAULT 0,     -- "safe by voice", for scopes the Echo Dot could trigger
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (target, scope)
);

-- The hub's own approvals: always asked by the agent, always answered in the dashboard. The phone keeps its own.
CREATE TABLE approvals (
  id           TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  scope        TEXT NOT NULL,
  risk         TEXT NOT NULL,
  device_id    TEXT,
  action       TEXT NOT NULL,
  args_json    TEXT NOT NULL,                -- exactly what will be done
  summary      TEXT NOT NULL,                -- the plain-words question shown to the owner
  state        TEXT NOT NULL CHECK (state IN ('waiting','yes','no','expired')),
  decided_at   INTEGER
);

CREATE TABLE audit (
  id        INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL,
  caller    TEXT NOT NULL,                   -- 'person' | 'agent' | 'device' | 'voice' | 'system'
  detail    TEXT,                            -- which device, which surface
  action    TEXT NOT NULL,                   -- 'read' | 'act' | 'grant' | 'approve' | 'pair' | 'remove' | 'stop' | ...
  target    TEXT,
  scope     TEXT,
  risk      TEXT,
  outcome   TEXT NOT NULL,                   -- 'done' | 'refused' | 'failed' | 'waiting'
  data_json TEXT NOT NULL DEFAULT '{}',      -- ids and counts, never message text
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
);

-- The dashboard's own arrangement.
CREATE TABLE boards (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  layout_json TEXT NOT NULL                  -- widgets with their grid positions and their own settings
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
```

`who_key` lets the Inbox group a person's calls, SMS and chat messages together when the phone can tell they are the
same contact. The phone resolves names from its own contacts before sending; the hub keeps no contact list.

## Event types

The canonical list; `protocol/src/events.ts` holds the exact shapes and `protocol/examples/` one example of each.

| Type | From | Scope (collect, and the agent's reading) | `who` | `title` / `body` | `data_json` |
|---|---|---|---|---|---|
| `call` | phone | `phone.calls.read` | The other party | "Missed call", "Incoming, 4 min" | `direction` in/out/missed/rejected, `seconds` |
| `sms` | phone | `phone.messages.read` | The other party | The text | `direction`, `thread` |
| `chat` | phone, from a chat app's notification | `phone.messages.read` | Sender as the notification named them | The text | `conversation` (the group or chat title), `canReply`, `notificationKey`, `package`, `group` |
| `notification` | phone | `phone.notifications.read` | n/a | Title and text | `category`, `package`, `notificationKey`, `ongoing` (always false: ongoing notifications are never recorded) |
| `mail` | mail connector | `mail.read` | Sender (name, else address; `who_key` the address in lower case) | Subject, or "(no subject)" / the text as Settings > Data says (none, the first 2,000 characters, or the first 20,000) | `account` (the mail device's id), `folder` (`INBOX`), `uid`, `uidValidity`, `messageId`, `hasAttachments`, `attachments` (at most 20: `name`, `type`, `size`; listed, never downloaded), `unread`, `to` and `cc` (at most 10 addresses each) |
| `device_state` | any device | The device's status scope: `phone.usage.read`, `pc.status.read`, `home.read` | n/a | "Battery 20%", "Came online" | The changed fields |
| `app_usage` | phone, once a day | `phone.usage.read` | n/a | n/a | Minutes per app for the day |
| `home_state` | home connector | `home.read` | n/a | "Bedroom lamp on" | `property`, `value`, `cause` |
| `mini_action` | the hub, the phone app | Always collected. The agent reads only its own. | n/a | What Mini did, in a line, with counts only: never a name, a number or text from the record | `tool`, `scope`, `scopes`, `risk`, `outcome` (`done`, `refused`, `failed`), `reason` (a refusal's cause; the phone's are `not-allowed`, `not-collected`, `said-no`, `expired`, `stopped`, `unknown-tool`, `bad-args`), `approvalId`, `count`, `on` (`pc` or `phone`) |
| `voice_request` | alexa connector | Always collected while that connector is on. Person only. | n/a | What was asked | `answered` |
| `system` | any | Always collected. Person only. | n/a | "Dropped 1,204 old events to stay under the size limit" | n/a |

Collecting a type is governed by its scope's **collect** switch for that device (`03`). A type whose switch is
off is neither stored on the phone nor sent.

The shapes of `data` for `call`, `sms`, `chat`, `notification` and `mini_action` are written down in `protocol/src/events.ts`
(`EVENT_DATA`) for both sides to follow. They are a contract, not a gate: the hub never refuses an event over the
shape of its `data`, because a refusal would stall the phone's sync. The call log's SIM slot (`sim`) is not
recorded; it needs another permission.

## What is kept, and for how long

| Where | Default | Owner can set |
|---|---|---|
| Hub: events | Kept until deleted (for ever) | Keep 30 days, 90 days, a year, or for ever, per type (`call`, `sms`, `chat`, `notification`, `mail`, `device_state`, `mini_action`, `system`) |
| Hub: mail bodies | The first 2,000 characters of text (`extract`); attachments are not downloaded | Subjects only (`subjects`); or full text (`full`, at most 20,000 characters) |
| Hub: audit log | A year (`1y`) | Two years (`2y`), or for ever |
| Phone: events not yet handed over | Up to 200 MB, then the oldest go, with a `system` event saying so | The size |
| Phone: events already handed over | 7 days, so the phone app can still show recent history | 1 to 30 days |

The hub's choices are kept under the settings key `retention` as `{ events: { <type>: "forever" | "30d" | "90d" |
"1y" }, audit: "1y" | "2y" | "forever", mailBody: "subjects" | "extract" | "full" }`; a type not named is kept for
ever. A change takes effect at the next run, not at once.

**Pruning** runs a minute after the hub starts and then every 6 hours. For each type with a limit it deletes the
events whose `occurred_at` is older than 30, 90 or 365 days, 5,000 rows to a transaction. If any went, the hub
writes one `system` event, "Removed <n> old items, as set in Settings > Data" (no text from the items), and an
audit row (`system`, `prune`, `{ count, types }`). Audit rows older than one or two years go in one transaction: the
hash of the newest row removed is kept in `meta` as `auditAnchor`, every row up to it is deleted, and a `system`
audit row `prune-audit` with `{ count }` follows. The chain check starts from the anchor (`03` > The audit log).

Deleting in the dashboard deletes from the hub: chosen items, or every item of some kinds (Settings > Data). The
owner can also delete "everything from this device" when removing it.

### The backup

Settings > Data writes a backup to a file the owner picks (ending `.minihub`; files of this name are ignored by
git), protected by a passphrase the owner types (10 to 200 characters), not by the database key, so it restores on
a new PC. The passphrase and the path are never stored, logged or audited; the audit rows `export` and `import`
carry counts only. A path inside the data folder is allowed.

- **Format.** Bytes 0–3 the ASCII `MHX1`; 4–19 a random salt; 20–31 a random IV; then the ciphertext; the last 16
  bytes the GCM tag. Key = `scrypt(passphrase (UTF-8), salt, 32, { N: 65536, r: 8, p: 1 })`; AES-256-GCM with bytes
  0–31 as additional data. The plaintext is gzip of UTF-8 NDJSON, one object per line, in this order: a header
  `{ kind: "header", format: "minihub-export", version: 1, hubVersion, exportedAt, counts }`; `setting` lines
  `{ kind, key, value }` for `ui` and `retention`; `device` lines `{ kind, device: { id, connectorId, kind, name,
  room, info, addedAt, removedAt } }` (the device sits in its own object because its `kind` is not the line's);
  `board` lines `{ kind, id, name, position, layout }`; `event` lines `{ kind, deviceId, seq, type, occurredAt,
  receivedAt, who, whoKey, app, title, body, data, seenAt }`. The database is read a page at a time, never whole in
  memory, and the file is written beside the target (`<path>.<pid>.tmp`) and renamed over it when complete. An
  export with no events is still a valid file.
- **What it carries:** events, devices (without their tokens or state; a mail account's info never has its
  password), boards, and the dashboard's settings (`ui`, `retention`). **What it does not:** secrets, device
  tokens, the hub's certificate, collect switches and grants, approvals, pairings or the audit log.
- **Restoring** reads the file twice. Pass 1 checks the header (`MHX1`, else "This is not a Mini Hub backup.") and
  runs the whole ciphertext through the decipher with the output thrown away; a failed tag is "The passphrase is
  wrong, or the file is damaged." and nothing is written. Pass 2 reads it again and applies it in transactions of
  500 rows: a header with a newer `version` is refused before anything is applied ("This backup is from a newer
  Mini Hub."); settings are replaced; a device is added if its id is missing, marked removed (a phone is paired
  again, a mail account added again), except the hub's own device (id `hub`); a device already there is left as it is, and
  this PC (`pc`) is never added again; a board replaces the one with its id, new ones go at the end, 20 in all (the
  rest are counted as `boardsLeftOut`); an event is added unless its `(device_id, seq)` is already there, written
  directly (Collect is not checked: it is the owner's own restore). Each device's numbering (`meta seq:<device>`,
  `hubSeq`) is moved to at least the highest number restored, so new events are never taken for repeats. If the
  file changes between the passes or the tag fails at the end of pass 2, the answer is "The file changed while it
  was being read. Import it again." A restore that fails in pass 2 for any reason takes back what it had applied
  (the events and devices it added, the boards and settings as they were; only the numbering stays moved on, which
  never loses an event), so a failed restore changes nothing. If taking back fails too, the answer is "The restore
  stopped partway, and some of it could not be taken back. Import it again."; importing again completes it, since a
  second import adds nothing twice. A file that cannot be read is "The file could not be read.", a full disk
  "There is not enough space to restore.", another database failure "The restore did not work. Nothing was
  changed."; the hub's log gets the error's code only. A second import adds nothing twice.
- **After a restore** every switch is as it was on this hub (off on a new one): nothing in the file is read as a
  grant, collect switch, approval, secret, token or audit row. Restore into a clean data folder to get every event
  back: on a hub that already numbered its own notes, an imported event with the same `(device_id, seq)` is
  skipped and counted as such.

## Pairing a device

Done once per device, with the owner at both screens.

1. Dashboard > Devices > **Add device** > Phone. The core opens the device link if it was closed, makes a
   one-time code (128 random bits, valid 5 minutes), and shows a QR code:
   `minihub://pair?v=1&host=<address>:47800&fp=<hash of the hub certificate's public key>&code=<code>&name=<hub name>`.
2. In the phone app, **Pair with a hub** scans it (or the owner types the address and code).
3. The phone app connects over TLS, refuses to go on unless the certificate matches `fp`, and sends
   `pair { code, deviceName, model, appVersion }`.
4. Both screens show the same **four words**, worked out from the TLS session. The owner checks they match and
   presses **Pair** on the dashboard. This stops another device on the network from stepping in between.
5. The core makes the device's token (256 random bits), stores its hash, and sends the token once. The phone app
   puts it in the Android Keystore with the hub's address, name and certificate hash.
6. The dashboard opens the new device's page with every collect and "Mini may use" switch **off**, ready to be chosen.

Removing a device deletes its token hash and closes its connection. Pairing again makes a new token.

## The link protocol

A WebSocket at `wss://<hub>:47800/v1/link`, JSON text frames, one object per frame, each with `t` (its kind).
Version 1. The shapes live in `protocol/src/link.ts`.

### Opening

```
phone -> { t:"hello", v:1, deviceId, token, appVersion, lastSeq, time }
hub   -> { t:"welcome", v:1, ackSeq, time, collect:{...}, settingsRev }      // or { t:"refused", reason, code? }
```

`lastSeq` is the phone's newest sequence number, `ackSeq` the highest the hub has stored. `collect` is the hub's
copy of the collect switches for this device; see "Whose switches win".

A `refused` carries a plain `reason` for the owner and, from newer hubs, a `code` the phone acts on. A `refused`
without `code` (an older hub) means `not-paired`.

| `code` | Meant | What the phone does |
|---|---|---|
| `not-paired` | The hub does not know this device or its token (wrong token, or the device was removed) | Shows the reason and does not retry; the owner pairs again |
| `locked-out` | Five wrong tokens from this address | Shows "not at home" and retries once after 10 minutes |
| `bad-frame` | The hub got a frame it could not read, or one before hello | Reconnects with the normal back-off |

### Handing over the record

```
phone -> { t:"events", from, items:[ { seq, type, occurredAt, who, whoKey, app, title, body, data } ... ] }   // at most 200, in order
hub   -> { t:"ack", seq }                                                    // everything up to seq is stored
phone -> { t:"gap", from, to, reason }                                       // events the phone had to drop
```

A gap's `reason` is a short plain line the dashboard shows, for example "deleted or not shared on the phone before
it was sent" (the owner deleted them, or turned that kind's switch off, before the hub had them).

- The phone sends from `ackSeq + 1`, waits for each `ack`, and goes on until it has caught up. Then it sends
  each new event as it happens, alone or in small batches.
- The hub stores a batch in one transaction and ignores any `(deviceId, seq)` it already has, so a resend is harmless.
- `events` out of order (a `from` that is not `ackSeq + 1`) is answered with `ack` of the hub's real position, and the phone restarts from there.
- Paired again with the same hub (removed on the dashboard, or forgotten on the phone, then paired again): the hub
  gives the phone a new id, so its `ackSeq` starts at 0. The phone keeps the hub's last `ack` by the hub's
  certificate, and on the first link of the new pairing it sends a gap up to that number first ("already sent to
  this PC before it was paired again"), so what the hub already has is not sent twice.

### Commands

```
hub   -> { t:"cmd", id, name, args, origin:"person"|"agent", approved:true|false, approvalId? }
phone -> { t:"waiting", id, until }                                          // the phone is asking its owner
phone -> { t:"result", id, ok:true, data } | { t:"result", id, ok:false, error, code }
hub   -> { t:"stop" }                                                        // Stop Mini: never refused
phone -> { t:"stop-request" }                                                // "Stop on my PC too"
```

- `name` is one of the phone's actions (`06-connectors.md`).
- `origin` says who started it on the hub; `approved` says the owner pressed it themselves or approved it on the
  dashboard, with `approvalId` when there was one.
- The phone app checks its own **"From my PC"** switch for the action's scope, whatever the hub says:
  **off** answers `code:"not-allowed"`; **ask** shows the phone's own approval and answers `waiting`, then the
  result; **on** runs it. An `important` action with `approved:false` is always asked about on the phone.
- A command has a deadline of 30 seconds. A `waiting` answer moves the deadline to `until` (at most 2 minutes,
  the same as an approval's life). No answer by the deadline is a failure. Commands are never stored for later.
- `origin`, `approved` and `approvalId` go into the phone's own log.

### Staying connected

```
either -> { t:"ping", time }      other -> { t:"pong", time }      // every 30 seconds; two missed closes the link
hub    -> { t:"settings", rev, collect:{...} }                     // when the owner changes a collect switch on the dashboard
phone  -> { t:"state", battery, charging, network, brain:"ok"|"asleep"|"broken", controlling:false, stopped:false,
            collect?, needs?:{ scope: "permission"|"notification-access"|"apps" },
            lists:{ mini:{ scope: state }, pc:{ scope: state } } }                                    // when it changes
```

`needs` is set by the phone only for a scope whose collect switch is on and for which **no** source can run. Its
value is the first thing missing, in the order `permission` (Android's permission), `notification-access`, `apps`
(no app ticked in "Apps to include"). The dashboard shows it so the owner knows what to do on the phone.

### Finding the hub

- The core announces `_minihub._tcp` on the home network with its name and port. The phone app looks for it when
  the network changes and every 15 minutes while on Wi-Fi, and falls back to the address saved at pairing.
- The phone app never needs the Wi-Fi's name, so it needs no location permission for this.
- It connects only to a hub whose certificate matches the pinned hash. Anything else on that address is ignored.

## Whose switches win

The phone is the owner's most personal device, so **the phone's own switches are the limit**.

- Collect: the phone app has the switches; the dashboard shows them and can ask to change one. A change made on
  the dashboard reaches the phone as `settings` and takes effect only if the phone is not set to "only change
  these on the phone" (off by default, so the dashboard works; the owner can lock it).
  A `settings` the phone does not take (locked, or not newer than the last one it took) is answered with its
  `state`, so the hub's copy always shows what the phone really collects. A new pairing numbers `settings` from
  the start again on both sides.
- The three lists in `03` each live where they protect: "Mini may use" on the hub; "Mini on this phone" and "From
  my PC" on the phone. The hub shows the phone's two lists read-only, as the phone last reported them, so the
  owner can see on the dashboard why a command would be refused.
- An action on the phone needs the phone to agree as well as the hub (`03`, Approvals).

The phone's own tables mirror the hub's: `collect(scope, enabled)`, `grants(list, scope, state)` with `list` being
`mini` or `pc`, `approvals` (with `asker`: `mini` or `pc`), `audit`, `events`.

## Left to the builder

- The exact JSON of each event's `data` beyond the fields named here.
- Indexes beyond those listed, once real queries show what is slow.
- The word list and the derivation for the four pairing words (any standard short-authentication-string scheme).

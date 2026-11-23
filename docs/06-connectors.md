# 06. Connectors

A connector links one kind of device or account to the hub. It brings events in, offers actions, and tells the
dashboard which widgets it can feed. Connectors are code in this repository (`core/src/connectors/<id>/`), built
into the core. Nothing is loaded from outside at run time.

## Two ways to "add a device"

| The owner wants to | What happens |
|---|---|
| Add another device of a kind the hub knows (a second phone, another mail account, a new lamp) | Dashboard > Devices > **Add device**, pick the kind, follow its steps. No code. |
| Add a kind of device the hub does not know yet (a smart watch, a TV, a car, a camera) | A new connector is written: one folder in the core, its scopes and event types added to the protocol, and its widgets in the dashboard. The checklist is at the end of this page. |

A **generic connector** is planned for the last phase, for simple gadgets that speak a common language (a web
address to call, or MQTT), so that many small devices need no new code.

## The interface

```ts
export interface Connector {
  manifest: {
    id: string                       // 'android'
    name: string                     // 'Android phone'
    kind: 'device' | 'account' | 'service'
    icon: string                     // a Lucide icon name
    scopes: ScopeDef[]               // what can be collected and granted; ids start with a prefix this connector owns
    eventTypes: string[]             // the event types it emits
    widgets: string[]                // widget ids in the dashboard that it can feed
    multiple: boolean                // may there be more than one device of this kind
  }

  /**
   * Guided setup, one step at a time (optional). Each step says what to show and what to ask. `session` is the hub's id
   * for this run of the wizard (it lasts 15 minutes); anything held between steps, such as a password not yet saved, is
   * kept under it, in memory only. The connector drops everything unsaved for that session when it answers `done` or
   * `error`, and when it is called with `step: 'cancel'`. The hub sends `cancel` whenever a run ends: the owner
   * cancelled or started again, the 15 minutes ran out (also while a step was still under way), a step failed, and
   * after `done` and `error` too, so a second `cancel` for the same session must be harmless.
   */
  setup?(ctx: Ctx, session: string, step: string | null, input: unknown): Promise<SetupStep>

  /** The owner removed one of this connector's devices: stop using it and forget its settings and secrets (optional). */
  remove?(deviceId: string): Promise<void>

  start(ctx: Ctx): Promise<void>
  stop(): Promise<void>
  health(): { state: 'ok' | 'degraded' | 'down' | 'off'; note?: string }

  /** What can be done. Risk and scope are fixed here, in code. */
  actions: Record<string, {
    title: string
    scope: string
    risk: 'read' | 'act' | 'important'
    args: ZodType
    /** A plain-words question for the approval, built from the real arguments. Required for 'act' and 'important'. */
    describe(args: unknown, device?: Device): string
    run(args: unknown, device?: Device, how?: { origin: 'person' | 'agent'; approved: boolean; approvalId?: string }): Promise<unknown>
  }>
}

export interface Ctx {
  emit(event: NewEvent & { deviceId: string }): void  // stores it (if its collect switch is on) and tells the dashboard
  devices: { upsert(d: DeviceInput): Device; setState(id: string, state: object): void; list(): Device[]; get(id: string): Device | undefined }
  // This connector's own settings (`connectors.settings_json`); `set` merges one level deep, a key set to undefined goes.
  settings: { get(): Record<string, unknown>; set(patch: Record<string, unknown>): void }
  // This connector's own secrets, only in the encrypted database's `secrets` table. Never logged or returned.
  secrets: { get(name: string): string | undefined; set(name: string, value: string): void; delete(name: string): void }
  // Read only: whether a device's collect switch for a scope is on, and a call when any switch changes.
  grants: { collecting(deviceId: string, scope: ScopeId): boolean; onChange(fn: () => void): () => void }
  log: Logger                                 // redacting
  signal: AbortSignal                         // fires on stop and on Stop Mini
}

export type Field = {
  name: string
  label: string
  kind: 'text' | 'email' | 'password' | 'number' | 'choice'
  required: boolean
  value?: string | number                     // a starting value; never a password
  hint?: string
  choices?: Array<{ value: string; label: string }>
}

export type SetupStep =
  | { kind: 'form'; id: string; title: string; text: string; fields: Field[]; error?: string }  // ask for values; `error` when the last answer did not work
  | { kind: 'show'; id: string; title: string; text: string; qr?: string; code?: string }   // show something and wait
  | { kind: 'confirm'; id: string; title: string; text: string }
  | { kind: 'done'; devices: string[] }
  | { kind: 'error'; text: string }
```

Rules for every connector:

- It never decides whether Mini may do something. The core checks the grant and the approval before calling `run`.
- It never writes to the database itself. Events go through `emit`, devices through `ctx.devices`.
- It keeps passwords and tokens only through `ctx.secrets`.
- It stops everything it started when `stop` is called or `signal` fires.
- An action with no `risk` or no `describe` fails the core's start-up check.

## `pc`: this computer

No setup; always present. Exists so the PC appears as a device like any other.

- **Events**: `device_state` (battery if it has one, on mains or not, low disk, coming back from sleep).
- **State**: memory and disk free, battery, uptime, whether the Mini Bot is running.
- **Actions**: `status` (`pc.status.read`, read); `lock` (`pc.power`, act); `sleep`, `restart`, `shut_down`
  (`pc.power`, important). Anything more is the Mini Bot's computer control, with its own permissions.
- **Widgets**: `device-status`.

## `mini`: the Mini Bot

Links the hub to the Mini Bot's runtime on this PC. It finds the runtime through the bot's own `runtime.json`.

- **Events**: `mini_action`, built from the bot's own computer-control log and its activity, so the dashboard's
  Activity shows what Mini did on the PC next to what it did everywhere else.
- **State**: running or not, the active bot's profile, what it is doing, whether a card is waiting, the bot's permissions.
- **Actions** (person only, from the dashboard; not offered to the agent): send a prompt, start, stop.
- **Widgets**: `mini`, `mini-activity`.
- It never answers the bot's cards and never changes the bot's permissions (`09`).

## `android`: an Android phone

The phone app (`08`) is the other half. Setup is the pairing in `04`. More than one phone can be paired.

**Events**: `call`, `sms`, `chat`, `notification`, `device_state`, `app_usage`, and `mini_action` for what Mini did
on the phone.

**Actions**, sent to the phone as commands over the link. The hub checks its "Mini may use" switch when Mini
asks; the phone then checks its own "From my PC" switch for the same scope, whoever asked (`03`, `04`). The
phone's side of these is one set of actions, used by commands from the hub and by Mini on the phone alike (`08`).

| Action | Does | Scope | Risk |
|---|---|---|---|
| `ring` | Rings loudly for a minute, to find the phone | `phone.control` | act |
| `status` | Reports battery, network and what is allowed, now | `phone.usage.read` | read |
| `screen_read` | Returns the text on the screen now | `phone.screen.read` | read |
| `screenshot` | Returns a picture of the screen | `phone.screen.read` | read |
| `open_app` | Opens an app by name | `phone.control` | act |
| `tap`, `type`, `swipe`, `key` | Controls the phone, one step at a time, with the screen read back after each | `phone.control` | act |
| `dismiss` | Dismisses a notification | `phone.control` | act |
| `set` | Do Not Disturb, the ringer, the torch, the brightness | `phone.control` | act |
| `reply` | Answers a chat through its notification's reply box | `phone.reply` | important |
| `send_sms` | Sends an SMS | `phone.reply` | important |
| `call` | Places a call | `phone.reply` | important |
| `mirror` | Opens the phone's screen in a window on the PC (starts `scrcpy`; needs the phone on USB or wireless debugging). Runs on the PC, not on the phone, and is the owner's own tool: not offered to Mini. | n/a | person only |

`status` arrives with Phase 2. Every other action arrives with Phase 5 (`10`), when the phone's accessibility
service and its control rules exist.

While any control action is running, the phone shows a border and a banner ("Mini is controlling this phone, from
the PC") with a Stop button, and Stop on either device ends it.

**Widgets**: `device-status`, `calls`, `messages`, `notifications`, `phone-usage`, `phone-actions`.

## `mail`: a mail account

The owner's own mail account, read over IMAP and sent from over SMTP with the owner's address and an **app password**.
No OAuth, no Google Cloud project, no third party: the hub talks only to the account's own servers, always over TLS
(implicit TLS, or STARTTLS with TLS required), with the certificate checked; a plain connection is never tried. More
than one account can be added; each is its own device (`mail-<12 hex>`, kind `mail-account`) with its own switches,
all starting **off**. Code: `core/src/connectors/mail/`. Libraries: `imapflow` 2.11.0, `nodemailer` 10.4.0,
`html-to-text` 10.0.1, created with their logging off.

**Providers**

| Provider | IMAP | SMTP | Sent mail |
|---|---|---|---|
| Gmail | `imap.gmail.com:993` TLS | `smtp.gmail.com:465` TLS | Gmail keeps the sent copy |
| Outlook.com or Microsoft 365 | `outlook.office365.com:993` TLS | `smtp-mail.outlook.com:587` STARTTLS | Outlook keeps the sent copy |
| Another provider | asked (default 993, TLS) | asked (default 465, TLS) | the hub appends the sent message to the `\Sent` folder, read |

Gmail needs 2-Step Verification and an app password made at myaccount.google.com/apppasswords (spaces in what is
pasted are removed). **Outlook caveat:** Microsoft has been turning app passwords off for Outlook.com and Microsoft
365; the choice is offered, and if Microsoft refuses the sign-in this version of Mini Hub cannot connect that account
(the wizard says so).

**Setup** (the wizard, `setup(session, step, input)`):

1. **Add a mail account**: the provider, the address (a plain ASCII address) and a name in Mini Hub (the address if
   empty). An address already added is refused. Started with `input.device` set to an existing account, the wizard
   goes straight to step 3: **Change the app password**.
2. **Mail servers** (another provider only): IMAP and SMTP server, port and security (TLS or STARTTLS), and the user
   name (the address unless changed).
3. **App password**, with the provider's own instructions. Submitting it checks it: IMAP sign-in, the inbox opened
   read-only and the folders listed, then SMTP sign-in. A failure brings the same form back with a plain reason (the
   password was refused; the server could not be reached; its certificate could not be checked; reading works but
   sending did not; or "the check did not work"), never the server's own words.
4. Done: the device is added (or kept, when the password changed), the password saved in the encrypted database's
   `secrets` table (`<deviceId>.password`), and the account's place in its inbox reset. Every switch stays off.

The password is held only in that run of the wizard until it is saved; a cancel, the 15-minute limit or a failed
check drops it. It is never returned, shown, logged, audited, exported or put in an error or a device's `info`.

**How it works**: an account is watched (an IMAP connection held open) **only while its Reading mail switch
(`mail.read` collect) is on**; turning it off closes the connection at once and nothing more is fetched or stored.
Mail is collected **from the moment watching starts**: no history is imported. While the switch stays on, mail that
arrives while the hub is off is caught up at the next start; mail that arrives while the switch is off is never
fetched, and turning it on again starts from then. Older mail is reached through `search`, on the server.

- IMAP IDLE on the inbox, so new mail arrives at once; a server without IDLE gets `STATUS INBOX` every 60 s; a full
  check every 15 minutes as a safety net. One fetch at a time per account, at most 200 mails a round.
- Each new mail becomes a `mail` event (`04` > Event types): the sender, the subject, and the text as Settings > Data
  says (default the first 2,000 characters). The text is the first plain-text part, else the HTML part turned to plain
  text (no images, no link targets), at most 256 KiB of it fetched, by peek: the hub never marks mail read. Attachments
  are listed, never downloaded. A mail that cannot be read is skipped, never retried for ever.
- A lost connection is tried again after 5 s, 15 s, 60 s, then every 5 minutes ("Cannot reach the mail server.
  Trying again.", or "The mail server's certificate could not be checked. Trying again."); the wait starts again at
  5 s only after a check has worked. A check that fails on a live connection is logged as a word, never the details. A refused password stops trying until the owner enters it again ("The mail server refused the
  password. Enter it again on this account's page.").
- Health: `off` when no account is added; `ok` when every account is watching or not collected; `degraded` when some
  collected accounts have trouble; `down` when all of them do. Stop Mini does not stop watching.
- Removing the account closes its connections and deletes its password and its place in the inbox.

**Actions** (each opens its own short IMAP connection, at most two at once per account, at most 60 s; SMTP at most
30 s; none sets `\Seen` except `mark`). A message is named by `ref`: `{ event }` (a `mail` event of this account) or
the `{ folder, uid, uidValidity }` that `search` gave; a mailbox rebuilt since then gives "That mail has moved or the
mailbox was rebuilt. Search again."

| Action | Arguments | Does | Scope | Risk |
|---|---|---|---|---|
| `search` | `text?`, `from?` (1–200), `since?`, `before?` (`YYYY-MM-DD`), `folder?` (`inbox`, `all`, `sent`; default `inbox`), `limit?` (1–50, default 20); at least one of `text`, `from`, `since` | Searches the account on the server (for mail older than the hub has); newest first; senders, subjects, dates, unread and attachments, no text. `all` is the `\All` folder where the account has one (Gmail), else the inbox | `mail.read` | read |
| `read` | `ref` | One message's sender, recipients, date, subject, text (at most 100,000 characters) and attachments, by peek | `mail.read` | read |
| `mark` | `ref`, `read?`, `flagged?` (at least one) | Marks read or unread, flagged or not | `mail.change` | act |
| `draft` | `to`, `cc?`, `bcc?`, `subject`, `text`, `replyTo?` | Writes a draft into the Drafts folder (`\Drafts`, else `Drafts`, `[Gmail]/Drafts`, `INBOX.Drafts`), flagged `\Draft` and read | `mail.change` | act |
| `archive` | `ref` | Moves it to the archive (`\Archive`; Gmail: All Mail, which takes it out of the inbox) | `mail.change` | act |
| `delete` | `ref` | Moves it to the bin (`\Trash`); never deletes for good | `mail.change` | important |
| `send` | `to`, `cc?`, `bcc?`, `subject`, `text`, `replyTo?` | Sends from the account's address; a reply gets `In-Reply-To` and `References` from the original (a well-formed Message-ID only). Answers `{ sent: true, messageId }`; for another provider, if the copy in Sent could not be saved, also `note: "Sent, but the copy could not be saved in Sent."` | `mail.send` | important |
| `check` | none (owner only, in Mini Hub) | Checks for new mail now; refused while Reading mail is not collected | `mail.read` | read |

Recipients are plain ASCII addresses, at most 20 across To, Cc and Bcc; the subject is one line of at most 300
characters, with no control characters; the text 1–20,000 characters. `archive` and `delete` move with MOVE (or UIDPLUS);
on a server with neither they refuse ("This mail server cannot move one mail safely, so Mini Hub will not archive or
delete here. Do it in your mail app."), because the only other way would expunge every mail marked deleted. **The approval shows exactly what is sent or drafted** (From, To, Cc, Bcc,
Subject, the reply's original and the whole text): the arguments are never trimmed or changed, nothing is added (no
signature, no quoted original), and a second send needs a second approval. A send the server refuses fails with "The
mail server did not send it: <plain reason>" and nothing goes to Sent. A sent reply's draft stays in Drafts; nothing
deletes it without the owner. In an approval, the original mail's sender and subject are one line each (line breaks,
controls and direction overrides become spaces), at most 200 characters.

**One-time codes**: in every mail result Mini gets (`search`, `read`), and in the title and text of every event it
reads through the events routes (mail, messages, chats, notifications, calls), a subject or text that mentions a code (`otp`, `code`, `pin`, `passcode`, `verification`) has every number
of 4 to 8 digits shown as `••••••` (`maskCodes` in `protocol/src/events.ts`, the dashboard's rule). The owner sees
the whole text in Mini Hub.

**Widgets**: `mail`.

Mail is the most common carrier of text that tries to instruct an assistant. The tools' descriptions and the
event's framing say that mail text is information from someone else, and `send` and `delete` always ask.

## `home`: home devices

The owner's appliances are not known yet (`11`). The connector is therefore a frame with **adapters**, each of
which knows one way of talking to devices. All adapters present devices in the same shape:

```ts
type HomeDevice = {
  id: string; name: string; room?: string
  kind: 'light' | 'plug' | 'switch' | 'fan' | 'ac' | 'tv' | 'speaker' | 'sensor' | 'lock' | 'camera' | 'other'
  traits: Array<'onoff' | 'brightness' | 'color' | 'temperature' | 'speed' | 'volume' | 'reading'>
  state: Record<string, unknown>
}
```

| Adapter | Talks to | Local | Notes |
|---|---|---|---|
| `matter` | Devices that support Matter, added to the hub as a second controller from their own app or from the Alexa app ("share with another hub") | Yes | The preferred way: official, on the home network, works with the Echo Dot still in charge too. Uses the `matter.js` library. |
| `tuya-local` | Devices sold under many brands that use the Tuya or Smart Life app | Yes, after their keys are fetched once from the maker's developer site | Covers a large share of inexpensive plugs and bulbs |
| `kasa`, `hue`, others | One maker each | Yes | Added when the owner has such a device |
| `alexa-account` | Whatever the Alexa app controls, plus the Echo Dot itself (say this, volume, routines) | **No**: through Amazon, using the owner's Amazon session | Unofficial and can stop working. Offered only if the owner chooses it in `11`. |

**Events**: `home_state` when a device changes.

**Actions**

| Action | Does | Scope | Risk |
|---|---|---|---|
| `list`, `get` | Devices and their state | `home.read` | read |
| `set` | On or off, brightness, colour, temperature, speed, volume | `home.control` | act |
| `scene` | Runs a saved group of settings | `home.control` | act |
| `set` on a `lock`, a `camera`, an alarm or a garage | n/a | `home.control` | important |
| `echo_say`, `echo_volume` | The Echo Dot speaks or changes volume (`alexa-account` adapter only) | `echo.speak` | act |

**Widgets**: `home-room` (a room's devices as switches), `home-device` (one device, larger), `home-scenes`.

## `alexa`: talking to Mini through the Echo Dot

Off until the owner sets it up, and the only connector that opens a route from the internet.

**What the owner does once** (the setup shows each step):

1. Makes a free Amazon developer account with the same Amazon account as the Echo Dot.
2. Creates a custom skill there, named for example "Mini", with the interaction model the setup gives them to
   paste: one intent that takes everything said after "ask Mini", and one for "what did you find".
3. Starts the tunnel that gives the PC a public HTTPS address (see `11` for which), and pastes that address into the skill.
4. Pastes the skill's id into the dashboard.

The skill stays in "development" and is never published; it works on Echo devices signed in to the same account.

**How a request is handled**

1. The Alexa listener checks the request: Amazon's certificate chain and signature, the skill id, a timestamp
   under 150 seconds old. Anything else is refused and logged.
2. The grant `voice.alexa.ask` must be on.
3. The words go to the Mini Bot's queue with the source `room`. That source is what limits the turn, in code:
   the plugin refuses the bot's PC tools for the whole turn and marks its `hub_*` calls as voice, and the core
   applies the voice limits to those calls (`03`, "A turn started by voice"; `09`, section E).
4. The prompt also tells Mini how to behave: this was spoken to the Echo Dot by someone in the room; answer in
   one or two short spoken sentences; say plainly when something is not available by voice. This wording is for
   a good answer. It is not what enforces the limits.
5. The connector follows the reply to that prompt by its id (`05`, "How replies are followed"). If the whole
   reply is ready within 6 seconds it is returned as speech. Otherwise the skill answers "Mini is working on it.
   Ask me what it found in a moment," and keeps the reply for the next "what did you find".
6. Each request is a `voice_request` event.

**Actions through voice**: only actions the owner ticked as "safe by voice" in Permissions (for example,
the `home` connector's `set` on lights and plugs, under `home.control`). Never an `important` action, never an approval: a voice turn that would need
one is refused at once.

**Widgets**: `voice-requests`.

## Adding a new kind of device: the checklist

1. Write down what it can supply (events), what can be done with it (actions), and what the owner would want to
   see (widgets). Give every action a scope and a risk using the table in `03`.
2. Add its scopes to `protocol/src/scopes.ts` and any new event type to `protocol/src/events.ts`, with an example file.
3. Create `core/src/connectors/<id>/` implementing `Connector`. Register it in the connector list.
4. Add its widgets in `ui/src/widgets/` and its icon and name to the "Add device" list.
5. Tests: setup steps, each action with the grant off, on ask and on, events arriving, `stop` cleaning up.
6. Add a section to this page and a row to the scopes table in `03`.

## Left to the builder

- Each connector's internal structure, retry and back-off, and health details.
- The exact Alexa interaction model and the wording of spoken fallbacks.
- Which fields of a notification are kept (the title, the text and the conversation title are the minimum).

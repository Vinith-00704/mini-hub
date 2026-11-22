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

  /** Guided setup, one step at a time. Each step says what to show and what to ask. */
  setup(ctx: Ctx, step: string | null, input: unknown): Promise<SetupStep>

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
    run(ctx: Ctx, args: unknown, device?: Device): Promise<unknown>
  }>
}

export interface Ctx {
  emit(event: NewEvent): void                 // stores it (if its collect switch is on) and tells the dashboard
  devices: { upsert(d: DeviceInput): Device; setState(id: string, state: object): void; list(): Device[] }
  settings: { get(): object; set(patch: object): void }
  secrets: { get(name: string): string | undefined; set(name: string, value: string): void; delete(name: string): void }
  log: Logger                                 // redacting
  signal: AbortSignal                         // fires on stop and on Stop Mini
}

export type SetupStep =
  | { kind: 'form'; id: string; title: string; text: string; fields: Field[] }       // ask for values
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

**Setup**: the account's address, the provider (Gmail and Outlook fill in the servers; "other" asks for them), and
an app password. For Gmail this is a 16-character app password from the Google account's security page, which
needs 2-step verification on. The steps show exactly where to make it. The password is kept through `ctx.secrets`.
More than one account can be added.

**How it works**: IMAP with IDLE on the inbox, so new mail arrives at once; a full check every 15 minutes as a
safety net. Each new message becomes a `mail` event with the sender, the subject and a plain-text extract
(`04` says how much). Attachments are listed, not downloaded.

**Actions**

| Action | Does | Scope | Risk |
|---|---|---|---|
| `search` | Searches the account on the server (for mail older than the hub has) | `mail.read` | read |
| `read` | Fetches one message's full text | `mail.read` | read |
| `mark` | Marks read or unread, flags | `mail.change` | act |
| `draft` | Writes a draft into the account's Drafts folder | `mail.change` | act |
| `archive` | Moves a message out of the inbox into the archive | `mail.change` | act |
| `delete` | Moves a message to the bin | `mail.change` | important |
| `send` | Sends a message or a reply | `mail.send` | important |

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

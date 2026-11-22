# 03. Security and permissions

The point of the whole project is that the owner can give Mini a lot and still be the one in charge. This page is
the contract for that. The other pages must agree with it.

## What is being protected, and from what

| Protect | From | How |
|---|---|---|
| The owner's say over what Mini does | Mini acting beyond what was allowed, by mistake or because a page or message it read told it to | Grants, risk levels, approvals that only a person can give, the audit log, the stop button |
| Personal data at rest | Another Windows user, a lost or stolen PC or phone, a copied folder | Encrypted databases with keys held by the operating system's own key store |
| Personal data in transit | Other devices on the home network | An encrypted link with a pinned certificate and a token per device |
| The hub's doors | Other programs on the PC, web pages in a browser, anything on the internet | Local-only addresses, tokens, a dashboard only the shell's window can load, nothing public by default |
| The repository | Secrets and personal data being committed | `.gitignore`, made-up test data, a check before each phase is handed over |

**Out of scope, said plainly:** a program already running as the owner on the PC, or with root on the phone, can
read anything the owner can. Nothing here stops that, and nothing claims to. The same is true of the Mini Bot today.

## Who is calling

Every request to the core is from one of five callers. The caller decides what is possible.

| Caller | Who it is | How it proves it | May |
|---|---|---|---|
| **person** | The owner at the dashboard | The **person key**: 32 random bytes the shell makes at each start, gives to the core over its standard input and to the dashboard window through Tauri. Never on disk, never in an environment variable or a command line. | Everything: see all data, grant and revoke, approve, pair and remove devices, change settings, delete data, resume after a stop |
| **agent** | Mini: Claude Code calling `hub_*` tools | The **agent token** in `hub.json`, readable by programs running as the owner | Read what grants allow; ask for actions; stop. Never: grant, approve, pair, remove, delete, read the audit log of others' actions, resume |
| **device** | A paired device | Its own token, issued at pairing and stored only as a hash in the hub | Send its own events, answer commands sent to it, read its own settings |
| **voice** | Someone speaking to the Echo Dot | Amazon's signature on the request. The turn it starts in Mini's session is marked as a voice turn, and every tool call Mini makes during it reaches the core marked the same way (see "A turn started by voice"). | Ask Mini a question; run actions the owner marked "safe by voice". Never anything else. |
| **system** | The core itself (a scheduled sync, a cleanup) | n/a | Housekeeping only. Logged like everything else. |

On the phone, the same split exists inside the phone app: **person** is the owner using the app's own screens,
**agent** is Claude Code in Termux calling `phone_*` tools with the token the app issued, and the app is the judge.

### Why the agent token is weaker on purpose

Mini's Claude Code session can read files as the owner, so it can read `hub.json`. That is fine: the agent token
only opens what the grants allow, and it cannot change the grants. The person key is what changes things, and it
exists only in the memory of the shell, the core and the dashboard window. This is the same arrangement as the
Mini Bot's overlay key, and the same rule goes with it:

> No program, script, test or model answers a consent question, sends the person key, or writes a grant or an
> approval into the database directly. If a safety check blocks such a thing, it is right.

## Two switches for every kind of data

For each kind of data a device can supply there are two separate choices, **set per device** (two phones, or two
mail accounts, each have their own):

1. **Collect**: is it recorded and brought to the hub at all? `off` or `on`.
2. **Mini may use**: may the agent read it or act with it? `off`, `ask` or `on`.

The owner can keep their call history on the dashboard for themselves (collect on) while Mini has no access to it
(Mini may use: off). A new connection starts with collect **off** and Mini **off**; the owner turns on what they want.

Connectors whose devices share one decision (`home`, `alexa`) have one switch per scope for the whole connector.

### The three lists

Mini on the PC and Mini on the phone are separate sessions on separate devices, and a command from the PC to the
phone is a third thing. So there are three lists, each decided on the device it protects:

| List | Lives on | Decides |
|---|---|---|
| **Mini may use** (per device, per scope) | The hub | What Mini's session on the PC may read from the hub and do through it |
| **Mini on this phone** (per scope) | The phone app | What Mini's session on the phone may read and do on the phone |
| **From my PC** (per scope) | The phone app | What a command arriving from the hub may do on the phone, whether the owner pressed it on the dashboard or Mini asked for it there |

### Sharing one thing by hand

When the owner presses **Ask Mini** on one item in the dashboard (one message, one mail), that item goes to Mini
with the prompt, whatever the "Mini may use" switch says. The owner's own press is the yes for that one item, as
it is for "summarize this page" in the bot. It is logged as "you shared 1 message with Mini". The switch stays
as it was for everything else, and the button says "This shares this item with Mini" when the switch is off.

## Scopes

A scope names one thing that can be granted. This is the canonical list; `protocol/src/scopes.ts` mirrors it.

| Scope | What it covers | Kind | Default |
|---|---|---|---|
| `phone.calls.read` | Call history: who, when, how long, missed or not | read | off |
| `phone.messages.read` | SMS, and messages seen as notifications from chat apps | read | off |
| `phone.notifications.read` | Other notifications | read | off |
| `phone.usage.read` | Battery, which apps were used and for how long | read | off |
| `phone.location.read` | Where the phone is (a later phase) | read | off |
| `phone.screen.read` | What is on the phone's screen now | read | off |
| `phone.control` | Tapping, typing and opening apps on the phone | act | off |
| `phone.reply` | Sending an SMS, answering through a notification, placing a call | important | off |
| `mail.read` | Reading and searching mail | read | off |
| `mail.change` | Marking, flagging, writing a draft, archiving (act); deleting (important) | act | off |
| `mail.send` | Sending mail | important | off |
| `pc.status.read` | This PC's state: battery, memory, disk, whether the Mini Bot is running | read | off |
| `pc.power` | Locking this PC (act); sleep, restart, shut down (important) | act | off |
| `home.read` | The state of home devices | read | off |
| `home.control` | Switching and setting home devices | act | off |
| `echo.speak` | Making the Echo Dot say something or change its volume | act | off |
| `voice.alexa.ask` | People in the room may ask Mini questions through the Echo Dot | read | off |
| `voice.alexa.private` | Answers spoken through the Echo Dot may include private data (messages, mail, calls) | read | off |

The "Kind" column is the scope's usual risk; each action's own risk is fixed in its connector (`06`).

The PC's own access (screen, microphone, computer control, full access) stays with the Mini Bot's permission
system. The hub shows those switches and links to the bot for changing them; it does not duplicate them.

Which scope lets the agent read which event type is in `04` ("Event types"). Two fixed rules sit beside the
table: the agent may always read the record of **its own** actions (`mini_action`, and its own audit rows), and
it may never read `system` or `voice_request` events.

A connector that is added later brings its own scopes, named `<connector>.<thing>.<verb>`.

## Risk

Every action a connector offers has one risk level, fixed in code, not chosen at run time.

| Risk | Means | Examples | Needs |
|---|---|---|---|
| `read` | Looks, changes nothing | List calls, read a mail, a device's state | The scope's grant |
| `act` | Changes something that is easy to see and easy to undo | Lamp on, volume up, ring the phone, open an app | The scope's grant |
| `important` | Sends, deletes, pays, or changes something that is not the owner's alone or cannot be undone | Send a message or mail, delete anything, unlock a door, confirm a purchase, change a password or a setting that affects security | **An approval every time**, whatever the grant says |

Rules:

- With the grant **off**, the action is refused and Mini is told it is not allowed.
- With the grant on **ask**, the action waits for an approval.
- With the grant **on**, `read` and `act` actions run and are logged. `important` actions still wait for an approval.
- An action whose target is a lock, an alarm, a camera, a garage or anything that keeps the home safe is
  `important`, whatever kind of device it is.
- Unknown is `important`. A connector action with no declared risk does not load.

## Approvals

- An approval is a question about **one** action, shown with what will happen in plain words: "Send this SMS to
  Asha: 'Running 10 minutes late'?" The exact text, recipient or target is on screen. Nothing is summarized away.
- **The hub's approvals are answered in the dashboard only**, with the person key (a card on every screen, and
  the Approvals list). The Mini Bot on the PC shows that an answer is needed and opens the dashboard; it does not
  carry the hub's Yes and No in version 1 (`09`). No device, and no token of any kind, can answer one.
- **The phone has its own approvals**, in its own database, answered on the phone's own screen. They arise in two
  ways: Mini on the phone asks for something whose "Mini on this phone" switch says ask (or that is `important`);
  or a command from the hub arrives for something whose "From my PC" switch says ask.
- **Asked once where the owner is.** An `important` action that the owner started or approved on the dashboard
  arrives at the phone marked so, and the phone does not ask again if its "From my PC" switch for that scope is
  **on**. The phone takes the paired hub's word for it: that is what pairing means. Setting the switch to **ask**
  makes the phone ask as well; **off** refuses.
- It expires (default 2 minutes) and then counts as "no". A second identical request needs a second approval.
- "Always allow this" is offered only for `act` actions, sets that scope's grant to **on**, and says so. It is never
  offered for `important` actions.
- The phone app's accessibility service refuses to tap anything in the phone app's own windows, so Mini cannot
  approve its own request by controlling the phone.

## The audit log

- One row for every read by the agent, every action by anyone, every approval and refusal, every grant change,
  every pairing and removal, every start and stop, and every stop-button press.
- Each row: when, who (caller and detail), what, on what, the risk, the outcome, and the hash of the row before
  it plus its own. A broken chain shows in the dashboard as a warning.
- The agent can read only the rows about its own actions. Nothing can edit a row. Only the person can export or
  clear the log, and clearing writes a row that says it was cleared.
- The phone keeps its own log the same way and sends it to the hub as events.
- Message and mail **text is not copied into the log**. The log says "read 3 messages from Asha", with the event ids.

## The stop button

Always on screen in the dashboard, on the tray menu, on a global key, in the bot's menu, and in the phone app.

**Stop Mini** (one press):

- The core refuses every agent and voice request from then on.
- It tells the Mini Bot runtime to end computer control and release the screen and the microphone.
- It tells each linked phone to stop: any control in progress ends, and Mini on that phone is stopped too, with
  "Stopped from your PC" on its screen. A stop command needs no switch and is never refused.
- Every waiting approval is answered "no".
- The record keeps being collected, and the dashboard keeps working: stopping Mini does not blind the owner.
- Only a person can resume. **Resume** on the dashboard resumes the PC. A phone is resumed on the phone.

**Stop on the phone** stops Mini on the phone and any control from the PC, at once and whether linked or not. When
linked it also offers "Stop on my PC too", which the hub always honours. Resuming the phone does not resume the PC.

**Disconnect everything** (in Permissions, with a confirmation): Stop Mini, plus close the device link and the Alexa tunnel.

A device that is switched off or away cannot be told to stop. The phone has its own stop button for that reason.

## A turn started by voice

Words spoken to the Echo Dot become a prompt in Mini's ordinary session on the PC, so the limits on voice cannot
rest on what the prompt says. They are enforced in two places, for the whole of that turn:

- **In the Mini Bot plugin.** The prompt is queued with the source `room`. While a turn that began from a `room`
  prompt is running, the plugin's tool hook refuses the bot's own tools that touch the PC (computer control,
  looking at the screen, reading a page, full access) with "not available by voice from the room", and marks
  every `hub_*` call it makes with `x-hub-origin: voice`. The model cannot change either: both are in the hook's code.
- **In the core.** A call marked `voice` may read an event type only if its scope's "Mini may use" is **on** and,
  for calls, messages, mail and notifications, `voice.alexa.private` is on as well. It may run an action only if
  that action is ticked "safe by voice". Anything that would need an approval is refused at once; no approval is created.

A turn the owner starts at the bot or the dashboard is not a voice turn, even if it follows one.

## Mini's own tools on the phone

Claude Code has tools of its own (running commands, reading and writing files, fetching web pages). On the PC
they are governed by Claude Code's own permission system and the Mini Bot's rules, as today. On the phone they
could reach the phone around the phone app (Android's `am` command, Termux's own helpers, a direct call to the
hands endpoint), so the phone session is started with them shut:

- Permission mode `dontAsk`: anything not allowed in advance is refused without a question, so a session with
  no terminal on screen can never hang on a prompt.
- Allowed: the `phone_*` tools, the Mini Bot's own harmless tools (routines, bot design), web search and fetch,
  and reading and writing files inside one work folder (`~/.mini/work`).
- Refused: running commands, and any file outside the work folder.

The owner can open this up in `11` (D14). Until then, the phone app's switches are the only way to the phone.

## Keys and secrets

| Secret | Kept where | Notes |
|---|---|---|
| Hub database key | Windows Credential Manager | Made at first start. Given to the core over standard input by the shell. |
| Person key | Memory only | New at every start of the shell. |
| Agent token | `hub.json` in the data folder | New at every start of the core. |
| The hub's certificate and private key | The data folder, private key encrypted with the database key | Made at first start. Devices pin its public-key hash at pairing. Making a new one means pairing again. |
| Device tokens | The device's own key store. The hub keeps a hash only. | Removing a device deletes the hash. |
| Mail password or token, the Alexa skill's id, any home-device keys | Inside the encrypted database | Shown in the dashboard as "set", never shown back |
| Phone database key | Android Keystore | Never leaves the phone |
| The phone app's signing key | A keystore file outside the repository or in `local/`, with its passwords in an ignored properties file | Losing it means the next version cannot be installed over the old one |

Logs never contain a secret, a message body, a mail body, or a full phone number or address: the logger redacts
by field name, and tests check it.

## The network

- The local API binds to `127.0.0.1` only.
- The device link binds only to the PC's addresses on networks Windows marks as private, uses TLS 1.3 with the
  hub's own certificate, and is closed when no device is paired. Windows Firewall gets one inbound rule for the
  core's program, private networks only, added with the owner's consent the first time a device is paired.
- A device proves itself with its token after the TLS session is up. Five wrong tokens from an address close the
  door to it for ten minutes.
- The Alexa route is its own listener that knows one path. It accepts only requests that pass Amazon's signature
  check, carry the configured skill id, and are less than 150 seconds old. The tunnel is given only that listener.
- The dashboard's content security policy allows `'self'` and the core's local address. Nothing else.
- Away from home, the phone does not reach the hub. A private overlay network is an owner's choice in
  `11-open-decisions.md`.

## The dashboard itself

- Opening the dashboard shows everything, so the owner can set a lock: after a chosen idle time, the window asks
  for Windows Hello or a PIN before it shows anything. Off by default on a PC only the owner uses.
- Message previews on the Home board can be blurred until hovered ("privacy mode"), for when someone else can see the screen.

## Keeping the repository clean

- `.gitignore` covers secrets, the owner's setup, collected data, logs and build output. Read it before adding a
  new kind of file.
- Test data is made up: names from a fixed list in `tools/seed.mjs`, numbers in the `+1 555 01xx` range,
  addresses at `example.com`.
- Before a phase is handed to the owner, run a search of the tracked files for the things that must not be there
  (mail addresses that are not `example.com`, long digit runs, `token`, `password`, `secret`, private-key
  headers), and look at every hit.
- The owner's real device names, addresses and account names, when needed during development, go in `local/`.

## What the builder must prove with tests

1. An agent token cannot reach a person-only route: grants, approvals, pairing, removal, settings, deletion, resume.
2. An `important` action never runs without an approval, with the grant on or off.
3. An approval cannot be answered with the agent token, a device token, or no key.
4. After Stop Mini, every agent and voice request is refused until a person resumes.
5. A device token gets only that device's routes, and stops working when the device is removed.
6. A wrong or stale Alexa signature is refused.
7. The audit chain breaks visibly when a row is changed by hand.
8. No log line contains a message body, a mail body, a token or a full number, across the whole test run.
9. The device link refuses a client that does not present a valid token, and the phone app refuses a hub whose
   certificate is not the pinned one.
10. On the phone, the accessibility service will not act on the phone app's own windows.
11. A call marked as a voice turn cannot read private event types with `voice.alexa.private` off, cannot run an
    action that is not ticked safe by voice, and never creates an approval.
12. Grants are per device: turning a scope on for one phone or one mail account does not open another.
13. A command from the hub is refused by the phone when its "From my PC" switch is off, whoever started it.

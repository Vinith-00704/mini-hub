# 07. The dashboard's design

## The idea

A quiet control room. The owner opens it to answer three questions quickly: **what happened**, **what is Mini
doing**, **is everything as I left it**. So it is calm, mostly neutral, and dense enough to read at a glance
without feeling like a spreadsheet.

Three things give it its character:

1. **Mini is on the page.** The owner's own pixel-art bot sits in the top corner, moving the way it does on the
   desktop: resting, thinking, working, waiting for an answer. Clicking it opens a prompt. It is the one playful
   thing on an otherwise calm surface.
2. **One accent colour, and it is the bot's.** The dashboard takes its accent from the active bot's accent, so a
   bot the owner designed colours their dashboard too. Everything else is neutral.
3. **Boards of tiles.** The home screen is a grid of soft-cornered tiles the owner arranges. Each tile does one
   thing and can be opened for more.

What it avoids: gradients behind text, glass blur, glowing borders, a different colour for every category, cards
inside cards, and decoration that carries no information.

## Tokens

All colours, sizes and timings are CSS variables in `ui/src/design/tokens.css`, mapped into Tailwind. Components
use the variables, never raw values. Dark is the default; light is complete, not an afterthought. "System"
follows Windows.

### Colour

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg` | `#0e0f11` | `#f5f5f2` | The window |
| `--surface` | `#16181b` | `#ffffff` | Tiles, panels |
| `--surface-2` | `#1d2024` | `#f0f0ec` | Raised or hovered surfaces, inputs |
| `--border` | `#2a2e33` | `#e1e1dc` | Hairlines, tile edges |
| `--border-strong` | `#3a3f46` | `#c9c9c3` | Focused inputs, dividers that must show |
| `--text` | `#eceef0` | `#1a1c1e` | Main text |
| `--text-2` | `#a3aab2` | `#565d65` | Secondary text |
| `--text-3` | `#737a82` | `#868d94` | Hints, timestamps |
| `--accent` | the bot's accent, default `#d77757` (the Mini Bot's own default) | same | Primary buttons, the active item, focus rings, the selected state |
| `--accent-text` | black or white, whichever reads better on the accent | same | Text on the accent |
| `--ok` | `#3fb37f` | `#1f8a5b` | Online, allowed, done |
| `--warn` | `#e0a23a` | `#a86a00` | Waiting, degraded, "ask" |
| `--danger` | `#e5534b` | `#c5322b` | Stop, refused, failed, destructive |
| `--info` | `#5b9dd9` | `#2f6fb0` | Neutral notices |

- Semantic colours appear as a dot, an icon or a thin edge with a word beside them, never as colour alone.
- Text on any surface meets WCAG AA (4.5:1; 3:1 for large text and icons). The accent is checked when the bot
  changes: if it would fail on the surface, a lighter or darker step of the same hue is used for text and focus rings.
- No more than one accent-coloured element competes for attention in a view.

### Type

| Token | Size / line | Weight | Used for |
|---|---|---|---|
| `--t-display` | 28 / 34 | 600 | A big number on a tile |
| `--t-title` | 20 / 26 | 600 | Screen titles |
| `--t-head` | 16 / 22 | 600 | Tile and section headings |
| `--t-body` | 14 / 20 | 400 | Everything else |
| `--t-small` | 13 / 18 | 400 | Secondary lines |
| `--t-micro` | 12 / 16 | 500 | Labels, timestamps, badges |

Geist Sans for text; Geist Mono for times, counts, numbers in tables and anything that must line up (tabular
figures on). Both are bundled files. Sentence case everywhere. No all-caps labels.

### Space, shape, depth, motion

- **Spacing**: a 4 px step: 4, 8, 12, 16, 24, 32, 48. Tiles have 16 px padding; the grid gap is 12 px.
- **Radius**: tiles 12, controls 8, chips and badges 6, the bot's panel 16.
- **Depth**: borders, not shadows, in dark. In light, tiles get one soft shadow (`0 1px 2px rgb(0 0 0 / 0.06)`).
  Only menus, dialogs and the dragged tile float, with a larger shadow.
- **Motion**: 120 ms for hover and press, 180 ms for panels and tiles, `cubic-bezier(0.2, 0, 0, 1)`. Things that
  appear fade and rise 4 px; nothing bounces. With "reduce motion" on in Windows, movement is replaced by a fade,
  and the bot holds still.
- **Density**: "comfortable" (above) and "compact" (rows 32 px instead of 40, tile padding 12).
- **Focus**: a 2 px accent ring with a 2 px gap, on every interactive thing, visible in both themes.

## The frame

```
+------+----------------------------------------------------------------------------------+
|      |  Home                         [ Ask Mini or search...  Ctrl+K ]   o2   [#]  [Stop]|
| (M)  +----------------------------------------------------------------------------------+
|      |                                                                                  |
| Home |                                                                                  |
| Inbox|                              the current screen                                  |
| Devcs|                                                                                  |
| House|                                                                                  |
| Mini |                                                                                  |
| Activ|                                                                                  |
|      |                                                                                  |
| Perms|                                                                                  |
| Setts|                                                                                  |
+------+----------------------------------------------------------------------------------+
```

- **Left rail**: the bot at the top (its live state), then the sections, each an icon with a label. It collapses
  to icons below 1100 px or by choice. Permissions and Settings sit at the bottom. A count shows on Inbox (unseen)
  and on Permissions (approvals waiting).
- **Top bar**: the screen's title; the command box; the approvals indicator (`o2` above: two waiting); the
  devices indicator (`[#]`: a dot per device, green online, grey away); and **Stop**, always there, always red-edged.
- **Command box** (`Ctrl+K` from anywhere focuses it and selects its text; placeholder "Ask Mini or search…  Ctrl+K"):
  one box to ask Mini or to find things. It is a combobox: arrow keys move through the list (wrapping), Enter runs the
  picked row, `Esc` closes the list and a second `Esc` leaves the box. From 2 characters, after 200 ms without
  typing, it lists at most 5 rows per section, each with where it comes from on the right, in this order:
  1. **Ask Mini**, always the first row ("Ask Mini: <text>"), picked when the list opens, so Enter on what was typed
     asks Mini. It sends the text as the person's prompt, and the note under the box says "Sent to Mini. The reply is
     on the Mini screen."; if Mini is not running it says so with **Start Mini**. With the list closed, Enter on
     text also asks Mini.
  2. **Go to**: Home, Inbox, Devices, Mini, Activity, Permissions, Settings, Settings > Look, Data, Network, Start-up,
     Boards, About (`#/settings?section=<look|data|network|startup|boards|about>`), Add a phone
     (`#/devices?add=phone`) and Add a mail account (`#/devices?add=mail`). Matched by words: every typed word must
     start a word of the name (or of a few hidden words such as "theme" or "backup").
  3. **Boards** by name (`#/?board=<id>`), 4. **Devices** by name (the device's page) and 5. **People** by name or
     key (`#/inbox?who=<key>`, the Inbox filtered to "From <name>"): any typed word may be inside the name.
  6. **Items**: what came in (calls, SMS, chats, notifications and mail only, what the Inbox lists), found by the
     hub's full-text search (`GET /v1/events?q=`, whole words). A row is one line: the kind's icon, who, the text
     (a mail's subject). A one-time code in it is hidden as in the Inbox, and in privacy mode the text is blurred.
     Other people's words are shown as text with hidden direction characters made visible. Enter opens
     `#/inbox?kind=<calls|messages|mail|notifications>&item=<id>`.
  Ranking inside a section: a name that starts with what was typed, then one that has a word starting with it, then
  the rest, each in the order the hub gives (people and items: newest first). Typing again while a search is on its
  way shows only the newest search's results. A failed search shows "Search did not work: <reason>" as a row, and when
  nothing matches the list says "Nothing found. Enter asks Mini." Text over 200 characters (the hub's search limit) is
  not searched: the list says "Too long to search. Enter asks Mini." An Enter that an input method uses to finish
  composing a word does nothing. Screen readers hear the number of results. The
  box does nothing but open a place or ask Mini, so it asks no "Are you sure?": acting on something (a tile's quick
  action) stays on the board.
- **Approval card**: when Mini needs a yes, a card slides in at the bottom right on every screen, with the exact
  action, Yes and No, and a countdown. More than one stack. For a mail Mini asks to send or to save as a draft, the
  card shows the question, then From (the account's address), To, Cc and Bcc (when there are any), Subject, "In reply
  to" (who and which subject, for a reply), and the whole text exactly as it will be sent, in a box that scrolls
  inside the card (at most 40% of the window's height) so Yes and No stay in view. Nothing is cut or changed; the
  Waiting tile shows the same.
- **Stopped state**: after Stop, a full-width bar under the top bar says "Mini is stopped. Your data is still
  being collected." with **Resume**.
- Window: starts at 1280 x 800, remembers its size and place, works down to 900 x 600. Below 900 px wide the
  board becomes one column.

## Screens

### Home (a board)

```
+----------------------------------+----------------------+----------------------+
| Today                            | Mini                 | Phone                |
| 3 missed calls   7 messages      | (bot)  Resting       | 62%  charging        |
| 12 mails         2 need you      | [ Ask Mini...      ] | Home Wi-Fi - 2m ago  |
+-----------------+----------------+----------------------+----------------------+
| Mail                                   | What Mini did                         |
| Priya    Invoice for November          | 14:02  Read 3 messages    allowed     |
| GitHub   [repo] Build failed           | 13:40  Lamp on            allowed     |
| Uni      Timetable change              | 13:12  Send SMS to Asha   you said yes|
+-----------------+---------------------------------------+----------------------+
| Calls           | Messages                              | Notifications        |
| Asha    missed  | Ravi (WhatsApp)  Are we still on...   | Bank app  Card used  |
| +1 555  4 min   | Bank (SMS)       Your OTP is ...      | Shop app  Order sent |
| Mum     missed  | Team (WhatsApp)  3 new                | News app  Headline   |
+-----------------+---------------------------------------+----------------------+
```

The default board, shown the first time. It is the owner's to change. The last row is Calls (3 columns of 12),
Messages (6) and Notifications (3); below 900 px wide the board is one column, tile under tile in reading order
(see Making it one's own).

**Notifications** shows the other notifications the phone sent: the app as the name and "title: body" as the text.
Each list tile (Calls, Messages, Notifications, Mail) says why it is empty, in this order: still loading; failed (with
Retry); not connected, when no phone is paired ("... arrive from your phone once it is paired. Pair it in Devices.");
not collected, when every phone's switch for it is off ("Call history is not collected. Turn it on in Permissions.",
with an "Open Permissions" button); the phone still needs something, when a phone with the switch on reports it in
`state.needs` ("On, but the phone still needs Android's permission. Allow it in Mini on the phone, under Perms.", or
the notification-access or apps line); otherwise "Nothing yet." Items already received always show, even after the
switch is turned off. The same need line sits under the collect switch of that phone's row in Permissions and on its
page. A chat in a group shows "sender · conversation". One-time codes are masked in every list.

### Inbox

```
[ All ] [ Calls ] [ Messages ] [ Mail ] [ Notifications ]      [ Phone v ] [ Unseen ] [ search ]
+--------------------------------------------+------------------------------------------------+
| Today                                      |  Ravi                              WhatsApp    |
|  o Ravi          Are we still on for...  2m|  --------------------------------------------- |
|  o Asha          Missed call            14m|  10:02  Are we still on for tonight?           |
|    Priya         Invoice for November    1h|  10:05  Bringing the charger                   |
|    Bank          Your OTP is ******      2h|  14:41  Are we still on for 8?                 |
| Yesterday                                  |                                                |
|    Mum           Incoming call, 12 min     |  [ Reply through the phone... ]   [ Ask Mini ] |
+--------------------------------------------+------------------------------------------------+
```

- One timeline of everything, newest first, grouped by day. A dot marks unseen.
- Filters by kind, by device or account, unseen only, and full-text search.
- The right pane shows the selected item in context: a person's recent calls and messages together, a mail in
  full, a notification with its app.
- **Reply** appears only where a reply is possible now (an SMS; a chat whose notification is still live) and
  sends through the phone. **Ask Mini** puts the item into a prompt ("summarize", "draft a reply"). When Mini's
  switch for that kind of item is off, the button says "This shares this item with Mini" before it does (`03`).
- **A mail** shows its sender (name and address), To and Cc, the time, its subject as the heading and the text the hub
  kept (a mail account keeps the first 2,000 characters by default; Settings > Data), as plain text, never HTML and
  never a remote image. Attachments are listed by name and size: "Attachments are listed, not downloaded." With no
  stored text it says "Only the subject is kept (Settings > Data)." **Show the whole mail** asks the account for the
  full text now and shows it in place: "Fetched from the account just now; not kept in Mini Hub." (or why it could
  not). The device filter lists mail accounts with the phones.
- One-time codes are masked in lists until the owner hovers or selects them.
- Empty: "Nothing yet. Turn on what to collect in Permissions," with a button.

### Devices

A grid of device cards: icon, name, room, an online dot, two or three facts (battery, last seen), and its most
used action. **Add device** is the first card.

A device's page:

- **Status**: live state, last sync, software version, and for a phone one line on Mini there: awake, asleep,
  stopped on the phone ("It is started again on the phone"), or "Claude Code on this phone is not working. The phone
  keeps recording." Nothing is said until the phone has reported; while it is not linked, "awake" is left out and the other words
  are marked as its last report.
- **What it shares**: its collect switches.
- **What Mini may do with it**: its grants, the same switches as in Permissions, filtered to this device.
- **Actions**: buttons for what can be done by hand (ring, mirror, lock).
- **Recent from this phone**: its last 8 calls, SMS, chats and notifications (codes masked), with "All in Inbox →"
  to the Inbox filtered to that phone (`#/inbox?device=<id>`). Mini's actions on it are in Activity.
- **Remove**, with the choice to delete what it sent.

**Add device** opens a choice of two cards: **Phone** ("Pair your phone with this PC.", the pairing code and the four
words, `04`) and **Mail account** ("Read and send mail from Gmail, Outlook or another provider."). `#/devices?add=phone`
and `#/devices?add=mail` open one directly; `?add=1` (Home's link) opens the choice. The mail account is a wizard
driven by the connector's setup steps (`06`): the hub says what to ask next (a form, a note, a question) and the
dashboard shows it; follow the steps and land on the new device's page with everything off and the question "What
should this device share?" A step that fails stays on the same step with its error above the fields. The password
field is never filled in, echoed, kept in the address or in the browser's storage, and is cleared from the form as
soon as it is sent. Cancel (or `Esc`) ends the run and the hub forgets what was typed; focus goes to the first field of
each step.

**A mail account's page** (`#/devices/<id>`):

- **Status**: a dot and "Watching for new mail", or the account's note (why it is not watching); its address, the
  provider, the servers (`imap.example.com:993 · TLS`), when it last checked, and the password as "Set" (never its
  value) with **Change the app password**, which runs the wizard again for this account.
- **What it shares**: the Reading mail collect switch. **What Mini may do**: Reading mail, Marking, drafting and
  archiving mail, and Sending mail (always asks first, with the whole mail shown), as in Permissions.
- **Check now**: asks the account to look for new mail, and says "<n> new" or why it could not.
- **Recent mail**: its last 8 mails (sender and subject, a dot for unseen), with "All in Inbox →"
  (`#/inbox?kind=mail&device=<id>`).
- **Remove this account**, with the tick "Also delete its mail from Mini Hub": "Remove <name>? Mini Hub stops reading
  it and forgets its password."

The **Mail** tile on Home shows the latest mail of every account (the sender of an unread mail in the warning colour) once an account is
added; before that it says "Add a mail account in Devices to see your mail here." with an **Add a mail account**
button. With privacy mode on, its previews are blurred like messages.

### House

Rooms as sections, each with its devices as tiles: a switch for on/off, a slider that appears for brightness or
volume, the reading for sensors. Scenes along the top. The Echo Dot appears as a device with "Say something" and
volume, if the adapter that allows it is on. A lock, a camera or an alarm has no switch on its tile: it opens a
confirmation.

### Mini

```
+---------------------------------------------------+---------------------------------+
|  (bot, large)   Mini - Working                    | Now                             |
|                 "Reading the page in front"       |  Reading a page (Brave)         |
|  -----------------------------------------------  |  Screen: in use                 |
|  You   Who called this morning?                   |                                 |
|  Mini  Asha at 9:12 (missed) and your mum at...   | Waiting in the bot              |
|                                                   |  A question is open on the bot. |
|                                                   |  Answer it there.               |
|  [ Ask Mini...                             Send ] |                                 |
|                                                   | Routines        Bot: Mini  [..] |
+---------------------------------------------------+---------------------------------+
```

The conversation with Mini's own session, streamed as it is written; what Mini is doing now and which access is
in use; a notice when the bot is waiting for an answer; the bot's routines; and which bot is active, with a link
to change or design one.

### Activity

The audit log as a readable timeline: time, who (you, Mini, the phone, voice), what, on what, and the outcome as a
chip (`allowed`, `you said yes`, `you said no`, `refused: switched off`, `failed`). Filters by who, by device, by
risk, by date. A row opens to show the exact action and, for an approval, what was shown and where it was answered.
A banner appears if the log's chain is broken. **Export** at the top.

Beside the audit log, Activity shows what Mini did on each phone, from the `mini_action` events the phone sends (they
arrive after the phone's next sync, and sort into place by when they happened, so a day with the PC off lands in
one go). Such a row reads "Mini · on <phone's name>" and ends in a chip: `allowed`, `you said yes`, `you said no`,
`refused: switched off`, `refused: stopped`, `refused` or `failed`. Rows carry counts only, never a name, a
number or the text of a message. The PC's own actions are already audit rows, so only events a phone sent
(`on: phone`) are added. **Who** set to "You" shows the audit log alone; "Mini" shows Mini's audit rows
and its events. If the events cannot be loaded, the audit rows still show, with a line saying so.

### Permissions

```
Everything Mini can reach, and whether it may.                         [ Stop Mini ]  [ Disconnect everything ]

Phone (2a)                                   Collect        Mini may use
  Call history                               [ on  ]        ( off | ask | on )
  Messages (SMS and chat apps)               [ on  ]        ( off |[ask]| on )
  Other notifications                        [ off ]        ( off | ask | on )
  Reading the screen                           -            ([off]| ask | on )
  Controlling the phone                        -            ([off]| ask | on )
  Sending replies and SMS                      -            ( off |[ask]| on )   always asks first

Mail
  Reading mail                               [ on  ]        ( off | ask |[on])
  Sending mail                                 -            ( off |[ask]| on )   always asks first

This PC (set in the bot)                     Screen: on   Microphone: on   Computer control: asks   Full access: off
```

- One row per scope, grouped by device, each device with its own switches. Two controls: collect, and a
  three-way choice for Mini.
- A phone's section also shows, read-only, the two lists the phone keeps itself ("Mini on this phone" and "From
  my PC"), as the phone last reported them, with "change these on the phone".
- Rows that always ask say so, and "on" for them means "Mini may ask", never "Mini may do it unasked".
- Turning something on shows one line on what it means ("Mini will be able to read your SMS, including one-time codes").
- "Safe by voice" ticks appear on rows the Echo Dot could trigger, when that connector is on.
- Approvals waiting, and the last few answered, sit at the side.

### Settings

Sections, in this order: **Look** (theme, density, privacy mode), **Boards**, **Data**, **Network**, **Start-up**
(start with Windows, the global key) and **About** (version, the data folder). Each is addressed as
`#/settings?section=<look|boards|data|network|startup|about>` (the command box links to these): it scrolls into view
and takes focus on arriving and when the address changes. Every section shows a skeleton while loading and an error
with **Retry**; every control has a name; results and errors are announced (`role="status"`).

- **Boards:** one row per board with its name, **Open**, **Rename** (in place), **Move up**, **Move down**,
  **Duplicate**, **Reset to the default** and **Delete** (not on the last board), and **New board**. The same
  questions and limits as the board tabs: 20 boards at most, a name of 1 to 40 characters.
- **Data:**
  - **How long things are kept**: one row each for Calls, Messages (SMS and chat together), Other notifications, Mail,
    What Mini did, Phone and PC state and Mini Hub's own notes, each For ever / A year / 90 days / 30 days; the
    Activity log keeps A year / Two years / For ever. "Older items are removed within six hours of a change."
  - **How much of a mail is kept**: Subjects only / The first 2,000 characters (default) / The full text, up to 20,000
    characters. It applies to mail that arrives from now on.
  - **Export a backup**: a passphrase typed twice (at least 10 characters), then **Choose where to save**, which opens
    Windows' own save window (the desktop app's file picker). Outside the desktop app (development) a "Full path of
    the file" field takes the place of the picker. The result says "Saved: <n> events, <n> boards."
  - **Import a backup**: the passphrase, then **Choose a backup** (Windows' own open window), then a question: "Bring
    back the events and boards in this backup? What is here already stays." A large import shows Mini munching with
    "Bringing it back". The result says how many events were brought back and how many were already here, and that
    switches are not in a backup (they stay as set in Permissions). Outside the desktop app it says it needs the
    desktop app. A cancelled picker does nothing; a wrong passphrase shows the hub's own sentence.
  - **Delete**: a kind and **Delete all of these**. The question, "Are you sure?", counts exactly what would go
    ("24 items of Messages will be deleted") and says it cannot be undone and that the phone and the mail account keep
    their own copies. Its Delete button waits 600 ms after the question appears and ignores the second click of a
    double click.
  - The passphrase is held only until it is sent or the import is cancelled, then cleared from the fields; it is
    never put in an address, in storage or in a log.
- **Network:** "Device link" (an "Open on <address>:<port>" line for each address, or "Closed. It opens when a phone is
  paired." with the port, 47800), the paired phones, this hub's fingerprint (the first 16 hex characters in groups of
  four, the whole of it as the title) and the Alexa route's note.

A lock (idle time, Windows Hello or a PIN) and licences are not built yet.

## Widgets

A widget is a tile on a board. A board is a grid of 12 columns with rows of 80 px and a 16 px gap; a tile takes
whole cells. Each widget has a default and a smallest size in cells (width x height), its own small settings, and
four states it must handle: loading (a skeleton of its real shape), empty (one line on why and what to do), error
(what failed and a retry), and "not allowed" (which switch to turn on). A tile keeps the height of its cells; when
its content is taller, its body scrolls inside it. A tile of a type this version does not know (made by a newer
version) says "This tile is not in this version." and can still be moved or removed.

| Widget | Title | Shows | Default | Smallest | Settings |
|---|---|---|---|---|---|
| `today` | Today | Counts since midnight: calls, messages, mail, approvals waiting, what Mini did | 6 x 2 | 3 x 2 | Which counts: Calls, Messages, Mail, Waiting, Mini did (all by default) |
| `week` | This week | What came in and what Mini did, day by day | 5 x 3 | 4 x 3 | n/a |
| `mini` | Mini | The bot, its state, an ask box | 4 x 3 | 3 x 2 | n/a |
| `mini-activity` | What Mini did | Mini's latest actions | 6 x 3 | 3 x 2 | How many: 3, 5 (the default), 8 or 12 |
| `device-status` | Phone | One device: online, battery, last seen | 3 x 3 | 2 x 2 | Which device: a phone or this PC (the first phone by default, else this PC) |
| `devices` | Devices | Every device and whether it is online | 3 x 3 | 3 x 2 | n/a |
| `calls` | Calls | Recent calls | 4 x 3 | 3 x 2 | Missed calls only |
| `messages` | Messages | Recent SMS and chats | 8 x 3 | 3 x 2 | Which apps (ticks; none ticked means all; text messages are "SMS") |
| `notifications` | Notifications | Other notifications | 4 x 3 | 3 x 2 | Which apps (ticks; none ticked means all) |
| `mail` | Mail | Recent mail | 6 x 3 | 3 x 2 | Which account (or all), unseen only |
| `approvals` | Waiting for you | Waiting approvals with Yes and No: the "Waiting for you" tile | 4 x 2 | 3 x 2 | n/a |
| `quick-actions` | Quick actions | Buttons the owner defines: an action or a prompt for Mini | 6 x 1 | 2 x 1 | The buttons: up to 8, each with a label |
| `note` | Note | A text note | 3 x 2 | 2 x 1 | The text (at most 2,000 characters) |
| `clock` | Clock | Time and date | 2 x 1 | 2 x 1 | Hours (as Windows does, 12-hour, 24-hour), seconds, date |

**Tile settings** open from the gear or Enter in edit mode, in a dialog named "Settings for <title>". Each change is
saved with the board as it is made (text a moment after typing stops, when the box is left and when the dialog
closes, so a sentence is one change to undo); Esc closes. A tile with none says "This tile has no settings." A setting
that names something that is gone (a removed phone or mail account) falls back to the default.

- **Phone**: Device, a phone or this PC (a PC shows its memory, disk and uptime, with no battery).
- **Calls**: "Missed calls only".
- **Messages**, **Notifications**: ticks for the apps seen in the last 200 events of that kind (text messages as
  "SMS"); none ticked means all. The tile looks through the newest 50 events for the ones that match, then shows its
  usual number.
- **Mail**: "All accounts" or one account; "Unseen only".
- **What Mini did**: how many, 3, 5, 8 or 12.
- **Today**: which counts, at least one.
- **Clock**: Hours ("As Windows does", "12-hour", "24-hour"), Seconds, Date (on by default). The time updates every
  second with seconds on, else each minute.
- **Note**: a text area, at most 2,000 characters, with a counter. The tile shows it as written (line breaks kept,
  any language) and blurs it in privacy mode; empty, it says "An empty note. Write in it from this tile's settings."
- **Quick actions**: a list of at most 8 buttons, each with Move up, Move down and Remove, and **Add a button**. A
  button has a label (1 to 40 characters) and either "A prompt for Mini" with its text (1 to 2,000) or "An action"
  chosen from what the hub offers the owner: only actions that need no arguments (this PC's lock, sleep, restart and
  shut down; a phone's status; the mail check), with a choice of device where the action lists devices. A button
  that is not complete is not saved. On the tile, a prompt goes to Mini ("Sent to Mini. The reply is on the Mini
  screen."; when Mini is not running, the error and **Start Mini**). An action goes through the hub's normal action
  route as the owner's own call, which the hub runs at once (the owner's own press is the yes, `03`). So for an
  important action (this PC's sleep, restart, shut down) the tile's "Are you sure? <title>" with Yes and No is the
  only question: Yes runs it, No leaves it. Yes cannot be pressed for the first 600 ms and ignores the second click of
  a double click; focus goes to No when the question appears and back to the button after it. The tile follows the
  result for up to 30 seconds ("Done." or the error). A button whose action is gone is disabled: "This action is not
  available now." A prompt button shows its text as a tooltip; labels and the note are shown with hidden direction
  characters made visible (as for other people's words).

**Add a tile** (in edit mode, and on an empty board) opens the gallery, a dialog named "Add a tile" with one card for
each kind of tile: its title, one line on what it shows, its usual size ("4 by 3"), a live preview of the real tile at
that size scaled to the card (not usable), and **Add**. Add puts the tile at the bottom of the board at its usual
size, closes the gallery, gives the new tile focus (and enters edit mode) and says "Added <title>."; at 60 tiles it
says why it cannot. Tab goes from one card's Add to the next; Esc closes. Both dialogs keep focus inside, leave the
page behind them out of reach, and give focus back to what opened them.

Not built, and why:

- `phone-usage` (battery over the day, time per app, 6 x 3): the phone sends no app use and the hub keeps no
  battery history; it waits for a phase that collects app use.
- `phone-actions` (ring, mirror, Do Not Disturb, 3 x 2): ring, mirror and Do Not Disturb are Phase 5 actions.
- `home-room` (3 x 3), `home-device` (3 x 2), `home-scenes` (6 x 1) and `voice-requests` (4 x 3): the house and
  the Echo Dot come in Phase 6.

A widget fetches through the same API as the screens and shows only what the person may see, which is everything.

## Making it one's own

- **Boards**: up to 20, each named (1 to 40 characters) and holding up to 60 tiles ("A board holds 60 tiles at
  most."). They are tabs above the grid ("Home", "House", "Work"); a long name is cut short, with the whole name on
  hover, and the tabs wrap onto more lines. Arrow keys move between tabs (Home and End to the first and last),
  Enter opens one; a tab can be dragged to a new place. **New board** asks for the name in place. The open board is
  in the address (`#/?board=<id>`); without one, the board opened last on this computer opens (kept in the window's
  own storage, key `minihub.board`), else the first. Only the first board shows the headline numbers.
- **Board options** (the `...` button after the tabs, for the open board): Rename, Duplicate (a copy named "<name>
  copy" with the same tiles), Move left, Move right, Reset to the default (asks "Put the default tiles back on
  <name>?") and Delete (asks "Delete <name>? Its tiles go with it."; not offered for the only board). Deleting the
  first board makes the next one first, with the numbers. Making, renaming, deleting and resetting a board is written to
  the activity log; reordering, moving and resizing are not.
- **Edit mode** (the pencil beside the board's name, or right-click a tile, which then has focus): each tile shows a
  bar with its move handle, a gear for its settings and `x` to remove it, and a corner to resize it; its content
  cannot be used while editing. The head shows **Add a tile**, **Undo** and **Done**.
  Drag the bar to move a tile and the corner to resize it: a dashed box shows where it will land and the others
  make room. A tile dropped on another pushes it down; then every tile rises as far as it can, so nothing overlaps
  and no gap is left above a tile. A tile is never wider than the 12 columns nor smaller than its smallest size.
- **Keys** in edit mode (the tile with focus has a visible ring; everything works without a mouse): arrows move it
  one cell (moving down, it goes past the tile below, since tiles always rise); Shift + Right or Down makes it one
  cell bigger, Shift + Left or Up one smaller; Delete or Backspace removes it; Enter opens its settings; Ctrl+Z
  undoes; Esc leaves edit mode. Each change is shown under the head and said to screen readers: "Moved <title> to
  column <n>, row <n>.", "<title> is now <w> by <h>.", "Removed <title>. Undo with Ctrl+Z."
- **Saving**: every change is shown at once and saved to the hub (a drag when it is dropped), one save at a time per
  board: while one is on its way, only the newest layout waits to follow it. If the hub refuses a change, the board
  goes back to the last saved layout, fetches the hub's own copy, and says "That change was not saved: <reason>"; the
  refused change leaves nothing to undo. A change made to the board in another window shows here as soon as the hub
  says so. While a tile is being dragged that news waits; at the drop the board's newest copy is fetched first and
  the move is made on top of it, so the other change is kept.
- **Undo** keeps the last ten layouts of each board in this window's memory only: they are gone when the window is
  reloaded, and after Reset to the default. Undo puts the whole board back as it was before the last change made in
  this window, so it also takes back anything changed in another window since then. "Undid the last change." is said
  once the hub has it; a refused Undo keeps its step, to try again.
- Ctrl+Z and Esc work anywhere on the page in edit mode (not while typing). Removing the last tile moves the focus to
  Undo; closing the name box or a question under the tabs gives the focus back to what opened it.
- **Below 900 px wide** the board is one column in reading order (by row, then column), each tile as tall as its
  rows; the pencil is off ("Widen the window to arrange tiles.") and edit mode ends.
- **Rail**: reorder sections, hide ones not used (not built: the Claude look replaced the rail with a pill bar).
- **Look**: theme, accent, density, privacy mode.
- **Quick actions**: the Quick actions tile (see Widgets): the owner writes a label and picks either an action (lock
  this PC, check the phone) or a prompt for Mini ("Summarize what I missed since this morning").

## Words

- Plain, short, in the owner's terms: "Mini may use", "always asks first", "home Wi-Fi", not "scope", "grant", "LAN".
- A button says what it does: "Pair this phone", "Send reply", "Remove and delete its data".
- An error says what happened and what to do: "The phone is not connected. It will sync when it is on your home Wi-Fi."
- Times are relative when recent ("2m", "1h") and exact on hover; dates follow Windows' format.
- No exclamation marks, no "Oops", no "successfully".

## Accessibility

- Every action reachable by keyboard; the tab order follows the reading order; `Esc` closes the top layer.
- Controls have names for screen readers; state changes that matter (an approval arriving, Stop) are announced.
- Targets are at least 32 x 32 px (24 in compact rows, with a larger hit area).
- Nothing depends on colour alone or on hover alone.
- Text scales with Windows' text size up to 150% without clipping.

## The phone app's look

The same tokens and the same bot. The phone app adds a **Nothing** theme the owner can choose: pure black and
white, the accent in red, dot-matrix numerals (the open-licence "Doto" face, bundled) for big figures, and
monochrome widgets that sit with Nothing's own. Its screens are in `08-android-app.md`.

## Left to the builder

- The exact skeletons, icons per event type, and illustrations for empty states (keep them to the bot in a small pose and one line).
- Mockups: before Phase 1's dashboard work, produce the Home, Inbox and Permissions screens as real pages in
  both themes and have the owner look at them. The look is theirs to judge.

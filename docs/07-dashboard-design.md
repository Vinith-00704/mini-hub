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
- **Command box** (`Ctrl+K`): type to search everything (people, messages, mail, devices, settings) or to ask
  Mini. Enter on plain text asks Mini; arrow keys pick a result. Results show where they come from.
- **Approval card**: when Mini needs a yes, a card slides in at the bottom right on every screen, with the exact
  action, Yes and No, and a countdown. More than one stack.
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
| Calls           | Messages                              | Living room          |
| Asha    missed  | Ravi (WhatsApp)  Are we still on...   | Lamp        [ on  ]  |
| +1 555  4 min   | Bank (SMS)       Your OTP is ...      | Fan         [ off ]  |
| Mum     missed  | Team (WhatsApp)  3 new                | TV plug     [ on  ]  |
+-----------------+---------------------------------------+----------------------+
| Mail                                   | What Mini did                         |
| Priya    Invoice for November          | 14:02  Read 3 messages    allowed     |
| GitHub   [repo] Build failed           | 13:40  Lamp on            allowed     |
| Uni      Timetable change              | 13:12  Send SMS to Asha   you said yes|
+----------------------------------------+---------------------------------------+
```

The default board, shown the first time. It is the owner's to change.

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
- One-time codes are masked in lists until the owner hovers or selects them.
- Empty: "Nothing yet. Turn on what to collect in Permissions," with a button.

### Devices

A grid of device cards: icon, name, room, an online dot, two or three facts (battery, last seen), and its most
used action. **Add device** is the first card.

A device's page:

- **Status**: live state, last sync, software version.
- **What it shares**: its collect switches.
- **What Mini may do with it**: its grants, the same switches as in Permissions, filtered to this device.
- **Actions**: buttons for what can be done by hand (ring, mirror, lock).
- **History**: its recent events and Mini's actions on it.
- **Remove**, with the choice to delete what it sent.

**Add device** is a wizard driven by the connector's setup steps (`06`): pick the kind, follow the steps, land on
the new device's page with everything off and the question "What should this device share?"

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

Appearance (theme, accent: "follow my bot" or a colour, density, privacy mode), Boards, Data (how long things are
kept, export, import, delete), Network (the device link's address and port, the Alexa tunnel's state), Start-up
(start with Windows, the global key), Lock (idle time, Windows Hello or a PIN), About (versions, the data folder,
licences).

## Widgets

A widget is a tile on a board. Each has a minimum and a default size in grid cells (12 columns, rows of 80 px),
its own small settings, and four states it must handle: loading (a skeleton of its real shape), empty (one line
on why and what to do), error (what failed and a retry), and "not allowed" (which switch to turn on).

| Widget | Shows | Default size | Settings |
|---|---|---|---|
| `today` | Counts since midnight: missed calls, messages, mail, approvals waiting | 6 x 2 | Which counts |
| `mini` | The bot, its state, an ask box | 3 x 2 | n/a |
| `mini-activity` | Mini's latest actions | 6 x 3 | How many, which devices |
| `device-status` | One device: online, battery, last seen | 3 x 2 | Which device |
| `calls` | Recent calls | 4 x 3 | Missed only |
| `messages` | Recent SMS and chats | 8 x 3 | Which apps |
| `notifications` | Other notifications | 4 x 3 | Which apps |
| `mail` | Recent mail | 6 x 3 | Which account, unread only |
| `approvals` | Waiting approvals with Yes and No | 4 x 2 | n/a |
| `home-room` | A room's devices as switches | 3 x 3 | Which room |
| `home-device` | One home device, larger | 3 x 2 | Which device |
| `home-scenes` | Scene buttons | 6 x 1 | Which scenes |
| `phone-usage` | Battery over the day, time per app | 6 x 3 | Range |
| `phone-actions` | Ring, mirror, Do Not Disturb | 3 x 2 | Which actions |
| `voice-requests` | What was asked through the Echo Dot | 4 x 3 | n/a |
| `quick-actions` | Buttons the owner defines: an action or a prompt for Mini | 6 x 1 | The buttons |
| `note` | A text note | 3 x 2 | The text |
| `clock` | Time and date | 2 x 1 | Format |

A widget fetches through the same API as the screens and shows only what the person may see, which is everything.

## Making it one's own

- **Edit mode** (a pencil on the board's title, or right-click a tile): tiles show handles; drag to move, pull a
  corner to resize, `x` to remove, a gear for the tile's settings. **Add widget** opens a gallery with a live
  preview of each. Changes are saved as they are made; **Undo** covers the last ten.
- **Boards**: more than one, named, switched from tabs above the grid ("Home", "House", "Work"). Reorder by
  dragging; duplicate; delete; "reset to the default".
- **Rail**: reorder sections, hide ones not used.
- **Look**: theme, accent, density, privacy mode.
- **Quick actions**: the owner writes a label and picks either an action (ring the phone, a scene) or a prompt for
  Mini ("Summarize what I missed since this morning").
- Keyboard: everything in edit mode works without a mouse (move with arrows, resize with Shift+arrows).

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
- The command box's ranking of results.
- Mockups: before Phase 1's dashboard work, produce the Home, Inbox and Permissions screens as real pages in
  both themes and have the owner look at them. The look is theirs to judge.

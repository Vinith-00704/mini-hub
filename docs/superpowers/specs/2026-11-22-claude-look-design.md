# The Claude look: one redesign for the dashboard and the phone app

Status: approved by the owner on 2026-11-22 after seeing the sample images (PC and phone Home, dark and light),
with one addition: small retro animations (below). Replaces the look in `docs/07-dashboard-design.md` (Tokens, The
frame, Home) and `docs/08-android-app.md` (The app's own screens) where they differ; their screen contents and
rules still stand.

## Intent

The owner wants Mini Hub to feel like Claude Code: high contrast, black and orange, bold and graphic, with green
and red only where they mean something. They gave two kinds of samples:

- **The look** (nine phone screenshots of an explainer in the Claude Code style): thick ink outlines with a hard
  offset shadow, one orange accent, heavy uppercase labels with wide letter spacing, mono text for commands
  (`/ig-reel`), cards drawn as little windows with a title bar (`□□□ SESSION · ACME-APP`), segmented progress bars,
  diagonal-stripe "limit" bars, a semicircle gauge, a bar chart with a threshold line, small bordered tags
  (`ILLUSTRATIVE`), pill tags, dashed placeholder boxes, a dotted-paper background. Only the style is wanted, not
  the content.
- **The layout** (two dashboard screenshots): a dense board that fills the screen: a pill navigation bar on top,
  a large heading, a row of big headline numbers with small up/down chips, a bento grid of mixed tiles (charts,
  gauges, lists with percentages, a day strip), skeletons while loading. Only the layout and feel are wanted, not
  their pastel theme.

Both the PC dashboard and the phone app get the same look and the same parts ("make sure both have the same UI
UX"). Every button that exists must work against the owner's real data. The owner tests by hand.

## Decisions the owner made

1. **Two themes from one set of parts.** Dark is the default: pure black ground, ink drawn in off-white, orange
   accent. Light is the samples' cream dotted paper with black ink. Switchable in Settings on each device.
2. **Order.** This redesign plus making every existing button work comes first. Reading calls, SMS, chats and
   notifications on the phone (Phase 2b) and mail (Phase 4) come after; until then their tiles say plainly that
   they are not connected, never show made-up data.
3. **Approach: a shared design kit, native on each side** (option 1 of three):
   - *Chosen:* one token file generates the dashboard's CSS variables and the phone app's Kotlin tokens; the same
     set of parts is built in React and in Android Views. Same look, phone stays light, the floating bot stays
     native.
   - *Not chosen:* the phone app showing the dashboard in a WebView (identical by construction, but the phone's
     own data would need a new bridge, +10–20 MB and +100–200 MB memory against the 150 MB target, and the
     phone's own screens differ anyway).
   - *Not chosen:* rewriting the phone app in Jetpack Compose first (same result, more work, no visible gain).
4. **The PC app is the desktop app**, not a browser page. The browser view (`npm run dev`) stays only as the
   developer's tool. At the end the desktop installer is rebuilt with the new code.
5. **Testing.** The owner tests by hand. The builder does not write new test suites for this work; the existing
   automated tests must still pass (they are a check that nothing broke), and the builder checks each screen in
   both themes and walks through every button against a running hub before handing over.

## Goals

- The same look on the PC and the phone: one token source, one set of parts, one vocabulary of states.
- Every control in the inventory below does what its label says, against real data, with a visible result or a
  plain error.
- The Home board fills the screen with real information: headline numbers, charts, the phone, Mini, devices,
  what is waiting.
- Loading, empty, "not connected yet", error and "switched off" states drawn the same way everywhere.

## Non-goals

- New data sources (calls, SMS, chats, notifications, mail, home devices). Their tiles exist and say what is
  missing and where to turn it on.
- Rearranging tiles by hand (boards stay fixed in this round; `07` > Making it one's own is later).
- Changing what the hub stores or the link protocol (one read-only statistics route and the planned `share` field
  on Mini's prompt are added, below).

## Anti-goals (a failure even if it works)

- Made-up, sample or "illustrative" numbers in the real app. A tile with no data says so.
- A button that looks clickable and does nothing, or fails silently.
- Orange everywhere: the accent marks the one primary action or the current item, not decoration.
- Losing the safety rules: Stop always visible, approvals never answered by Mini, consent always the owner's tap.

## The look

### Tokens (one file: `design/tokens.json` at the repository root)

A small script turns it into `ui/src/design/tokens.css` (the variables block) and
`android/app/src/main/java/app/minihub/phone/ui/Tokens.kt`; a check mode fails the build when either is out of date.

| Token | Dark | Light | For |
|---|---|---|---|
| `ground` | `#000000` | `#F6F3EC` | The window / screen |
| `dots` | `#1C1C1C` | `#D9D4CA` | The dotted-paper grid on the ground (1 px dots, 16 px apart) |
| `card` | `#0A0A0A` | `#FFFFFF` | Inside a card |
| `card-bar` | `#161616` | `#E9E5DC` | A card's title bar, a table head |
| `ink` | `#F2EEE6` | `#111111` | Outlines, main text, the hard shadow in light |
| `ink-2` | `#B8B2A7` | `#4A4640` | Secondary text |
| `ink-3` | `#7D776D` | `#8A847A` | Hints, timestamps, disabled |
| `shadow` | `#3A3631` | `#111111` | The hard offset shadow (dark uses a warm grey so it reads as a ledge, not a glow) |
| `accent` | `#D97757` | `#D9693F` | Primary action, current item, progress fill (Claude Code orange; light is a step deeper for contrast on cream) |
| `on-accent` | `#000000` | `#000000` | Text on orange |
| `ok` | `#3FB950` | `#1F7A35` | On, online, allowed, done |
| `danger` | `#F85149` | `#C42B24` | Stop, off-for-safety, refused, failed, delete |
| `warn` | `#E3B341` | `#9A6700` | Waiting, ask |

- **Lines**: 2 px ink outlines on cards, buttons, inputs, tags. Hairlines inside cards are 1 px `ink-3`.
- **Shadow**: hard and offset, no blur: cards `4px 4px 0 shadow`, buttons `3px 3px 0 shadow`. Pressing a button moves
  it 2 px down-right and halves the shadow.
- **Corners**: square everywhere, except pills (tags, the section bar, segmented choices), which are fully round.
- **Type**: **Archivo** (variable; OFL; bundled) for everything; **JetBrains Mono** (OFL; bundled) for commands,
  codes, addresses, times and numbers that must line up. Labels and headings in uppercase Archivo 800 with
  `0.06em` tracking; body in sentence case Archivo 400/500; headline numbers Archivo 900. Sizes: display 56/52,
  number 32/36, title 22/28, label 13/16 (uppercase), body 15/22, small 13/18, micro 11/14. Fonts ship inside both
  apps; nothing is fetched from the internet.
- **Motion**: 120 ms press, 180 ms panels, the same easing as today. Skeletons shimmer with moving diagonal
  stripes. "Reduce motion" turns movement into fades.
- **Contrast**: text and icons meet WCAG AA on their ground in both themes; colour never carries meaning alone
  (a word or an icon goes with it).

### The parts (built once in React, once in Android Views, same names)

| Part | What it looks like | Used for |
|---|---|---|
| `Window` | A card with a title bar: three small hollow squares, an uppercase title, optional tag on the right | Every tile and panel |
| `Button` | Primary: orange fill, black text, ink outline, hard shadow. Secondary: card fill. Danger: red outline and text, red fill on hover. Small and normal sizes | All actions |
| `Tag` | Small bordered uppercase label; pill variant | Status (`ONLINE`, `NOT CONNECTED`, `ASK`), counts |
| `Chip` | Tiny pill with an arrow and a number, green up / red down | Changes on headline numbers |
| `Segments` | A row of square cells, filled orange up to a value; dashed cells when empty | Progress, steps, tab bars on the phone |
| `Bar` | Outlined bar with orange fill; striped "limit" state with a black label | Battery, sync backlog, anything with a max |
| `Gauge` | Semicircle, orange arc, big number in the middle, a black label tag under it, 0 and max at the ends | Battery, share of things allowed |
| `Bars` | Outlined bar chart, orange for highlighted bars, cream/grey for others, optional dashed threshold line, values on top | Per-day activity |
| `Stat` | Uppercase label, a big number, a `Chip` | Headline numbers |
| `Row` | A list line: icon box, title, one-line detail, time in mono, trailing tag or action | Lists of calls, messages, devices, activity |
| `Switch` | A square track with an ink outline; orange when on, with the word `ON`/`OFF` beside it | Collect switches |
| `Choice` | Pill segmented control `OFF · ASK · ON`; the chosen one filled (grey for off, orange otherwise) | "Mini may use", "Mini on this phone", "From my PC" |
| `Field` | Ink-outlined input, mono placeholder for commands; orange focus outline | Ask Mini, search, pairing |
| `Skeleton` | The part's own outline with striped shimmer inside | Loading |
| `Empty` | The bot in a small pose, one line, and the one button that fixes it | Empty and not-connected states |

### Retro animations (the owner asked for "small retro, Pac-Man kind of" animations that suit the AI)

Original, built around Mini's own pixel character; no game is copied (no Pac-Man maze, ghosts or sounds).

- **Munching loader**: Mini's pixel sprite walks along a row of dots, eating them one by one (a two-frame mouth,
  stepped movement); used for loading a screen, pairing, "Check now", Mini starting. Replaces spinners.
- **Thinking**: an 8-bit block cursor blinking after the reply while Mini writes; the sprite bobs in two steps.
- **Asleep**: the sprite dims and blinks slowly; a small pixel "z" rises in steps.
- **Arrivals**: a new row or tag drops in with a 3-step pixel slide; numbers that change tick like an arcade counter.
- **Stopped**: the striped stopped bar scrolls its stripes slowly.
- All motion uses `steps()` timing (chunky, 8-bit), lasts at most 600 ms except loaders, and turns into a plain fade
  (or nothing) with "reduce motion" on (Windows or Android). The phone runs them only while the screen is on and
  the view is visible.

### States, the same on both

- **Loading**: skeleton of the real shape, never a spinner alone.
- **Empty**: what is missing in one line, and the button that fixes it ("Turn on calls in Permissions").
- **Not connected yet**: `NOT CONNECTED` tag and what it needs ("Comes with the phone's calls update").
- **Switched off for Mini**: a `SWITCHED OFF` tag; the data is still shown to the owner.
- **Error**: red outline, the hub's own sentence, and Retry.
- **Stopped**: a full-width striped bar `MINI IS STOPPED` with Resume (PC) / Start Mini (phone).

## Layout

### PC (the desktop app's window, 1280×800 and up; usable down to 900 wide)

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ✳ MINI HUB   ( HOME | INBOX | DEVICES | MINI | ACTIVITY | PERMISSIONS | SETTINGS )   [/ask mini…] ⊙3 ☾ [■ STOP] │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ HOME                                                  CALLS 12 ▲3   MESSAGES 48 ▼5   MINI 9 ▲2   WAITING 1 │
│ ┌□□□ MINI ───────────────────┐ ┌□□□ THIS WEEK ─────────────────────────┐ ┌□□□ PHONE ───────┐ │
│ │ ✳ IDLE · ON THIS PC        │ │ ▇ ▅ ▆ ▃ ▇ ▂ █  bars per day, today    │ │   ◜ 80% ◝        │ │
│ │ [/ask mini … ]   [ASK]     │ │ in orange, threshold = 7-day average  │ │   CHARGING · WIFI│ │
│ │ last reply …   [STOP BOT]  │ └───────────────────────────────────────┘ │ [CHECK NOW]      │ │
│ └────────────────────────────┘ ┌□□□ WAITING FOR YOU ┐ ┌□□□ DEVICES ────┐ └─────────────────┘ │
│ ┌□□□ CALLS ──────┐ ┌□□□ MESSAGES ───────┐ │ approval cards      │ │ ▢ PC  ▢ phone  [+] │           │
│ │ rows / empty   │ │ rows / empty        │ └─────────────────────┘ └────────────────┘ ┌□□□ MAIL ──┐ │
│ └────────────────┘ └─────────────────────┘ ┌□□□ WHAT MINI DID ─────────────────────┐ │ NOT CONN. │ │
│                                             └───────────────────────────────────────┘ └──────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar** replaces the left rail: the logo, the sections as a pill bar (current one filled), the Ask Mini field,
  the approvals bell with a count, the theme toggle, and **Stop** always visible.
- **Headline numbers** (`Stat`): today's calls, messages, Mini's actions, and things waiting for the owner, each with
  a change against yesterday. Numbers come from a new read-only route (below).
- **Home tiles**: Mini (state, ask, last reply, start/stop), This week (`Bars` of events per day, 7 days, today
  highlighted, dashed line at the average), Phone (`Gauge` for battery, charging, network, last sync, Check now),
  Waiting for you (approvals with Yes/No), Devices (cards, Add device), Calls, Messages, Mail, What Mini did.
- **Other screens** use the same parts: Inbox (the list of everything, filters as `Choice`, the selected item on
  the right; `07` > Inbox, without Reply until Phase 5), Devices and a device's page (as now, restyled, battery as
  `Gauge`), Mini (conversation as a terminal-style log in mono with `>` prompts), Activity (`Row`s with outcome
  tags, filter by who), Permissions (each device as a `Window`, rows with `Switch` + `Choice`), Settings (theme,
  density, privacy, start-up).

### Phone (the Mini app, 360–412 dp wide; the same parts, one column)

```
┌─────────────────────────────┐
│ ✳ MINI            ☾  ⋮      │
│ ┌□□□ MINI ───────── IDLE ┐  │
│ │ ✳  MINI IS ON            │ │
│ │ [/ask mini…]   [SEND]    │ │
│ │ [SHOW BOT]  [STOP MINI]  │ │
│ └─────────────────────────┘ │
│ CALLS 3   MESSAGES 7   MINI 1│
│ ┌□□□ THIS PHONE ──────────┐ │
│ │   ◜ 80% ◝   WIFI · SYNCED │ │
│ └─────────────────────────┘ │
│ ┌□□□ YOUR PC ──── LINKED ─┐ │
│ │ SYNCED 2 MIN AGO [SYNC]  │ │
│ └─────────────────────────┘ │
│ [HOME][ACTIVITY][RECORD][PERMS]│  ← Segments-style tab bar, current one orange
└─────────────────────────────┘
```

- The same screens as now (Home, Activity, Record, Permissions; Your PC and Mini's brain under ⋮), restyled with
  the same parts. A small **Look** choice (Dark / Light / Follow the phone) is added under ⋮.
- The floating bot's panel uses the same `Window`, `Field` and `Button` parts.

## Every control, and what it must do

Each must work against the real hub and the real phone, show a result (or the hub's own error), and match its
label. This is the list the builder walks through before handing over.

**PC**
- Top bar: section pills; Ask Mini (sends to Mini's real session through the hub; when the bot is not running, says
  so and offers Start); approvals bell (opens Waiting for you); theme toggle (saves); **Stop** (stops Mini; the
  stopped bar appears; **Resume** resumes).
- Home: Mini tile Ask / Start / Stop the bot; Phone tile Check now (real command to the phone; shows its answer or
  why it was refused); Waiting for you Yes / No; Devices Add device; Stat tiles open their lists; each list tile
  opens the Inbox filtered to its kind.
- Inbox: `device_state` events are not listed (the device's page shows the state). Filters, search, select an item, mark as seen, delete (confirm), Ask Mini about this item (shares it, with
  the "this shares this item with Mini" warning when Mini's switch is off).
- Devices: Add device (pairing, as built), a device's page (switches, Check now, Remove with "also delete").
- Mini: ask, the conversation, Start/Stop the bot.
- Activity: filter by who; check the log's chain ("Check the log" shows OK or where it broke).
- Permissions: every Switch and Choice saves and says what it means; Disconnect everything (confirm).
- Settings: theme, density, privacy mode, start with Windows (desktop app only; says so in the browser view).

**Phone**
- Home: Ask (to the running bot), Show bot, Start Mini, Stop Mini, Finish setup, Pair with your PC, Sync now.
- Activity: the list. Record: search, Delete (confirm). Permissions: every Switch and Choice, Only change these on
  the phone, Stop Mini, Stop on my PC too. Your PC: Scan, type and Pair, the words, Cancel, Sync now, Forget this
  hub, Pair again. Mini's brain: each setup step's button, Start, Stop. Look: Dark / Light / Follow the phone.
- The bot's panel: Talk, Send, Hide, Stop, Close, Start Mini; the notification's Show and Stop Mini; approvals'
  Allow and Don't allow.

## Additions to the hub

0. `POST /v1/disconnect` (person, as `05` specifies): Stop Mini, then close the device link; for **Disconnect
   everything** in Permissions.


1. `GET /v1/stats?days=7` (person and agent; the agent's copy leaves out kinds its grants do not cover, like
   `/v1/events`): per day for the last *n* days (at most 31), counts of:
   - **came in**: `call`, `sms`, `chat`, `notification`, `mail` events, by type;
   - **Mini did**: the agent's audit rows with action `act` and outcome `done`, plus `mini_action` events from phones;
   - **waiting**: approvals waiting now (today only).
   `device_state`, `app_usage`, `home_state`, `system` and `voice_request` are not counted: a battery tick is
   not news. Read-only, no new storage. The PC's headline numbers and This week use it. **This week** shows two
   series per day, "came in" and "Mini did", with today highlighted and a dashed line at the 7-day average of "came
   in"; when every value is zero it shows the Empty state instead of a flat chart.
2. `POST /v1/mini/prompt` gains `share?: number[]` as `05` already specifies: the hub adds those events' text
   to the prompt and writes the audit line `03` > Sharing one thing by hand requires ("you shared 1 message with
   Mini"). The Inbox's **Ask Mini** uses it.

The **phone** counts its own record (as it does today); it does not ask the hub. Its counts leave out
`device_state` too.

## Constraints

- Everything stays local: fonts bundled, no web fonts or CDNs; no data leaves the PC or the phone.
- The owner commits; nothing is committed by the builder. Consent surfaces stay the owner's taps.
- The existing automated tests keep passing (some tests that check old wording or classes are updated to the new
  wording). No new test suites are required for this work (owner's call).
- Accessibility as in `07` > Accessibility: keyboard reachable, visible focus, AA contrast, words with colours.
- Phone app stays within its targets in `08` > Staying light (no WebView, no Compose).
- The accent is fixed to Claude orange in this look (the old "accent from the bot" setting is removed from
  Settings; the bot keeps its own colours on the PC).

## Checking before hand-over (the owner tests; this is the builder's own walk-through)

- Against a **practice hub on made-up data** (the desktop app or the dev view pointed at a scratch folder), never
  the owner's real hub: every PC control in the list above, including the destructive ones, in both themes.
- **Mini's real session is not used for checks** (a test runtime would pick up the owner's settings): Ask is checked
  up to the hub's answer with the bot stopped or with the dev view's no-bot mode.
- The phone app is built, signed and installed on the owner's phone (as before) and checked screen by screen in
  both looks without pressing consent surfaces or typing with `adb`; the phone's destructive buttons are checked
  only in the trial build (`app.minihub.phone.trial`) paired with the practice hub.
- At the end the desktop installer is rebuilt; the owner installs it and tests by hand on real data.

## Left to the builder

- Exact icons (Lucide on the PC, matching vector drawables on the phone), exact spacing inside parts, the bot's
  small poses for empty states.
- How the token script is written and run (an npm script; a Gradle task or a pre-build check on the phone side).
- Which tiles go where on narrower PC windows (keep the order: numbers, Mini, week, phone, waiting, devices, lists).
- Copy for empty and not-connected states, in the plain style of `07` > Words, uppercase only for labels.

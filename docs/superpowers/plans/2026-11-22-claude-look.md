# The Claude look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the PC dashboard and the phone app in the approved "Claude look" (dark default, light cream
option, one set of parts on both), with small retro animations built on Mini's pixel character, and make every
control in the spec's list work against the real hub and phone.

**Architecture:** One token file (`design/tokens.json`) generates the dashboard's CSS variables and the phone's
`Tokens.kt`. The same parts are built in React (`ui/src/components/look/`) and in Android Views
(`android/.../ui/look/`). The hub gains three routes (`/v1/stats`, `share` on `/v1/mini/prompt`, `/v1/disconnect`).
The dashboard's left rail becomes a top bar; Home becomes a full board; an Inbox screen is added.

**Tech Stack:** existing (React 19, Tailwind 4, TanStack Query/Router, Fastify core; Kotlin Android Views). New:
`@fontsource-variable/archivo`, `@fontsource/jetbrains-mono` (bundled web fonts); Archivo and JetBrains Mono TTFs
(OFL) in `android/app/src/main/res/font/`.

**Spec:** `docs/superpowers/specs/2026-11-22-claude-look-design.md` (approved; read all of it).

## Global Constraints

- **The owner commits.** No task commits. No real data in tracked files; mockups and checks use made-up data.
- **Testing (owner's call):** the owner tests by hand. No new test suites. After each task the existing checks must
  pass: `npx vitest run core protocol ui`, `npx tsc -p core && npx tsc -p ui`, `npm run build -w @minihub/ui`, and on
  the phone `./gradlew :app:testDebugUnitTest :app:assembleRelease` from `android/`. Existing tests that assert old
  wording, class names or layout are updated to the new design, never deleted to make a run pass.
- Tokens exactly as the spec's table. Square corners except pills. 2 px ink outlines; hard offset shadows (cards 4 px,
  buttons 3 px); no blur shadows anywhere.
- Fonts bundled on both sides; no request leaves the machine for fonts or anything else.
- Accent is fixed Claude orange; the "accent" choice is removed from Settings (the stored value is ignored).
- No made-up data in the real app. Tiles without a source show the spec's **Not connected yet** state.
- Animations use `steps()` timing and stop/turn into fades under reduced motion (`prefers-reduced-motion` on the PC;
  `Settings.Global.ANIMATOR_DURATION_SCALE == 0` on the phone).
- Safety stays: Stop always visible on both; approvals answered only by the owner; consent screens are the owner's taps.
- Nothing typed into the phone with `adb input`.

## Review Focus

1. **A control that changes data but the screen does not refresh** (live topic not invalidating the right query):
   every mutation invalidates what it changed, or the screen updates from `/v1/live`.
2. **Errors swallowed**: every failing call shows the hub's own sentence in the part's Error state.
3. **Long names and big numbers** (a 60-character device name, 10,000 messages) overflow cards: ellipsis and
   `tabular-nums`, no horizontal scroll at 900 px wide or on a 360 dp phone.
4. **Light theme contrast** of orange text on cream and `ink-3` hints: AA where it is text.
5. **Animations under reduced motion** and the phone's battery: loaders stop when off screen.

---

### Task 1: Tokens and fonts on both sides

**Files:** create `design/tokens.json`, `tools/tokens.mjs`; modify `ui/src/design/tokens.css` (generated block between
`/* tokens:start */` and `/* tokens:end */`, Tailwind `@theme` mapping), `ui/package.json`, `package.json` (script
`tokens`); create `android/app/src/main/java/app/minihub/phone/ui/look/Tokens.kt` (generated),
`android/app/src/main/res/font/{archivo.ttf, jetbrains_mono.ttf}`.

**Produces:** CSS variables `--ground --dots --card --card-bar --ink --ink-2 --ink-3 --shadow --accent --on-accent --ok
--danger --warn` under `[data-theme='dark']` (and `:root`) and `[data-theme='light']`; Tailwind colours with the same
names; font families `font-sans` = Archivo, `font-mono` = JetBrains Mono; Kotlin `object Tokens { object Dark {…};
object Light {…} }` with `Int` colours; `node tools/tokens.mjs` writes both, `--check` exits 1 when either is stale.

- [ ] Write `tokens.json` from the spec's table (also sizes: type scale, outline 2, shadow card 4 / button 3, dots 16).
- [ ] Write `tools/tokens.mjs` (generate + `--check`); run it; add `"tokens": "node tools/tokens.mjs"`.
- [ ] Install the two fontsource packages (latest at least two weeks old); replace the Geist imports; set the dotted
  ground on `body`. Fetch the two OFL TTFs (Google Fonts repository) into `res/font/` with their licence text in
  `android/app/src/main/assets/licenses/`.
- [ ] Checks (Global Constraints) pass.

### Task 2: Hub additions

**Files:** create `core/src/api/routes/stats.ts`; modify `core/src/api/routes/{mini.ts, rules.ts}`, `core/src/api/server.ts`,
`core/src/hub.ts` (a `disconnect()`), `ui/src/app/{queries.ts, api.ts}`.

**Produces:** `GET /v1/stats?days=7` → `{ days: [{ date: 'YYYY-MM-DD', cameIn: { call, sms, chat, notification, mail },
miniDid }], today: { calls, messages, notifications, mail, miniDid, waiting }, yesterday: { …same } }` exactly as the
spec counts them (person and agent; agent copy drops kinds whose `mini` grant is off); `POST /v1/mini/prompt`
accepts `share?: number[]` (max 5), appends each event's who/title/body to the prompt, audits
`{ caller: 'person', action: 'share', target: '<n> <kind>' }`; `POST /v1/disconnect` (person) = `hub.stopMini('person')`
then `hub.link.close()`; UI hooks `useStats(days)`, `useInbox(params)`.

- [ ] Implement; dates are local days of the PC.
- [ ] Checks pass; `curl` each route against the practice hub and read the answers.

### Task 3: The parts and the retro animations (PC)

**Files:** create `ui/src/components/look/{Window,Button,Tag,Chip,Segments,Bar,Gauge,Bars,Stat,Row,Switch,Choice,Field,
Skeleton,Empty,PixelBot,Munch}.tsx` and `look.css` (keyframes); keep old `components/ui/*` only until each screen moves,
then delete them in Task 7.

**Produces:** the spec's parts with these props: `Window({ title, tag?, action?, state?: 'ready'|'loading'|'empty'|
'error'|'not-connected'|'off', emptyText?, emptyAction?, error?, onRetry?, children })`; `Button({ variant:
'primary'|'secondary'|'danger', size?: 'sm'|'md', busy? })` (busy shows `Munch` small); `Stat({ label, value, delta? })`;
`Gauge({ value, max, label?, tag? })`; `Bars({ days, highlight, average })`; `Choice({ label, value, onChange })`
(off/ask/on); `PixelBot({ state: 'idle'|'thinking'|'asleep'|'listening', size })` (the bot's 12×10 pixel art in the
accent); `Munch({ width })` (PixelBot walking and eating dots, `steps()`); arrival and counter animations as CSS classes.

- [ ] Build the parts to match the sample images (`scratchpad/look/*.png` were approved) in both themes.
- [ ] A dev-only page `#/look` shows every part in every state for checking (not in the nav).
- [ ] Checks pass; look at `#/look` in both themes and with reduced motion.

### Task 4: The frame

**Files:** modify `ui/src/features/frame/{Frame.tsx, TopBar.tsx, ApprovalCards.tsx, look.ts}`, `ui/src/app/router.tsx`.

The left rail goes; the top bar holds: logo, section pills (Home, Inbox, Devices, Mini, Activity, Permissions,
Settings; current filled orange), Ask Mini `Field` (sends to `/v1/mini/prompt`; bot not running → says so with a Start
button), approvals bell with count (opens a panel of `ApprovalCards`), theme toggle (dark ↔ light, saved through
`/v1/settings`), **Stop** (red). Stopped → full-width striped bar with **Resume**. Page heading in display type.

- [ ] Implement; every control above works against the practice hub.
- [ ] Checks pass (update `frame.test.tsx` for the new structure).

### Task 5: Home board

**Files:** modify `ui/src/features/home/Home.tsx`, `ui/src/widgets/*` (restyled with the parts).

Headline `Stat`s from `/v1/stats` (calls, messages, Mini did, waiting, each with delta against yesterday; waiting
has none). Tiles in the spec's order: Mini (state, last reply in mono, Ask, Show bot, Start/Stop the bot), This week
(`Bars`), Phone (`Gauge` battery, network, last sync, Check now → `POST /v1/actions status`, ticket shown with `Munch`),
Waiting for you (Yes/No), Devices (cards, Add device → `#/devices?add=1`), Mail (Not connected yet), What Mini did,
Calls, Messages (each opens the Inbox filtered). Grid fills 1280×800 like the sample; collapses in order below 1100.

- [ ] Implement; checks pass (update `home.test.tsx`).

### Task 6: Inbox

**Files:** create `ui/src/features/inbox/Inbox.tsx`; route `/inbox`.

Left: one timeline (newest first, grouped by day, unseen dot), `Choice`-style filters All/Calls/Messages/Mail/
Notifications, device filter, Unseen, search (`q`). `device_state` never listed. Right: the selected item with its
person's recent items, **Mark seen** (`POST /v1/events/seen`), **Delete** (confirm; `DELETE /v1/events`), **Ask Mini**
(prompt + `share: [id]`; shows "This shares this item with Mini" when that kind's grant is off). One-time codes
masked until selected. Empty: "Nothing yet. Turn on what to collect in Permissions." with the button.

- [ ] Implement; checks pass.

### Task 7: The other PC screens

**Files:** modify `ui/src/features/{devices/*, mini/MiniScreen.tsx, activity/Activity.tsx, permissions/Permissions.tsx,
settings/*}`; delete `ui/src/components/ui/*` when unused.

- Devices / device page / Add phone: the parts; battery `Gauge`; pairing waits with `Munch`; words as big `Tag`s.
- Mini: conversation as a terminal log (mono, `>` prompts, block cursor while writing), Ask, Start/Stop the bot.
- Activity: `Row`s with outcome tags; filter by who; **Check the log** (`GET /v1/audit/check`: OK or "changed at row n").
- Permissions: each target a `Window`, rows `Switch` + `Choice`, the phone's lists read-only; **Disconnect everything**
  (confirm → `POST /v1/disconnect`).
- Settings: Look (Dark / Light / Follow Windows), density, privacy mode, start with Windows (desktop app only; says
  so in the browser view); accent removed.

- [ ] Implement; checks pass (update `screens.test.tsx`, `devices.test.tsx`).

### Task 8: The parts and animations on the phone

**Files:** create `android/.../ui/look/{Look.kt (theme choice + current palette), Parts.kt (WindowCard, LookButton
with shadow and press offset, Tag, Segments, BarView, GaugeView, ChoiceView, SwitchRow, Field), PixelBot.kt
(sprite view with idle/thinking/asleep/listening and steps animation), Munch.kt (loader)}`; modify `overlay/SpriteView.kt`
to use `PixelBot` drawing.

**Produces:** `Look.current(context): Palette` (Dark, Light, or the phone's night mode), saved in prefs key `look`;
parts drawn with `Canvas`/`GradientDrawable` (2 dp outline, hard offset shadow drawn as a second rect), Archivo/JetBrains
Mono via `ResourcesCompat`-free `context.resources.getFont(R.font.…)`; animations stop in `onDetachedFromWindow`
and when the screen is off; reduced motion respected.

- [ ] Implement; checks pass.

### Task 9: The phone screens and the bot's panel

**Files:** modify `ui/{Kit.kt, Screens.kt}`, `MainActivity.kt` (top bar with ☾ and ⋮; tab bar as boxed tabs, current
orange; ⋮ menu adds **Look**), `overlay/Overlay.kt` (panel as a `WindowCard` with `Field` and `LookButton`s).

Every phone control in the spec's list works: Home (Ask, Show bot, Start, Stop, Finish setup, Pair, Sync now; counts
from the phone's own record without `device_state`; battery `BarView`; Your PC with `Segments` of the sync backlog),
Activity, Record (search, Delete), Permissions (all switches and choices, lock, Stop, Stop on my PC too), Your PC
(Scan, type and Pair with words, Cancel, Sync now, Forget, Pair again), Mini's brain (setup buttons, Start, Stop), Look.

- [ ] Implement; checks pass; bump `versionName` to 0.3.0 (`versionCode` 3).

### Task 10: Walk-through, installer, hand-over

- [ ] Practice hub (made-up data, scratch folder) + dev view: walk every PC control in the spec's list in both
  themes, at 1280×800 and 900 wide; fix what fails. Mini's real session is not used.
- [ ] Trial build (`app.minihub.phone.trial`) paired with the practice hub: walk the phone's list in both looks
  (no consent taps, no `adb input`; screenshots by `adb exec-out screencap`); fix what fails.
- [ ] Rebuild the desktop installer (`npm run build:shell`); install the release APK on the owner's phone
  (`adb install -r`); stop the practice hub and delete its folder.
- [ ] One fresh-reviewer pass over the whole change (correctness and "every control works"), one fix pass.
- [ ] Tell the owner what to install and what to try first; list the rulings made.

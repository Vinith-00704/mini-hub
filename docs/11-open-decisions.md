# 11. Open decisions and risks

What the owner still has to decide. Each has a **default** that the plan uses until they say otherwise, so
nothing here blocks Phase 0 or Phase 1. When a decision is made, write the answer here with the date and change
the page it affects.

## Decisions

### D1. Which home appliances are there?

**Needed by**: Phase 6. **Why it matters**: it decides which adapters are built, and whether the house can be
controlled on the home network or only through a maker's cloud.

Wanted from the owner: a list of each smart device, its brand and model, and the app it is set up in.

**Default**: none assumed. Phase 6 starts with this list.

### D2. May the hub use the owner's Amazon session to control what Alexa controls?

**Needed by**: Phase 6. The `alexa-account` adapter (`06`) can list and switch every device the Alexa app knows,
and make the Echo Dot speak, without knowing any brand. It is unofficial, goes through Amazon, keeps a login
session for the owner's Amazon account in the hub's database, and can stop working when Amazon changes something.

- **Yes**: the quickest way to "control my appliances from the dashboard", and the only way to make the Echo Dot
  itself speak or change volume from the dashboard.
- **No**: only devices reachable directly (Matter, or a maker's local interface) are controlled. The Echo Dot is
  then a voice way in, not something the dashboard controls.

**Default**: **No.** Official and local ways first.

### D3. How does Amazon reach the PC for "Alexa, ask Mini"?

**Needed by**: Phase 6. An Alexa skill needs a public HTTPS address with a trusted certificate.

- **Tailscale Funnel**: free, a stable address, a real certificate, no domain to buy. Installs Tailscale on the
  PC. Only the one Alexa route is published.
- **Cloudflare Tunnel**: free, but needs a domain name managed at Cloudflare.
- **Not at all**: no voice through the Echo Dot.

**Default**: **Not at all**, until the owner picks one. The `alexa` connector is off by default in any case.

### D4. Should the phone reach the hub from outside the home?

**Why it matters**: today's plan syncs only on the home Wi-Fi, which is the most private and the simplest. With a
private overlay network (Tailscale on both devices), the dashboard would stay current while the owner is out, and
the PC could act on the phone from anywhere.

**Default**: **No.** Home only. It can be added later without changing the protocol.

### D5. Which Termux build?

Termux on the phone today is the official GitHub build, which is a "debug" build: a PC connected by USB with
debugging allowed can enter its data, which is where the Claude sign-in lives. The F-Droid build does not allow
that. Moving means uninstalling Termux and redoing the Claude Code install and sign-in (about ten minutes).

**Default**: move to the F-Droid build before Phase 3, and keep USB debugging off when it is not in use.

The phone app's setup screen (Mini's brain) shows which build is installed (step "Termux is the F-Droid build": not
done while Termux is a debug build) and says how to move. It is advice only and never blocks Start; the decision stays
the owner's.

### D6. If Claude Code on the phone stops working

**Needed by**: Phase 3. The Termux route is unofficial.

- **Wait and repair**: the bot says the brain is down and how to reinstall; the phone keeps recording; Mini on
  the PC is unaffected.
- **An API key as a spare brain**: the phone app calls the Claude API with a key the owner pays for separately,
  only while Claude Code is down. This is a second brain and a bill, which the owner's rules exclude unless they
  choose it here.

**Default**: **Wait and repair.**

### D7. The fallback if the plugin does not load in Termux (trial T1)

The phone app would start Claude Code in its headless streaming mode and offer the phone's tools as a local MCP
server. It is still Claude Code on the owner's plan. It loses the Mini Bot plugin's own features on the phone
(routines, `/mini-bot` commands, bot design), which would then be PC-only.

**Default**: accept this fallback if T1 fails, and tell the owner what was lost.

Note: as checked on 2026-11-22, headless use draws from the same plan limits as interactive use; a planned
separate allowance for it was paused. Check again before relying on it.

### D8. A wake word on the phone ("Hey Mini")

Always listening costs battery and keeps the microphone open, which on a phone is a bigger thing than on the PC.

**Default**: **No.** The tile, the bot and the assistant gesture start listening. It can be its own plan later.

### D9. How much of a mail is kept in the hub?

**Default**: sender, subject and the first 2,000 characters of text; attachments listed, not downloaded. Options
in Settings: subjects only, or full text.

### D10. Sending things: should any of it ever be allowed without asking?

The owner's rule is that important actions always ask. Some people later want "reply to my family without asking".

**Default**: **No exceptions.** Every send asks. If the owner wants exceptions later, they are per person and per
kind, set only on the device that sends, and written into `03` first.

### D11. Names

The working names are **Mini Hub** (the PC app), **Mini** (the phone app's name on the home screen), the
application id `app.minihub.phone`, and the data folder `MiniHub`. The application id cannot change after the
first release build without a fresh install.

**Default**: these, confirmed by the owner before Phase 2's first release build.

### D12. Where the keystore that signs the APK is kept

Losing it means later versions cannot be installed over the old one (uninstall, reinstall, pair again).

**Default**: a folder outside the repository that the owner backs up; never in git.

### D13. The Claude phone app as another way in

A custom connector would let the owner talk to Mini's tools from the ordinary Claude app. It needs a public
address, like the Alexa route.

**Default**: not in this plan.

### D14. May Mini on the phone run commands in Termux?

Claude Code can run commands and edit files. On the phone, that would let Mini reach the phone around the phone
app's switches (Android's own command-line tools, Termux's helpers), so the plan starts the phone session with
commands refused and files limited to one work folder (`03`, "Mini's own tools on the phone").

- **No**: the phone app's switches are the only way to the phone. Mini on the phone is an assistant, not a
  coding tool.
- **Yes**: Mini on the phone could also write and run code in Termux, and the phone app's switches would no
  longer be the whole story.

**Default**: **No.**

## Calls made while writing the plan

Not asked of the owner, because a sensible default existed. Each can be changed; say so and the page named changes.

| Call | Why | Where |
|---|---|---|
| The hub is its own repository, not part of the Mini Bot's | The bot's marketplace ships its whole repository to every install | `README.md` |
| Tauri, a Node core, a React dashboard; Kotlin for the phone | Low memory on this PC; the bot's runtime is already Node; the most widely known tools | `02` |
| Both databases are encrypted | "Nothing leaked" | `02`, `03` |
| Switches are per device, and start off | Two phones or two mail accounts should not share one decision | `03`, `04` |
| Three lists: Mini on the PC, Mini on the phone, commands from the PC | Each device protects itself | `03` |
| The hub's approvals are answered in the dashboard only; the bot points there | Keeps the yes out of reach of anything the agent can touch | `03`, `09` |
| An action approved on the dashboard is not asked about again on the phone, unless the phone's switch says ask | Asked once, where the owner is | `03` |
| "Ask Mini" on one item shares that one item even when the switch is off | The owner's own press is the yes, as with "summarize this page" | `03` |
| Stop on the PC also stops Mini on linked phones; each device is resumed on itself | "One button stops everything", without one device being able to restart another | `03` |
| Voice limits are enforced by the plugin and the core, not by the prompt | Anyone in the room can speak | `03`, `09` E |
| The Mini screen shows this run's conversation only, kept in memory | The bot's runtime keeps no history; storing replies is a separate choice | `05` |
| Actions for an offline phone fail; they are never queued | A late action is a wrong action | `01`, `04` |
| Sync on the home Wi-Fi only | D4 | `04` |
| Mail through IMAP with an app password | No third party, no Google Cloud project. No OAuth. Gmail works with an app password (2-Step Verification on). Microsoft has been turning app passwords off for Outlook.com and Microsoft 365: the Outlook choice is offered, and if Microsoft refuses the sign-in the wizard says this version cannot connect that account | `06` |
| No wake word on the phone; no location | Battery and privacy | D8, `08` |
| Geist fonts, a dark default, the accent taken from the bot | A calm look that is the owner's own | `07` |

## Risks

| Risk | How likely | What it would cost | What the plan does |
|---|---|---|---|
| Claude Code on Android breaks with an update | Likely, at some point | Mini on the phone is down until repaired | The app detects it, says so, keeps recording; D6 |
| The plugin's hooks do not work in Termux | Unknown until T1 | A redesign of the phone's brain link | T1 runs first; the phone app is designed so its side does not change; D7 |
| Android stops Termux or the app overnight | Possible on Nothing OS | The bot is asleep when wanted | Foreground service, unrestricted battery, a watchdog, "start on demand" as a setting; T6 |
| The phone is nearly full | Certain today | Setup or the record fails for lack of space | Small size limits; the app shows the space it uses and warns below 1 GB free |
| An accessibility service and an overlay make banking apps refuse to run | Likely | The owner turns Mini off to pay | The bot hides and the service does nothing in "never" apps; one tap pauses both |
| A message, mail or web page tells Mini to do something | Certain to be tried | An action the owner did not want | Content is marked as information; sending and buying always ask; every read and action is logged; grants limit reach |
| The owner's PC is short of memory | Certain today | The hub is closed to free memory, and sync stops | Tauri, a small core, the window freed when closed; T2 measures it |
| Windows Firewall or the router keeps the phone from reaching the PC | Possible | No sync | T3; a clear "cannot reach the hub" help page; a typed address as fallback |
| Chat apps change what their notifications contain | Likely, now and then | Messages captured badly | The listener keeps what it can and marks what it could not read; the apps' handling is small and easy to change |
| The unofficial Alexa session (if D2 is yes) stops working or is refused by Amazon | Likely over time | House control through Alexa is down | It is an adapter among others; local adapters keep working |
| The hub's database key is lost | Unlikely | The stored history is unreadable | Export reminders; the phone still holds what it had not handed over |
| The APK signing key is lost | Unlikely | Reinstall and pair again | D12 |
| The plan's size outruns one person's time | Real | Half-built parts | Each phase stands alone and is usable; Phases 1 and 2 already give the owner the dashboard and the record |

## Decided

Nothing yet beyond what the plan itself records. Add entries as `YYYY-MM-DD: decision, and what changed`.

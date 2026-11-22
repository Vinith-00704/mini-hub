# 00. Overview

## What this is

Mini is a floating assistant that already lives on the owner's Windows PC. It runs on a real Claude Code session,
talks, reads pages and can use the mouse and keyboard, and every kind of access is switched on by the owner's own
click (the Claude Mini Bot plugin, in its own repository).

Mini Hub turns that into a personal assistant for the owner's whole setup:

- a **dashboard on the PC** that shows the phone's calls and messages, mail, the home's devices, and everything
  Mini did, and from which each of those can be controlled;
- an **Android app** that puts the same floating bot on the phone, records what happens on the phone, and keeps
  Mini working when the PC is off;
- **connectors** for mail, the Echo Dot and home appliances, with room to add more devices later.

It is for one person. There are no accounts, no sharing and no server.

## Why

The owner wants one assistant they can hand everything to and still be in charge of: it works on their commands,
it does only what they allowed, they can see what it did, and they can stop it. They also want it wherever they
are: at the PC, on the phone, and by voice at home.

## Goals

- **G1. One place to see everything.** Missed calls, messages, mail, notifications, device status and Mini's own
  actions, on the PC, searchable.
- **G2. One place to control everything.** The phone, the home's devices and Mini itself, from the dashboard.
- **G3. Mini on the phone**, as a floating bot that can be hidden or stopped, working with the PC off.
- **G4. The owner decides.** A switch for each connection, a question before each important action, a log of
  everything, one button that stops it all.
- **G5. Local.** Storage and links are on the owner's devices and home network.
- **G6. Catch up, don't spy.** With the PC off, the phone keeps its own record. When the PC comes on at home, the
  record is handed over. Until then the PC has nothing.
- **G7. A dashboard that is the owner's own.** Boards, widgets, colours and layout can be rearranged. New devices
  can be added.
- **G8. Modern, calm, easy.** Opens from the tray or a key. Clear at a glance.
- **G9. Fits the Nothing Phone (2a).** A quick-settings tile, a widget, the assistant gesture, the Glyph lights.
- **G10. Voice at home** through the Echo Dot, as an option the owner turns on knowingly.

## Not goals

- More than one user, or accounts.
- A hosted or cloud version.
- iPhone.
- Reading WhatsApp or Instagram history. Only what arrives as a notification is seen (see Limits).
- Recording calls.
- Changing the phone's system software (the kernel or the ROM). Everything here is an ordinary app.
- Loading third-party connector code at run time. Connectors are built in; a new kind of device is new code in this repository.
- A second assistant. See rule 3 in `AGENTS.md`.

## What would make this a failure even if it works

- Mini does something the owner did not ask for, or something important without asking.
- The owner cannot tell what Mini did, or cannot stop it at once.
- Personal data ends up somewhere the owner did not choose: a server, a public address, a git repository.
- The dashboard is one more thing to manage instead of the place that makes the rest simple.
- It drains the phone's battery or the PC's memory enough that the owner turns it off.

## The hard rules

Carried over from the Mini Bot, in the owner's words, and binding here:

- "Require explicit authorization before granting sensitive access."
- "Preserve Claude Code's existing permission controls."
- "Never let hiding the character conceal active screen or microphone capture indicators."
- "Stop active screen and microphone access when the companion stops."
- "Do not fake working voice input."
- "Do not bypass Claude Code permissions; do not silently activate microphone capture; do not silently capture
  screen; do not create hidden background AI behavior; do not expose insecure local endpoints; do not let the
  floating bot become an uncontrolled second assistant."
- "At the end of the day, everything should come under the permission that I give."
- Full access: "It should only work on my commands, and even on my commands while doing some important tasks
  like deleting, or adding files, it should still ask for permission."
- "It will still run on the Claude session. Not any separate application or a separate code."

Added for the hub:

- "Let's make it as a local so that nothing else will be leaked."
- "Even if my PC is switched off, my mobile should be able to work... when the PC gets started, all the data that
  have been happened during the offline time will be loaded... till then, you can't get any details from the PC."

## What leaves the devices

"Local" is true of storage and of the links between the owner's devices. It cannot be true of everything, and the
dashboard says so wherever it matters.

| What | Where it goes | Can it be avoided |
|---|---|---|
| Anything Mini reads to answer a question | Anthropic, as part of the Claude conversation | No. Mini's brain is Claude. What Mini may read is the owner's choice, per source. |
| Mail | The mail provider, as always | No. The hub connects straight to the provider; no third party is added. |
| Voice through the Echo Dot | Amazon, as always, and a public address that reaches the PC | Only by leaving the Alexa connector off, which is the default. |
| Appliances controlled through an Amazon or a maker's cloud | That cloud | Yes, for devices that can be controlled directly on the home network. |
| Calls, messages, notifications, phone activity, the audit log | Nowhere. Phone and PC only. | n/a |

## Approaches considered

**Where the hub lives**

1. **The PC is the hub** (chosen). The hub runs on the PC next to Mini's Claude Code session. The phone is a
   client with its own record. One permission system, no bill beyond the Claude plan, nothing hosted. Its cost:
   the dashboard exists only while the PC is on, which the owner accepted and asked for (G6).
2. A small hosted server. Works with the PC off and from anywhere. Rejected: the owner's mail and messages would
   sit on a server, it needs the paid API, and it is a second brain.
3. A phone-only app calling the Claude API. Rejected: no PC access, a second brain, a separate bill.

**Mini's brain on the phone, with the PC off**

1. **Claude Code in Termux** (chosen). The official Claude Code program, signed in with the owner's own plan,
   running in the Termux app. Tested on the owner's phone (below). Its cost: it is an unofficial way to run Claude
   Code on Android and an update can break it, so the phone app must notice and say so, and
   `docs/11-open-decisions.md` keeps a fallback.
2. A paid API key in the phone app. Reliable, but a second brain and a separate bill. Kept as the fallback only.
3. No brain while the PC is off: record and queue only. Rejected by the owner: "the mini bot should be able to work".

**The Claude phone app as the brain** was also looked at. It cannot be embedded or driven by another app, and a
custom connector for it must be reachable from the public internet. It stays a possible later extra
(`docs/11-open-decisions.md`), not part of this plan.

## What has been tested

On 2026-11-22, on the owner's Nothing Phone (2a), Android 16:

- Termux installed from the official release, checksum matched.
- Claude Code 2.1.330 installed through the community `claude-code-android` route (Anthropic's own Linux program,
  run through Termux's glibc layer), and signed in. It is the same version as on the PC.
- One question answered in about 5 seconds.
- A one-hour test with the screen off, on battery: a line written every minute, none missed; one question to
  Claude every 10 minutes, 6 of 6 answered in 3 to 6 seconds. The whole phone used about 3% of its battery in
  that time, including a phone call.
- Not tested: a session that stays open for hours; the Mini Bot plugin inside Claude Code on the phone; memory
  pressure. These are the first trials in `docs/10-build-plan.md`.

Checked on 2026-11-22 from public sources, to be checked again when relied on:

- Claude Code has Remote Control (`claude remote-control`), which lets the Claude phone app open a session on the PC.
- `claude -p` and the Agent SDK draw from the plan's own limits; a planned separate credit was paused.
- Nothing's Glyph Developer Kit supports the Phone (2a) and needs no key from Nothing on Android 16.
- An Alexa skill must answer within about 8 seconds, and its address must be public with a trusted certificate.

## Limits to be honest about

- **WhatsApp, Instagram and the like** have no interface for a personal account. The phone app sees a message when
  its notification arrives, and can answer through the notification's reply box while it is still there. Older
  messages, media and group details are out of reach without driving the app on screen.
- **Alexa is not local** and never will be. The Echo Dot itself has no supported way to be controlled from the
  home network.
- **Banking and payment apps** often refuse to run or to be read while an accessibility service or an overlay is
  active. The phone app must be easy to pause for them.
- **Claude Code on Android is unofficial.** It can break with an update.
- **The phone is nearly full.** The app, its record and the Termux setup must stay small.

## Words used in these documents

| Word | Meaning |
|---|---|
| Mini | The assistant: the floating bot and the Claude Code session behind it |
| Mini Bot | The existing Claude Code plugin with its runtime and Windows overlay |
| Hub | This project's PC application: the core and the dashboard |
| Core | The hub's background service, which owns the database, the links and the rules |
| Shell | The small desktop program that shows the dashboard window and the tray icon, and starts the core |
| Phone app | The Android app |
| Connector | The code that links one kind of device or account to the hub |
| Person | The owner, acting through a screen that only they can use |
| Agent | Mini, acting through tools |
| Grant | A switch that says whether Mini may use something |
| Approval | The owner's yes or no to one action |
| Event | One thing that happened: a call, a message, a notification, an action |

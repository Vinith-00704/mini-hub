# Mini Hub

A personal control centre for one person: a desktop app on the PC that shows and controls everything
Mini (the Claude Mini Bot assistant) can reach, an Android app that puts Mini on the phone, and connectors for
mail, an Echo Dot and home appliances. Everything is stored on the owner's own devices, and nothing acts
without the owner's say.

**Status:** the PC's hub core and dashboard (Phase 1, without the desktop shell) are built and tested. The desktop
shell, the phone app and the connectors for mail, home and the Echo Dot are next (`docs/10-build-plan.md`).

To try it with made-up data: `npm install`, then `npm run dev` (the dashboard opens in the browser). Add `-- --bot`
to also connect to the Mini Bot running on this PC. Tests: `npm test`. Types: `npm run check`.

## Read in this order

| File | What it settles |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | What this is, the goals, the hard rules, the approach that was chosen and why, what has been tested |
| [docs/01-architecture.md](docs/01-architecture.md) | The parts, the processes, the ports, how data moves, what happens offline |
| [docs/02-tech-stack.md](docs/02-tech-stack.md) | Languages, frameworks and libraries with the reason for each, the repository layout, what must be installed |
| [docs/03-security-and-permissions.md](docs/03-security-and-permissions.md) | Who may do what, grants, approvals, the audit log, the stop button, secrets, what leaves the devices |
| [docs/04-data-and-sync.md](docs/04-data-and-sync.md) | The database, the event types, pairing, the phone-to-PC sync protocol |
| [docs/05-hub-api.md](docs/05-hub-api.md) | The hub core's local API |
| [docs/06-connectors.md](docs/06-connectors.md) | The connector interface, each built-in connector, how to add a device |
| [docs/07-dashboard-design.md](docs/07-dashboard-design.md) | The look, the layout, every screen, the widgets, how it is customized |
| [docs/08-android-app.md](docs/08-android-app.md) | The phone app: the floating bot, what it records, Mini's brain on the phone, Nothing features, building the APK |
| [docs/09-mini-bot-changes.md](docs/09-mini-bot-changes.md) | What changes in the existing Claude Mini Bot plugin |
| [docs/10-build-plan.md](docs/10-build-plan.md) | The order of work: trials first, then seven phases, each with what "done" means |
| [docs/11-open-decisions.md](docs/11-open-decisions.md) | What the owner still has to decide, each with the default that applies until they do, and the known risks |

Anyone (or any model) starting work reads [AGENTS.md](AGENTS.md) first.

## The short version

- **PC**: the hub. A small always-on background service keeps the database and the links; a window shows the dashboard.
- **Phone**: an Android app (an APK installed by hand) with the floating bot. It keeps its own record and its own
  permissions, and hands the record to the PC over the home Wi-Fi when the PC is on.
- **Brain**: always a real Claude Code session. On the PC it is Mini's existing session. On the phone it is Claude Code
  running in Termux, so Mini keeps working with the PC off.
- **Echo Dot and appliances**: connectors added on top. Talking to Mini through Alexa is the one part that cannot be local.
- **Control**: every connection has its own switch, every action is logged, important actions ask first, and one
  button stops everything.

## Related repository

The Claude Mini Bot plugin lives in its own repository (`Claude-Mini-bot`). It is not copied here: the plugin's
marketplace ships that whole repository to every install, so the hub and the phone app stay out of it.

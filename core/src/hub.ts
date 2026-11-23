// Everything the core holds, wired together once. The API and the entry point both start from here.

import { EventEmitter } from 'node:events'
import type { NewEvent } from '@minihub/protocol'
import { Audit } from './audit/audit.ts'
import { Boards } from './boards.ts'
import type { MiniLink } from './connectors/mini.ts'
import { pcConnector, type Exec } from './connectors/pc.ts'
import { DeviceStore, Registry } from './connectors/registry.ts'
import { Secrets } from './connectors/secrets.ts'
import type { Connector, Logger } from './connectors/types.ts'
import { Retention } from './data/retention.ts'
import { Events } from './events.ts'
import { loadOrMakeCert } from './link/cert.ts'
import { androidConnector } from './connectors/android.ts'
import { mailConnector } from './connectors/mail/index.ts'
import { Pairing } from './link/pairing.ts'
import { Phones, type PhoneOptions } from './link/phones.ts'
import { DeviceLink, type LinkOptions } from './link/server.ts'
import { Tokens } from './link/tokens.ts'
import { Approvals } from './rules/approvals.ts'
import { Grants } from './rules/grants.ts'
import { StopState } from './rules/stop.ts'
import { getMeta, setMeta, type Store } from './store/db.ts'
import { Tickets } from './tickets.ts'

export const VERSION = '0.1.0'

export type LiveTopic = 'events' | 'devices' | 'approvals' | 'grants' | 'audit' | 'state' | 'mini' | 'boards'

export type Hub = {
  db: Store
  audit: Audit
  grants: Grants
  approvals: Approvals
  stop: StopState
  tickets: Tickets
  events: Events
  devices: DeviceStore
  boards: Boards
  /** How long things are kept (Settings > Data), and the pruning that follows it. */
  retention: Retention
  registry: Registry
  mini: MiniLink
  /** The device link to phones; open only while a phone is paired or a pairing is under way. */
  link: DeviceLink
  tokens: Tokens
  pairing: Pairing
  phones: Phones
  log: Logger
  live: EventEmitter<{ topic: [LiveTopic] }>
  version: string
  dataDir?: string
  /** Stop Mini: refuse the agent, end control in the bot, answer every waiting question no. */
  stopMini(by: 'person' | 'agent' | 'device'): Promise<void>
  /** Remove a phone: its token stops working at once, its link closes, and what it sent can go too. */
  removeDevice(id: string, deleteEvents: boolean): void
  /** Take any device out of every list (its connector has already let go of it); what it sent can go too. */
  forgetDevice(id: string, deleteEvents: boolean): void
  close(): Promise<void>
}

type LinkDeps = Partial<Pick<LinkOptions, 'port' | 'hosts' | 'announce' | 'pingMs' | 'name'>>
type Deps = { mini: MiniLink; exec?: Exec; log: Logger; now?: () => number; dataDir?: string; link?: LinkDeps; phones?: PhoneOptions }

const EXPIRE_EVERY_MS = 5000
/** Old items go a minute after start, then every 6 hours. */
const PRUNE_FIRST_MS = 60_000
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000
/** The dashboard hears of new events at most this often; a phone catching up thousands costs a handful of refetches. */
const EVENTS_QUIET_MS = 250

export async function createHub(db: Store, deps: Deps): Promise<Hub> {
  const now = deps.now ?? Date.now
  const live = new EventEmitter<{ topic: [LiveTopic] }>()
  // 'events' is coalesced: the first one in a quiet period goes at once, the rest of a burst become one more at its end.
  let eventsTimer: NodeJS.Timeout | undefined
  let eventsPending = false
  const tellEvents = (): void => {
    if (eventsTimer) {
      eventsPending = true
      return
    }
    live.emit('topic', 'events')
    const end = (): void => {
      if (!eventsPending) return void (eventsTimer = undefined)
      eventsPending = false
      live.emit('topic', 'events')
      eventsTimer = setTimeout(end, EVENTS_QUIET_MS)
      eventsTimer.unref()
    }
    eventsTimer = setTimeout(end, EVENTS_QUIET_MS)
    eventsTimer.unref()
  }
  const tell = (topic: LiveTopic) => () => void live.emit('topic', topic)

  const audit = new Audit(db, now)
  const grants = new Grants(db, now)
  const approvals = new Approvals(db, now)
  const stop = new StopState(db)
  const tickets = new Tickets()
  // Questions left from before this start can no longer be acted on: each is expired, with the row its asker writes
  // for a question nobody answered in time.
  for (const a of approvals.expireAll()) {
    if (a.action === 'events.read') audit.append({ caller: 'agent', action: 'read', target: 'events', outcome: 'refused', data: { count: 0, ids: [], scopes: [a.scope] } })
    else audit.append({ caller: 'agent', action: 'act', target: `${a.action}${a.deviceId ? `@${a.deviceId}` : ''}`, scope: a.scope, risk: a.risk, outcome: 'refused' })
  }
  const devices = new DeviceStore(db, now)
  const events = new Events(db, grants, devices, now)
  const boards = new Boards(db)
  const retention = new Retention({ db, events, audit, log: deps.log })
  const tokens = new Tokens(db)
  const link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: deps.log, now, ...deps.link })
  const pairing = new Pairing({ link, tokens, devices, now, onChange: tell('devices') })
  // Set below, once the hub exists: a phone's "Stop on my PC too" is the hub's own Stop.
  let stopFromPhone: () => Promise<void> = async () => {}
  const phones = new Phones({ db, link, events, devices, grants, log: deps.log, now, onStopRequest: () => stopFromPhone(), ...(deps.phones ? { options: deps.phones } : {}) })

  const emit = (e: NewEvent & { deviceId: string }): void => {
    const { deviceId, ...event } = e
    if (deviceId === 'hub') return void events.addHub(event)
    // A connector on the hub numbers its device's events itself.
    const seq = db.transaction(() => {
      const next = Number(getMeta(db, `seq:${deviceId}`) ?? '0') + 1
      setMeta(db, `seq:${deviceId}`, String(next))
      return next
    })()
    events.add(deviceId, seq, event)
  }

  const registry = new Registry({ db, devices, emit, log: deps.log, grants, secrets: new Secrets(db), now })
  registry.add(pcConnector(deps.exec ? { exec: deps.exec } : {}))
  registry.add(androidConnector({ phones, link, tokens }))
  registry.add(
    mailConnector({
      lookup: id => {
        try {
          return events.get(id, { caller: 'person' })
        } catch {
          return undefined
        }
      },
      // Settings > Data decides how much of a mail is kept (default the first 2,000 characters).
      mailBody: () => retention.current().mailBody,
    }),
  )
  const miniAsConnector = deps.mini as MiniLink & Partial<Connector>
  if (miniAsConnector.manifest) registry.add(miniAsConnector as Connector)

  grants.onChange(tell('grants'))
  approvals.onChange(tell('approvals'))
  events.onAdd(tellEvents)
  devices.onChange(tell('devices'))
  boards.onChange(tell('boards'))
  audit.onAppend(tell('audit'))
  stop.onChange(tell('state'))
  deps.mini.onChange(tell('mini'))

  const expiry = setInterval(() => approvals.expireDue(), EXPIRE_EVERY_MS)
  expiry.unref()
  const prune = (): void => {
    try {
      retention.prune(now())
    } catch (error) {
      deps.log.warn({ err: String(error) }, 'could not remove old items')
    }
  }
  let pruneEvery: NodeJS.Timeout | undefined
  const pruneFirst = setTimeout(() => {
    prune()
    pruneEvery = setInterval(prune, PRUNE_EVERY_MS)
    pruneEvery.unref()
  }, PRUNE_FIRST_MS)
  pruneFirst.unref()

  await registry.startAll()
  if (tokens.paired().length > 0) await link.open().catch(error => deps.log.error({ err: String(error) }, 'could not open the device link'))

  const hub: Hub = {
    db,
    audit,
    grants,
    approvals,
    stop,
    tickets,
    events,
    devices,
    boards,
    retention,
    registry,
    mini: deps.mini,
    link,
    tokens,
    pairing,
    phones,
    log: deps.log,
    live,
    version: VERSION,
    ...(deps.dataDir ? { dataDir: deps.dataDir } : {}),
    removeDevice(id, deleteEvents) {
      tokens.revoke(id)
      link.drop(id)
      phones.forget(id)
      hub.forgetDevice(id, deleteEvents)
      pairing.closeIfUnused()
    },
    forgetDevice(id, deleteEvents) {
      devices.remove(id)
      if (deleteEvents) {
        db.prepare('DELETE FROM events WHERE device_id = ?').run(id)
        tellEvents()
      }
    },
    async stopMini(by) {
      stop.stop()
      phones.stopAll()
      approvals.noAll()
      audit.append({ caller: by, action: 'stop', outcome: 'done' })
      await deps.mini.stopControl().catch(error => deps.log.warn({ err: String(error) }, 'could not reach the bot to stop control'))
    },
    async close() {
      clearInterval(expiry)
      clearTimeout(pruneFirst)
      clearInterval(pruneEvery)
      clearTimeout(eventsTimer)
      eventsTimer = undefined
      eventsPending = false
      pairing.dispose()
      phones.dispose()
      await link.close()
      await registry.stopAll()
      db.close()
    },
  }
  stopFromPhone = () => hub.stopMini('device')
  return hub
}

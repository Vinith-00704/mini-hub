// Everything the core holds, wired together once. The API and the entry point both start from here.

import { EventEmitter } from 'node:events'
import type { NewEvent } from '@minihub/protocol'
import { Audit } from './audit/audit.ts'
import type { MiniLink } from './connectors/mini.ts'
import { pcConnector, type Exec } from './connectors/pc.ts'
import { DeviceStore, Registry } from './connectors/registry.ts'
import type { Connector, Logger } from './connectors/types.ts'
import { Events } from './events.ts'
import { loadOrMakeCert } from './link/cert.ts'
import { androidConnector } from './connectors/android.ts'
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

export type LiveTopic = 'events' | 'devices' | 'approvals' | 'grants' | 'audit' | 'state' | 'mini'

export type Hub = {
  db: Store
  audit: Audit
  grants: Grants
  approvals: Approvals
  stop: StopState
  tickets: Tickets
  events: Events
  devices: DeviceStore
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
  close(): Promise<void>
}

type LinkDeps = Partial<Pick<LinkOptions, 'port' | 'hosts' | 'announce' | 'pingMs' | 'name'>>
type Deps = { mini: MiniLink; exec?: Exec; log: Logger; now?: () => number; dataDir?: string; link?: LinkDeps; phones?: PhoneOptions }

const EXPIRE_EVERY_MS = 5000

export async function createHub(db: Store, deps: Deps): Promise<Hub> {
  const now = deps.now ?? Date.now
  const live = new EventEmitter<{ topic: [LiveTopic] }>()
  const tell = (topic: LiveTopic) => () => void live.emit('topic', topic)

  const audit = new Audit(db, now)
  const grants = new Grants(db, now)
  const approvals = new Approvals(db, now)
  const stop = new StopState(db)
  const tickets = new Tickets()
  const devices = new DeviceStore(db, now)
  const events = new Events(db, grants, devices, now)
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

  const registry = new Registry({ devices, emit, log: deps.log })
  registry.add(pcConnector(deps.exec ? { exec: deps.exec } : {}))
  registry.add(androidConnector({ phones, link, tokens }))
  const miniAsConnector = deps.mini as MiniLink & Partial<Connector>
  if (miniAsConnector.manifest) registry.add(miniAsConnector as Connector)

  grants.onChange(tell('grants'))
  approvals.onChange(tell('approvals'))
  events.onAdd(tell('events'))
  devices.onChange(tell('devices'))
  audit.onAppend(tell('audit'))
  stop.onChange(tell('state'))
  deps.mini.onChange(tell('mini'))

  const expiry = setInterval(() => approvals.expireDue(), EXPIRE_EVERY_MS)
  expiry.unref()

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
      devices.remove(id)
      if (deleteEvents) {
        db.prepare('DELETE FROM events WHERE device_id = ?').run(id)
        live.emit('topic', 'events')
      }
      pairing.closeIfUnused()
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

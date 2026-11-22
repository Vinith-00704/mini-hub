// Everything the core holds, wired together once. The API and the entry point both start from here.

import { EventEmitter } from 'node:events'
import type { NewEvent } from '@minihub/protocol'
import { Audit } from './audit/audit.ts'
import type { MiniLink } from './connectors/mini.ts'
import { pcConnector, type Exec } from './connectors/pc.ts'
import { DeviceStore, Registry } from './connectors/registry.ts'
import type { Connector, Logger } from './connectors/types.ts'
import { Events } from './events.ts'
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
  log: Logger
  live: EventEmitter<{ topic: [LiveTopic] }>
  version: string
  dataDir?: string
  /** Stop Mini: refuse the agent, end control in the bot, answer every waiting question no. */
  stopMini(by: 'person' | 'agent'): Promise<void>
  close(): Promise<void>
}

type Deps = { mini: MiniLink; exec?: Exec; log: Logger; now?: () => number; dataDir?: string }

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
    log: deps.log,
    live,
    version: VERSION,
    ...(deps.dataDir ? { dataDir: deps.dataDir } : {}),
    async stopMini(by) {
      stop.stop()
      approvals.noAll()
      audit.append({ caller: by, action: 'stop', outcome: 'done' })
      await deps.mini.stopControl().catch(error => deps.log.warn({ err: String(error) }, 'could not reach the bot to stop control'))
    },
    async close() {
      clearInterval(expiry)
      await registry.stopAll()
      db.close()
    },
  }
  return hub
}

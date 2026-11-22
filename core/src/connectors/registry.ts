// The connectors the core knows, and the devices they bring.

import { isScope, type NewEvent } from '@minihub/protocol'
import type { Store } from '../store/db.ts'
import { ApiFailure } from '../rules/policy.ts'
import type { ActionDef, ActionInfo, Connector, Device, DeviceAccess, DeviceInput, Logger } from './types.ts'

type RawDevice = {
  id: string
  connector_id: string
  kind: string
  name: string
  room: string | null
  info_json: string
  state_json: string
  added_at: number
  last_seen_at: number | null
}

const toDevice = (r: RawDevice): Device => ({
  id: r.id,
  connectorId: r.connector_id,
  kind: r.kind,
  name: r.name,
  ...(r.room === null ? {} : { room: r.room }),
  info: JSON.parse(r.info_json) as Record<string, unknown>,
  state: JSON.parse(r.state_json) as Record<string, unknown>,
  addedAt: r.added_at,
  ...(r.last_seen_at === null ? {} : { lastSeenAt: r.last_seen_at }),
})

export class DeviceStore implements DeviceAccess {
  #db: Store
  #now: () => number
  #listeners = new Set<() => void>()

  constructor(db: Store, now: () => number = Date.now) {
    this.#db = db
    this.#now = now
  }

  upsert(d: DeviceInput): Device {
    const now = this.#now()
    const existing = this.get(d.id)
    if (existing) {
      this.#db
        .prepare('UPDATE devices SET info_json = ?, state_json = ?, last_seen_at = ?, removed_at = NULL WHERE id = ?')
        .run(JSON.stringify(d.info ?? existing.info), JSON.stringify({ ...existing.state, ...(d.state ?? {}) }), now, d.id)
    } else {
      this.#db
        .prepare('INSERT INTO devices (id, connector_id, kind, name, info_json, state_json, added_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(d.id, d.connectorId, d.kind, d.name, JSON.stringify(d.info ?? {}), JSON.stringify(d.state ?? {}), now, now)
    }
    this.#changed()
    return this.get(d.id) as Device
  }

  setState(id: string, patch: Record<string, unknown>): void {
    const d = this.get(id)
    if (!d) return
    this.#db.prepare('UPDATE devices SET state_json = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify({ ...d.state, ...patch }), this.#now(), id)
    this.#changed()
  }

  /** Takes a device out of every list. Its row stays, marked removed, so old audit rows still name it. */
  remove(id: string): void {
    this.#db.prepare('UPDATE devices SET removed_at = ?, token_hash = NULL WHERE id = ?').run(this.#now(), id)
    this.#changed()
  }

  rename(id: string, patch: { name?: string; room?: string | null }): Device {
    const d = this.get(id)
    if (!d) throw new ApiFailure(404, 'not-found', 'There is no such device.')
    if (patch.name !== undefined) this.#db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(patch.name, id)
    if (patch.room !== undefined) this.#db.prepare('UPDATE devices SET room = ? WHERE id = ?').run(patch.room, id)
    this.#changed()
    return this.get(id) as Device
  }

  list(): Device[] {
    return (this.#db.prepare('SELECT * FROM devices WHERE removed_at IS NULL ORDER BY added_at, id').all() as RawDevice[]).map(toDevice)
  }

  get(id: string): Device | undefined {
    const r = this.#db.prepare('SELECT * FROM devices WHERE id = ? AND removed_at IS NULL').get(id) as RawDevice | undefined
    return r ? toDevice(r) : undefined
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #changed(): void {
    for (const fn of this.#listeners) fn()
  }
}

type Deps = { devices: DeviceStore; emit: (e: NewEvent & { deviceId: string }) => void; log: Logger }

export class Registry {
  #deps: Deps
  #connectors = new Map<string, Connector>()
  #abort = new AbortController()

  constructor(deps: Deps) {
    this.#deps = deps
  }

  /** Every action must say its scope and risk, and every act or important one how to ask about it. Unknown is refused. */
  add(c: Connector): void {
    for (const [name, a] of Object.entries(c.actions)) {
      const where = `${c.manifest.id}.${name}`
      if (!isScope(a.scope)) throw new Error(`${where} has no known scope.`)
      if (!['read', 'act', 'important'].includes(a.risk)) throw new Error(`${where} has no risk.`)
      if (a.risk !== 'read' && typeof a.describe !== 'function') throw new Error(`${where} has no describe.`)
    }
    this.#connectors.set(c.manifest.id, c)
  }

  get(id: string): Connector | undefined {
    return this.#connectors.get(id)
  }

  list(): Connector[] {
    return [...this.#connectors.values()]
  }

  async startAll(): Promise<void> {
    for (const c of this.#connectors.values()) {
      try {
        await c.start({ emit: this.#deps.emit, devices: this.#deps.devices, log: this.#deps.log, signal: this.#abort.signal })
      } catch (error) {
        this.#deps.log.error({ connector: c.manifest.id, err: String(error) }, 'connector did not start')
      }
    }
  }

  async stopAll(): Promise<void> {
    this.#abort.abort()
    for (const c of this.#connectors.values()) await c.stop().catch(() => {})
  }

  actions(): ActionInfo[] {
    return this.list().flatMap(c =>
      Object.entries(c.actions).map(([name, a]) => ({
        connector: c.manifest.id,
        name,
        title: a.title,
        scope: a.scope,
        risk: a.risk,
        personOnly: a.personOnly === true,
      })),
    )
  }

  find(connector: string, name: string): ActionDef {
    const a = this.#connectors.get(connector)?.actions[name]
    if (!a) throw new ApiFailure(404, 'not-found', `There is no action "${name}" on ${connector}.`)
    return a
  }
}

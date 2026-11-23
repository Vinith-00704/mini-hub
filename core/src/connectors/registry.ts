// The connectors the core knows, and the devices they bring.

import { isScope, type NewEvent } from '@minihub/protocol'
import { z } from 'zod'
import { grantTarget } from '../events.ts'
import type { Store } from '../store/db.ts'
import { ApiFailure } from '../rules/policy.ts'
import type { Grants } from '../rules/grants.ts'
import type { Secrets } from './secrets.ts'
import type { ActionDef, ActionInfo, Connector, Ctx, Device, DeviceAccess, DeviceInput, Logger, SettingsAccess } from './types.ts'

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

type Deps = {
  db: Store
  devices: DeviceStore
  emit: (e: NewEvent & { deviceId: string }) => void
  log: Logger
  grants: Grants
  secrets: Secrets
  now?: () => number
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A connector's own settings, in `connectors.settings_json`. Keys whose value is undefined are dropped when written. */
const settingsFor = (db: Store, id: string, now: () => number): SettingsAccess => ({
  get() {
    const r = db.prepare('SELECT settings_json FROM connectors WHERE id = ?').get(id) as { settings_json: string } | undefined
    return r ? (JSON.parse(r.settings_json) as Record<string, unknown>) : {}
  },
  set(patch) {
    db.transaction(() => {
      const r = db.prepare('SELECT settings_json FROM connectors WHERE id = ?').get(id) as { settings_json: string } | undefined
      const next: Record<string, unknown> = r ? (JSON.parse(r.settings_json) as Record<string, unknown>) : {}
      // One level deep: an object value is merged into the object already there, anything else replaces it.
      for (const [k, v] of Object.entries(patch)) next[k] = isPlainObject(v) && isPlainObject(next[k]) ? { ...next[k], ...v } : v
      db.prepare(
        'INSERT INTO connectors (id, enabled, settings_json, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT (id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
      ).run(id, JSON.stringify(next), now())
    })()
  },
})

export class Registry {
  #deps: Deps
  #connectors = new Map<string, Connector>()
  #ctx = new Map<string, Ctx>()
  #args = new Map<string, Record<string, unknown>>()
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
    for (const [name, a] of Object.entries(c.actions)) {
      // What the arguments look like as they are sent. A schema zod cannot describe is listed as {} rather than stopping the hub.
      let schema: Record<string, unknown> = {}
      try {
        schema = z.toJSONSchema(a.args, { io: 'input' }) as Record<string, unknown>
      } catch {
        this.#deps.log.warn({ connector: c.manifest.id, action: name }, 'action arguments cannot be described')
      }
      this.#args.set(`${c.manifest.id}.${name}`, schema)
    }
    this.#connectors.set(c.manifest.id, c)
  }

  /** The one context a connector gets: its own secrets and settings, the shared devices, and read-only switches. */
  ctx(id: string): Ctx {
    const known = this.#ctx.get(id)
    if (known) return known
    const { db, devices, emit, log, grants, secrets } = this.#deps
    const ctx: Ctx = {
      emit,
      devices,
      log,
      signal: this.#abort.signal,
      secrets: secrets.for(id),
      settings: settingsFor(db, id, this.#deps.now ?? Date.now),
      grants: {
        collecting: (deviceId, scope) => grants.get(grantTarget(scope, deviceId), scope).collect,
        onChange: fn => grants.onChange(fn),
      },
    }
    this.#ctx.set(id, ctx)
    return ctx
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
        await c.start(this.ctx(c.manifest.id))
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
        args: this.#args.get(`${c.manifest.id}.${name}`) ?? {},
      })),
    )
  }

  find(connector: string, name: string): ActionDef {
    const a = this.#connectors.get(connector)?.actions[name]
    if (!a) throw new ApiFailure(404, 'not-found', `There is no action "${name}" on ${connector}.`)
    return a
  }
}

// Everything that happened, from every source, and who may see which of it (docs/04-data-and-sync.md > Event types).

import { EVENT_TYPES, eventScope, maskCodes, newEventSchema, SCOPES, type EventType, type NewEvent, type ScopeId } from '@minihub/protocol'
import type { DeviceStore } from './connectors/registry.ts'
import { ApiFailure } from './rules/policy.ts'
import type { Grants } from './rules/grants.ts'
import { getMeta, setMeta, type Store } from './store/db.ts'

export type Viewer = { caller: 'person' } | { caller: 'agent'; voice?: boolean; voicePrivate?: boolean }

export type EventRow = {
  id: number
  deviceId: string
  seq: number
  type: EventType
  occurredAt: number
  receivedAt: number
  who?: string
  whoKey?: string
  app?: string
  title?: string
  body?: string
  data: Record<string, unknown>
  seenAt?: number
}

export type EventQuery = {
  types?: EventType[]
  device?: string
  who?: string
  after?: number
  before?: number
  q?: string
  unseen?: boolean
  limit?: number
  cursor?: string
}

export type PersonRow = { who: string; whoKey: string; count: number; lastAt: number }

type Raw = {
  id: number
  device_id: string
  seq: number
  type: EventType
  occurred_at: number
  received_at: number
  who: string | null
  who_key: string | null
  app: string | null
  title: string | null
  body: string | null
  data_json: string
  seen_at: number | null
}

const HUB_DEVICE = 'hub'
/** Rows deleted per transaction when many go at once. */
const REMOVE_CHUNK = 5000
// Calls, messages, mail and notifications: what a voice turn may hear only with its own switch on.
const PRIVATE_TYPES = new Set<EventType>(['call', 'sms', 'chat', 'notification', 'mail'])

const toRow = (r: Raw): EventRow => {
  const row: EventRow = {
    id: r.id,
    deviceId: r.device_id,
    seq: r.seq,
    type: r.type,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    data: JSON.parse(r.data_json) as Record<string, unknown>,
  }
  if (r.who !== null) row.who = r.who
  if (r.who_key !== null) row.whoKey = r.who_key
  if (r.app !== null) row.app = r.app
  if (r.title !== null) row.title = r.title
  if (r.body !== null) row.body = r.body
  if (r.seen_at !== null) row.seenAt = r.seen_at
  return row
}

/**
 * What Mini is given of any event: one-time codes in its title and text masked, so a mail, a message or a notification
 * cannot get Mini to pass a code on. The owner sees it whole.
 */
const forViewer = (row: EventRow, as: Viewer): EventRow => {
  if (as.caller !== 'agent') return row
  const [title, body] = maskCodes(row.title, row.body)
  return { ...row, ...(title === undefined ? {} : { title }), ...(body === undefined ? {} : { body }) }
}

/** The target a grant for this scope is kept under: the device, or the whole connector. */
export const grantTarget = (scope: ScopeId, deviceId: string): string => (SCOPES[scope].perDevice ? deviceId : SCOPES[scope].connector)

const encodeCursor = (at: number, id: number): string => Buffer.from(`${at}:${id}`).toString('base64url')
const decodeCursor = (c: string): [number, number] => {
  const [a, b] = Buffer.from(c, 'base64url').toString().split(':').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new ApiFailure(400, 'bad-request', 'That page marker is not valid.')
  return [a, b]
}

/** Words for full-text search, each quoted so nothing typed can be read as search syntax. */
const ftsQuery = (q: string): string =>
  q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map(w => `"${w.replace(/"/g, '""')}"`)
    .join(' ')

export class Events {
  #db: Store
  #grants: Grants
  #devices: DeviceStore
  #now: () => number
  #listeners = new Set<(row: EventRow) => void>()

  constructor(db: Store, grants: Grants, devices: DeviceStore, now: () => number = Date.now) {
    this.#db = db
    this.#grants = grants
    this.#devices = devices
    this.#now = now
  }

  /** Stores one event from a device. Null when its collect switch is off, or the device already sent this number. */
  add(deviceId: string, seq: number, e: NewEvent): number | null {
    const event = newEventSchema.parse(e)
    const device = this.#devices.get(deviceId)
    if (!device) throw new ApiFailure(404, 'not-found', 'There is no such device.')
    const scope = eventScope(event.type, device.kind)
    if (scope !== 'own' && scope !== 'person' && !this.#grants.get(grantTarget(scope, deviceId), scope).collect) return null
    const info = this.#db
      .prepare(
        'INSERT OR IGNORE INTO events (device_id, seq, type, occurred_at, received_at, who, who_key, app, title, body, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(deviceId, seq, event.type, event.occurredAt, this.#now(), event.who ?? null, event.whoKey ?? null, event.app ?? null, event.title ?? null, event.body ?? null, JSON.stringify(event.data ?? {}))
    if (info.changes === 0) return null
    const id = Number(info.lastInsertRowid)
    const row = this.#get(id)
    if (row) for (const fn of this.#listeners) fn(row)
    return id
  }

  /** The hub's own events (Mini's actions, the hub's notes), numbered by the hub itself. */
  addHub(e: NewEvent): number {
    if (!this.#devices.get(HUB_DEVICE)) this.#devices.upsert({ id: HUB_DEVICE, connectorId: 'hub', kind: 'hub', name: 'Mini Hub' })
    const seq = this.#db.transaction(() => {
      const next = Number(getMeta(this.#db, 'hubSeq') ?? '0') + 1
      setMeta(this.#db, 'hubSeq', String(next))
      return next
    })()
    return this.add(HUB_DEVICE, seq, e) as number
  }

  /** `approved` lets the agent see scopes on ask for this one query, because the owner just said yes to it. */
  query(q: EventQuery, as: Viewer, approved: Array<{ deviceId: string; scope: ScopeId }> = []): { items: EventRow[]; cursor?: string } {
    const where: string[] = []
    const args: unknown[] = []
    const visible = this.#visibleSql(as, new Set(approved.map(a => `${a.deviceId}|${a.scope}`)))
    if (visible) (where.push(visible.sql), args.push(...visible.args))
    if (q.types?.length) {
      for (const t of q.types) if (!EVENT_TYPES.includes(t)) throw new ApiFailure(400, 'bad-request', `There is no event type "${t}".`)
      where.push(`type IN (${q.types.map(() => '?').join(', ')})`)
      args.push(...q.types)
    }
    if (q.device) (where.push('device_id = ?'), args.push(q.device))
    if (q.who) (where.push('(who_key = ? OR who = ?)'), args.push(q.who, q.who))
    if (q.after !== undefined) (where.push('occurred_at > ?'), args.push(q.after))
    if (q.before !== undefined) (where.push('occurred_at < ?'), args.push(q.before))
    if (q.unseen) where.push('seen_at IS NULL')
    if (q.q?.trim()) (where.push('id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)'), args.push(ftsQuery(q.q)))
    if (q.cursor) {
      const [at, id] = decodeCursor(q.cursor)
      where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))')
      args.push(at, at, id)
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200)
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC, id DESC LIMIT ${limit + 1}`
    const rows = (this.#db.prepare(sql).all(...args) as Raw[]).map(r => forViewer(toRow(r), as))
    const more = rows.length > limit
    const items = more ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return more && last ? { items, cursor: encodeCursor(last.occurredAt, last.id) } : { items }
  }

  get(id: number, as: Viewer): EventRow {
    const visible = this.#visibleSql(as)
    const sql = `SELECT * FROM events WHERE id = ?${visible ? ` AND ${visible.sql}` : ''}`
    const r = this.#db.prepare(sql).get(id, ...(visible?.args ?? [])) as Raw | undefined
    if (!r) throw new ApiFailure(404, 'not-found', 'There is no such event.')
    return forViewer(toRow(r), as)
  }

  markSeen(ids: number[]): void {
    const now = this.#now()
    const stmt = this.#db.prepare('UPDATE events SET seen_at = ? WHERE id = ? AND seen_at IS NULL')
    this.#db.transaction(() => ids.forEach(id => stmt.run(now, id)))()
  }

  remove(ids: number[]): number {
    const stmt = this.#db.prepare('DELETE FROM events WHERE id = ?')
    return this.#db.transaction(() => ids.reduce((n, id) => n + stmt.run(id).changes, 0))()
  }

  /** Deletes every event of these types, 5,000 rows to a transaction (one after another, without a pause). */
  removeTypes(types: EventType[]): number {
    return this.#removeWhere(`type IN (${types.map(() => '?').join(', ')})`, types)
  }

  /** Deletes the events of one type that happened before a time (Settings > Data), 5,000 rows to a transaction. */
  removeOlder(type: EventType, before: number): number {
    return this.#removeWhere('type = ? AND occurred_at < ?', [type, before])
  }

  #removeWhere(where: string, args: unknown[]): number {
    const stmt = this.#db.prepare(`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE ${where} LIMIT ${REMOVE_CHUNK})`)
    const chunk = this.#db.transaction((): number => stmt.run(...args).changes)
    let total = 0
    for (let n = chunk(); n > 0; n = n < REMOVE_CHUNK ? 0 : chunk()) total += n
    return total
  }

  counts(since: number, as: Viewer): Partial<Record<EventType, number>> {
    const visible = this.#visibleSql(as)
    const sql = `SELECT type, count(*) AS n FROM events WHERE occurred_at >= ?${visible ? ` AND ${visible.sql}` : ''} GROUP BY type`
    const rows = this.#db.prepare(sql).all(since, ...(visible?.args ?? [])) as Array<{ type: EventType; n: number }>
    return Object.fromEntries(rows.map(r => [r.type, r.n]))
  }

  /** Counts per local day and type since a time, for the kinds asked; what the viewer may see only. */
  countsByDay(since: number, types: EventType[], as: Viewer): Array<{ day: string; type: EventType; n: number }> {
    const visible = this.#visibleSql(as)
    const sql = `SELECT date(occurred_at / 1000, 'unixepoch', 'localtime') AS day, type, count(*) AS n FROM events
      WHERE occurred_at >= ? AND type IN (${types.map(() => '?').join(', ')})${visible ? ` AND ${visible.sql}` : ''} GROUP BY day, type`
    return this.#db.prepare(sql).all(since, ...types, ...(visible?.args ?? [])) as Array<{ day: string; type: EventType; n: number }>
  }

  people(as: Viewer, since = 0): PersonRow[] {
    const visible = this.#visibleSql(as)
    const sql = `SELECT max(who) AS who, coalesce(who_key, who) AS k, count(*) AS n, max(occurred_at) AS last FROM events
      WHERE who IS NOT NULL AND occurred_at >= ?${visible ? ` AND ${visible.sql}` : ''} GROUP BY k ORDER BY last DESC LIMIT 100`
    const rows = this.#db.prepare(sql).all(since, ...(visible?.args ?? [])) as Array<{ who: string; k: string; n: number; last: number }>
    return rows.map(r => ({ who: r.who, whoKey: r.k, count: r.n, lastAt: r.last }))
  }

  /** The scopes a query would touch whose "Mini may use" is ask, so the API can ask the owner. */
  askingScopes(types: EventType[] | undefined, deviceId?: string): Array<{ target: string; scope: ScopeId; deviceId: string }> {
    const out: Array<{ target: string; scope: ScopeId; deviceId: string }> = []
    const wanted = types?.length ? types : EVENT_TYPES
    for (const d of this.#devices.list()) {
      if (deviceId && d.id !== deviceId) continue
      for (const t of wanted) {
        const scope = eventScope(t, d.kind)
        // A device is only asked about its own connector's scopes: a mail account never about a phone's, nor the other way round.
        if (scope === 'own' || scope === 'person' || SCOPES[scope].connector !== d.connectorId) continue
        const target = grantTarget(scope, d.id)
        if (this.#grants.get(target, scope).mini === 'ask' && !out.some(o => o.target === target && o.scope === scope)) out.push({ target, scope, deviceId: d.id })
      }
    }
    return out
  }

  onAdd(fn: (row: EventRow) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #get(id: number): EventRow | undefined {
    const r = this.#db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Raw | undefined
    return r ? toRow(r) : undefined
  }

  /**
   * What the agent may see: per device, the event types whose scope it may use (on, not ask), plus its own actions.
   * Null for the person, who sees everything.
   */
  #visibleSql(as: Viewer, extra: Set<string> = new Set()): { sql: string; args: unknown[] } | null {
    if (as.caller === 'person') return null
    const parts = ["type = 'mini_action'"]
    const args: unknown[] = []
    for (const d of this.#devices.list()) {
      const types = EVENT_TYPES.filter(t => {
        const scope = eventScope(t, d.kind)
        if (scope === 'own' || scope === 'person' || SCOPES[scope].connector !== d.connectorId) return false
        if (as.voice && PRIVATE_TYPES.has(t) && !as.voicePrivate) return false
        return this.#grants.get(grantTarget(scope, d.id), scope).mini === 'on' || extra.has(`${d.id}|${scope}`)
      })
      if (!types.length) continue
      parts.push(`(device_id = ? AND type IN (${types.map(() => '?').join(', ')}))`)
      args.push(d.id, ...types)
    }
    return { sql: `(${parts.join(' OR ')})`, args }
  }
}

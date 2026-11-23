// The audit log: one row for everything anyone did, each chained to the one before by a hash, so a row changed by
// hand shows (docs/03-security-and-permissions.md > The audit log). Message and mail text never goes in here.

import { createHash } from 'node:crypto'
import type { Risk } from '@minihub/protocol'
import { getMeta, setMeta, type Store } from '../store/db.ts'

export type Caller = 'person' | 'agent' | 'device' | 'voice' | 'system'
export type Outcome = 'done' | 'refused' | 'failed' | 'waiting'
type DataValue = string | number | boolean | string[] | number[]

export type AuditInput = {
  caller: Caller
  detail?: string
  action: string
  target?: string
  scope?: string
  risk?: Risk
  outcome: Outcome
  data?: Record<string, DataValue>
}

export type AuditRow = Required<Pick<AuditInput, 'caller' | 'action' | 'outcome'>> &
  Omit<AuditInput, 'caller' | 'action' | 'outcome' | 'data'> & {
    id: number
    at: number
    data: Record<string, DataValue>
    prevHash: string
    hash: string
  }

export type AuditQuery = {
  caller?: string
  action?: string
  scope?: string
  after?: number
  before?: number
  limit?: number
  agentOnly?: boolean
}

const ZERO = '0'.repeat(64)
/** The hash of the newest row pruning removed: the chain goes on from it (Settings > Data). */
const ANCHOR = 'auditAnchor'
// Ids and counts go in the data, not words: a value this long is someone's text.
const MAX_DATA_TEXT = 200

type Raw = {
  id: number
  at: number
  caller: Caller
  detail: string | null
  action: string
  target: string | null
  scope: string | null
  risk: Risk | null
  outcome: Outcome
  data_json: string
  prev_hash: string
  hash: string
}

const hashOf = (prev: string, r: Omit<Raw, 'id' | 'prev_hash' | 'hash'>): string =>
  createHash('sha256')
    .update(prev + JSON.stringify([r.at, r.caller, r.detail, r.action, r.target, r.scope, r.risk, r.outcome, r.data_json]))
    .digest('hex')

const toRow = (r: Raw): AuditRow => ({
  id: r.id,
  at: r.at,
  caller: r.caller,
  action: r.action,
  outcome: r.outcome,
  ...(r.detail === null ? {} : { detail: r.detail }),
  ...(r.target === null ? {} : { target: r.target }),
  ...(r.scope === null ? {} : { scope: r.scope }),
  ...(r.risk === null ? {} : { risk: r.risk }),
  data: JSON.parse(r.data_json) as Record<string, DataValue>,
  prevHash: r.prev_hash,
  hash: r.hash,
})

const checkData = (data: Record<string, DataValue>): void => {
  for (const [k, v] of Object.entries(data)) {
    const texts = Array.isArray(v) ? v : [v]
    for (const t of texts) if (typeof t === 'string' && t.length > MAX_DATA_TEXT) throw new Error(`Audit data "${k}" is too long to be an id.`)
  }
}

export class Audit {
  #db: Store
  #now: () => number
  #listeners = new Set<(row: AuditRow) => void>()

  constructor(db: Store, now: () => number = Date.now) {
    this.#db = db
    this.#now = now
  }

  append(e: AuditInput): AuditRow {
    const data = e.data ?? {}
    checkData(data)
    const insert = this.#db.transaction((): Raw => {
      const last = this.#db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined
      // An empty log after pruning goes on from the last row removed, so the check still holds.
      const prev = last?.hash ?? getMeta(this.#db, ANCHOR) ?? ZERO
      const body = {
        at: this.#now(),
        caller: e.caller,
        detail: e.detail ?? null,
        action: e.action,
        target: e.target ?? null,
        scope: e.scope ?? null,
        risk: e.risk ?? null,
        outcome: e.outcome,
        data_json: JSON.stringify(data),
      }
      const hash = hashOf(prev, body)
      const info = this.#db
        .prepare(
          'INSERT INTO audit (at, caller, detail, action, target, scope, risk, outcome, data_json, prev_hash, hash) VALUES (@at, @caller, @detail, @action, @target, @scope, @risk, @outcome, @data_json, @prev_hash, @hash)',
        )
        .run({ ...body, prev_hash: prev, hash })
      return { id: Number(info.lastInsertRowid), ...body, prev_hash: prev, hash }
    })
    const row = toRow(insert())
    for (const fn of this.#listeners) fn(row)
    return row
  }

  list(q: AuditQuery = {}): AuditRow[] {
    const where: string[] = []
    const args: Record<string, string | number> = {}
    if (q.agentOnly) where.push("caller = 'agent'")
    else if (q.caller) (where.push('caller = @caller'), (args.caller = q.caller))
    if (q.action) (where.push('action = @action'), (args.action = q.action))
    if (q.scope) (where.push('scope = @scope'), (args.scope = q.scope))
    if (q.after !== undefined) (where.push('at > @after'), (args.after = q.after))
    if (q.before !== undefined) (where.push('at < @before'), (args.before = q.before))
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200)
    const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`
    return (this.#db.prepare(sql).all(args) as Raw[]).map(toRow)
  }

  /**
   * Removes the rows written before a time, in one transaction, keeping the hash of the newest one removed as the
   * chain's new start. Returns how many went; the caller writes the row that says so.
   */
  pruneBefore(at: number): number {
    return this.#db.transaction((): number => {
      const newest = this.#db.prepare('SELECT id, hash FROM audit WHERE at < ? ORDER BY id DESC LIMIT 1').get(at) as { id: number; hash: string } | undefined
      if (!newest) return 0
      setMeta(this.#db, ANCHOR, newest.hash)
      return this.#db.prepare('DELETE FROM audit WHERE id <= ?').run(newest.id).changes
    })()
  }

  /** Walks the whole chain. The first row whose hash does not follow from the one before is where it broke. */
  check(): { ok: true } | { ok: false; brokenAt: number } {
    // After pruning the first row left follows the newest row removed.
    let prev = getMeta(this.#db, ANCHOR) ?? ZERO
    for (const r of this.#db.prepare('SELECT * FROM audit ORDER BY id').iterate() as IterableIterator<Raw>) {
      if (r.prev_hash !== prev || hashOf(prev, r) !== r.hash) return { ok: false, brokenAt: r.id }
      prev = r.hash
    }
    return { ok: true }
  }

  onAppend(fn: (row: AuditRow) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
}

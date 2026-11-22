// The owner's yes or no to one action. Asked by the agent, answered only in the dashboard, gone after two minutes.

import { randomUUID } from 'node:crypto'
import type { Risk } from '@minihub/protocol'
import type { Store } from '../store/db.ts'
import { ApiFailure } from './policy.ts'

export const APPROVAL_MS = 120_000

export type ApprovalState = 'waiting' | 'yes' | 'no' | 'expired'

export type Approval = {
  id: string
  requestedAt: number
  expiresAt: number
  scope: string
  risk: Risk
  deviceId?: string
  action: string
  args: unknown
  summary: string
  state: ApprovalState
  decidedAt?: number
}

export type ApprovalRequest = { scope: string; risk: Risk; deviceId?: string; action: string; args: unknown; summary: string }

type Raw = {
  id: string
  requested_at: number
  expires_at: number
  scope: string
  risk: Risk
  device_id: string | null
  action: string
  args_json: string
  summary: string
  state: ApprovalState
  decided_at: number | null
}

const toApproval = (r: Raw): Approval => ({
  id: r.id,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  scope: r.scope,
  risk: r.risk,
  ...(r.device_id === null ? {} : { deviceId: r.device_id }),
  action: r.action,
  args: JSON.parse(r.args_json),
  summary: r.summary,
  state: r.state,
  ...(r.decided_at === null ? {} : { decidedAt: r.decided_at }),
})

export class Approvals {
  #db: Store
  #now: () => number
  #listeners = new Set<(a: Approval) => void>()

  constructor(db: Store, now: () => number = Date.now) {
    this.#db = db
    this.#now = now
  }

  request(r: ApprovalRequest): Approval {
    const now = this.#now()
    const id = randomUUID()
    this.#db
      .prepare(
        "INSERT INTO approvals (id, requested_at, expires_at, scope, risk, device_id, action, args_json, summary, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')",
      )
      .run(id, now, now + APPROVAL_MS, r.scope, r.risk, r.deviceId ?? null, r.action, JSON.stringify(r.args ?? null), r.summary)
    return this.#changed(this.get(id))
  }

  get(id: string): Approval {
    const row = this.#db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Raw | undefined
    if (!row) throw new ApiFailure(404, 'not-found', 'There is no such question.')
    return toApproval(row)
  }

  decide(id: string, decision: 'yes' | 'no'): Approval {
    const a = this.get(id)
    if (a.state === 'waiting' && this.#now() > a.expiresAt) this.#set(id, 'expired')
    const now = this.get(id)
    if (now.state === 'expired') throw new ApiFailure(409, 'expired', 'This question has expired. Ask Mini again.')
    if (now.state !== 'waiting') throw new ApiFailure(409, 'decided', 'This question has already been answered.')
    return this.#changed(this.#set(id, decision))
  }

  /** Marks every waiting approval past its time as expired, and returns them. */
  expireDue(): Approval[] {
    const due = this.#db.prepare("SELECT id FROM approvals WHERE state = 'waiting' AND expires_at < ?").all(this.#now()) as Array<{ id: string }>
    return due.map(d => this.#changed(this.#set(d.id, 'expired')))
  }

  /** Stop Mini: every waiting question is answered no. */
  noAll(): void {
    const waiting = this.#db.prepare("SELECT id FROM approvals WHERE state = 'waiting'").all() as Array<{ id: string }>
    for (const w of waiting) this.#changed(this.#set(w.id, 'no'))
  }

  list(limit = 50): Approval[] {
    return (this.#db.prepare('SELECT * FROM approvals ORDER BY requested_at DESC, rowid DESC LIMIT ?').all(limit) as Raw[]).map(toApproval).reverse()
  }

  waiting(): Approval[] {
    return (this.#db.prepare("SELECT * FROM approvals WHERE state = 'waiting' ORDER BY requested_at").all() as Raw[]).map(toApproval)
  }

  /** Resolves when the approval is answered or expires. */
  settled(id: string): Promise<Approval> {
    const now = this.get(id)
    if (now.state !== 'waiting') return Promise.resolve(now)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        off()
        this.expireDue()
        resolve(this.get(id))
      }, Math.max(0, now.expiresAt - this.#now()) + 10)
      const off = this.onChange(a => {
        if (a.id !== id || a.state === 'waiting') return
        clearTimeout(timer)
        off()
        resolve(a)
      })
    })
  }

  onChange(fn: (a: Approval) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #set(id: string, state: ApprovalState): Approval {
    this.#db.prepare('UPDATE approvals SET state = ?, decided_at = ? WHERE id = ?').run(state, this.#now(), id)
    return this.get(id)
  }

  #changed(a: Approval): Approval {
    for (const fn of [...this.#listeners]) fn(a)
    return a
  }
}

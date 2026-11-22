// Work that may take a while (an action waiting for the owner, a slow device) is a ticket the caller polls.

import { randomUUID } from 'node:crypto'
import type { ErrorCode } from '@minihub/protocol'
import { ApiFailure } from './rules/policy.ts'

export type TicketResult = { done: true; ok: boolean; data?: unknown; error?: string; code?: ErrorCode }
export type TicketWaiting = { done: false; waitingFor?: 'approval' }

export const MAX_WAIT_MS = 2000
// Finished tickets are kept this long for a late poll, then forgotten.
const KEEP_MS = 10 * 60 * 1000

type Entry = { result?: TicketResult; waitingFor?: 'approval'; waiters: Set<(r: TicketResult) => void>; at: number }

export class Tickets {
  #all = new Map<string, Entry>()

  create(): string {
    this.#prune()
    const id = randomUUID()
    this.#all.set(id, { waiters: new Set(), at: Date.now() })
    return id
  }

  waitingFor(id: string, what: 'approval' | undefined): void {
    const e = this.#all.get(id)
    if (e) e.waitingFor = what
  }

  settle(id: string, result: TicketResult): void {
    const e = this.#all.get(id)
    if (!e || e.result) return
    e.result = result
    e.at = Date.now()
    for (const fn of e.waiters) fn(result)
    e.waiters.clear()
  }

  async wait(id: string, ms: number): Promise<TicketResult | TicketWaiting> {
    const e = this.#all.get(id)
    if (!e) throw new ApiFailure(404, 'not-found', 'There is no such ticket.')
    const pending = (): TicketWaiting => (e.waitingFor ? { done: false, waitingFor: e.waitingFor } : { done: false })
    if (e.result) return e.result
    const limit = Math.min(Math.max(ms, 0), MAX_WAIT_MS)
    if (limit === 0) return pending()
    return new Promise(resolve => {
      const done = (r: TicketResult): void => {
        clearTimeout(timer)
        resolve(r)
      }
      const timer = setTimeout(() => {
        e.waiters.delete(done)
        resolve(pending())
      }, limit)
      e.waiters.add(done)
    })
  }

  #prune(): void {
    const cutoff = Date.now() - KEEP_MS
    for (const [id, e] of this.#all) if (e.result && e.at < cutoff) this.#all.delete(id)
  }
}

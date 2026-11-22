// "Collect" and "Mini may use", per target (a device, or a whole connector) and scope. A missing row means off.

import { isScope, type GrantState, type ScopeId } from '@minihub/protocol'
import type { Store } from '../store/db.ts'
import { ApiFailure } from './policy.ts'

export type Grant = { collect: boolean; mini: GrantState; voiceSafe: boolean }
export type GrantRow = Grant & { target: string; scope: ScopeId }

const OFF: Grant = { collect: false, mini: 'off', voiceSafe: false }

export class Grants {
  #db: Store
  #now: () => number
  #listeners = new Set<() => void>()

  constructor(db: Store, now: () => number = Date.now) {
    this.#db = db
    this.#now = now
  }

  get(target: string, scope: ScopeId): Grant {
    const c = this.#db.prepare('SELECT enabled FROM collect WHERE target = ? AND scope = ?').get(target, scope) as { enabled: number } | undefined
    const g = this.#db.prepare('SELECT state, voice_safe FROM grants WHERE target = ? AND scope = ?').get(target, scope) as
      | { state: GrantState; voice_safe: number }
      | undefined
    return { collect: c?.enabled === 1, mini: g?.state ?? 'off', voiceSafe: g?.voice_safe === 1 }
  }

  set(target: string, scope: ScopeId, patch: Partial<Grant>): Grant {
    if (!isScope(scope)) throw new ApiFailure(400, 'bad-request', `There is no permission called "${String(scope)}".`)
    if (patch.mini !== undefined && !['off', 'ask', 'on'].includes(patch.mini)) throw new ApiFailure(400, 'bad-request', 'Mini may use is off, ask or on.')
    const now = this.#now()
    const next = { ...this.get(target, scope), ...patch }
    this.#db.transaction(() => {
      if (patch.collect !== undefined)
        this.#db
          .prepare('INSERT INTO collect (target, scope, enabled, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (target, scope) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at')
          .run(target, scope, next.collect ? 1 : 0, now)
      if (patch.mini !== undefined || patch.voiceSafe !== undefined)
        this.#db
          .prepare(
            'INSERT INTO grants (target, scope, state, voice_safe, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (target, scope) DO UPDATE SET state = excluded.state, voice_safe = excluded.voice_safe, updated_at = excluded.updated_at',
          )
          .run(target, scope, next.mini, next.voiceSafe ? 1 : 0, now)
    })()
    for (const fn of this.#listeners) fn()
    return next
  }

  list(): GrantRow[] {
    const keys = this.#db
      .prepare('SELECT target, scope FROM collect UNION SELECT target, scope FROM grants ORDER BY target, scope')
      .all() as Array<{ target: string; scope: ScopeId }>
    return keys.map(k => ({ target: k.target, scope: k.scope, ...this.get(k.target, k.scope) }))
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
}

export { OFF as GRANT_OFF }

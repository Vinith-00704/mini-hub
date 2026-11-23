// How long things are kept (docs/04 > What is kept, and for how long). Set in Settings > Data, stored under the
// settings key `retention`. A type that is not named is kept for ever; the audit log is kept a year by default.

import { z } from 'zod'
import type { EventType } from '@minihub/protocol'
import type { Audit } from '../audit/audit.ts'
import type { Logger } from '../connectors/types.ts'
import type { Events } from '../events.ts'
import { getSetting, setSetting, type Store } from '../store/db.ts'

export const KEEP = ['forever', '30d', '90d', '1y'] as const

export const RETAINED_TYPES = ['call', 'sms', 'chat', 'notification', 'mail', 'device_state', 'mini_action', 'system'] as const

export const retentionSchema = z.object({
  events: z.partialRecord(z.enum(RETAINED_TYPES), z.enum(KEEP)),
  audit: z.enum(['1y', '2y', 'forever']),
  mailBody: z.enum(['subjects', 'extract', 'full']),
})

export type RetentionSettings = z.infer<typeof retentionSchema>

/** Each part may be left out; `events` is merged by type. */
export const retentionPatchSchema = retentionSchema.partial().strict()

export const DEFAULT_RETENTION: RetentionSettings = { events: {}, audit: '1y', mailBody: 'extract' }

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS: Record<string, number> = { '30d': 30, '90d': 90, '1y': 365, '2y': 730 }

type Deps = { db: Store; events: Events; audit: Audit; log: Logger }

export class Retention {
  #d: Deps

  constructor(deps: Deps) {
    this.#d = deps
  }

  /** What is set now, with the defaults filled in. A stored value that is no longer valid counts as the default. */
  current(): RetentionSettings {
    const stored = retentionSchema.partial().safeParse(getSetting<unknown>(this.#d.db, 'retention', {}))
    const s = stored.success ? stored.data : {}
    return { events: { ...DEFAULT_RETENTION.events, ...s.events }, audit: s.audit ?? DEFAULT_RETENTION.audit, mailBody: s.mailBody ?? DEFAULT_RETENTION.mailBody }
  }

  /** Changes what is set. Takes effect at the next run, not at once. */
  update(patch: z.infer<typeof retentionPatchSchema>): RetentionSettings {
    const now = this.current()
    const next: RetentionSettings = {
      events: { ...now.events, ...patch.events },
      audit: patch.audit ?? now.audit,
      mailBody: patch.mailBody ?? now.mailBody,
    }
    setSetting(this.#d.db, 'retention', next)
    return next
  }

  /** Removes what is older than the owner keeps, and says so: one hub note and one audit row each, never what went. */
  prune(now: number): { events: number; audit: number } {
    const set = this.current()
    let removed = 0
    const types: EventType[] = []
    for (const [type, keep] of Object.entries(set.events) as Array<[EventType, (typeof KEEP)[number]]>) {
      const days = DAYS[keep]
      if (!days) continue
      const n = this.#d.events.removeOlder(type, now - days * DAY_MS)
      if (n > 0) (removed += n, types.push(type))
    }
    if (removed > 0) {
      this.#d.events.addHub({ type: 'system', occurredAt: now, title: `Removed ${removed} old items, as set in Settings > Data` })
      this.#d.audit.append({ caller: 'system', action: 'prune', outcome: 'done', data: { count: removed, types } })
    }

    let audit = 0
    const auditDays = DAYS[set.audit]
    if (auditDays) {
      audit = this.#d.audit.pruneBefore(now - auditDays * DAY_MS)
      if (audit > 0) this.#d.audit.append({ caller: 'system', action: 'prune-audit', outcome: 'done', data: { count: audit } })
    }
    if (removed > 0 || audit > 0) this.#d.log.info({ events: removed, audit }, 'removed old items')
    return { events: removed, audit }
  }
}

// Numbers for the boards (docs/superpowers/specs/2026-11-22-claude-look-design.md > Additions to the hub): what came
// in and what Mini did, per local day, and today against yesterday. Read-only; nothing new is stored.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { EventType } from '@minihub/protocol'
import type { Viewer } from '../../events.ts'
import type { Hub } from '../../hub.ts'

const CAME_IN = ['call', 'sms', 'chat', 'notification', 'mail'] as const satisfies readonly EventType[]
type Day = { cameIn: Record<(typeof CAME_IN)[number], number>; miniDid: number }

const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const midnight = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const emptyDay = (): Day => ({ cameIn: { call: 0, sms: 0, chat: 0, notification: 0, mail: 0 }, miniDid: 0 })

/** Every local day from `from` (a midnight) up to but not including `to`, filled from the events and the audit log. */
function count(hub: Hub, as: Viewer, from: number, to: number, days: string[]): Map<string, Day> {
  const out = new Map(days.map(d => [d, emptyDay()]))
  for (const r of hub.events.countsByDay(from, [...CAME_IN, 'mini_action'], as)) {
    const d = out.get(r.day)
    if (!d) continue
    if (r.type === 'mini_action') d.miniDid += r.n
    else d.cameIn[r.type as keyof Day['cameIn']] += r.n
  }
  // What Mini did on the PC: the actions it ran, from the audit log.
  const acts = hub.db
    .prepare(
      `SELECT date(at / 1000, 'unixepoch', 'localtime') AS day, count(*) AS n FROM audit
       WHERE caller = 'agent' AND action = 'act' AND outcome = 'done' AND at >= ? AND at < ? GROUP BY day`,
    )
    .all(from, to) as Array<{ day: string; n: number }>
  for (const r of acts) {
    const d = out.get(r.day)
    if (d) d.miniDid += r.n
  }
  return out
}

const sum = (v: Day | undefined) => ({
  calls: v?.cameIn.call ?? 0,
  messages: (v?.cameIn.sms ?? 0) + (v?.cameIn.chat ?? 0),
  notifications: v?.cameIn.notification ?? 0,
  mail: v?.cameIn.mail ?? 0,
  miniDid: v?.miniDid ?? 0,
})

export function statsRoutes(app: FastifyInstance, hub: Hub, now: () => number = Date.now): void {
  app.get('/v1/stats', { config: { access: 'both' } }, async req => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }).parse(req.query)
    const as: Viewer = req.caller.kind === 'person' ? { caller: 'person' } : { caller: 'agent', ...(req.caller.voice ? { voice: true } : {}) }
    const today = midnight(now())
    // The window always reaches back to yesterday, so today can be compared with it.
    const starts: number[] = []
    for (let i = Math.max(days, 2) - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      starts.push(d.getTime())
    }
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const byDay = count(hub, as, starts[0]!, tomorrow.getTime(), starts.map(localDay))
    const list = [...byDay.entries()].slice(-days).map(([date, v]) => ({ date, ...v }))
    return {
      days: list,
      today: { ...sum(byDay.get(localDay(today))), waiting: req.caller.kind === 'person' ? hub.approvals.waiting().length : 0 },
      yesterday: sum(byDay.get(localDay(starts[starts.length - 2]!))),
    }
  })
}

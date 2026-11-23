import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { EVENT_TYPES, eventScope, SCOPES, type EventType, type ScopeId } from '@minihub/protocol'
import type { Caller as AuditCaller } from '../../audit/audit.ts'
import { grantTarget, type EventQuery, type EventRow, type Viewer } from '../../events.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

const list = (v: unknown): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v.map(String) : [String(v)])

/** A whole number from the address, or a clear 400. */
const whole = (name: string, v: unknown, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiFailure(400, 'bad-request', `"${name}" must be a whole number${min > 0 ? ` from ${min} to ${max}` : ''}.`)
  return n
}

const querySchema = z.object({
  type: z.unknown().optional(),
  device: z.string().max(100).optional(),
  who: z.string().max(200).optional(),
  after: z.unknown().optional(),
  before: z.unknown().optional(),
  q: z.string().max(200).optional(),
  unseen: z.unknown().optional(),
  limit: z.unknown().optional(),
  cursor: z.string().max(100).optional(),
})

const toQuery = (raw: unknown): EventQuery => {
  const q = querySchema.parse(raw)
  const types = list(q.type) as EventType[] | undefined
  for (const t of types ?? []) if (!EVENT_TYPES.includes(t)) throw new ApiFailure(400, 'bad-request', `There is no event type "${t}".`)
  const out: EventQuery = {}
  if (types) out.types = types
  if (q.device) out.device = q.device
  if (q.who) out.who = q.who
  const after = whole('after', q.after)
  const before = whole('before', q.before)
  const limit = whole('limit', q.limit, 1, 200)
  if (after !== undefined) out.after = after
  if (before !== undefined) out.before = before
  if (limit !== undefined) out.limit = limit
  if (q.q) out.q = q.q
  if (q.unseen === 'true' || q.unseen === '1') out.unseen = true
  if (q.cursor) out.cursor = q.cursor
  return out
}

export const viewerOf = (hub: Hub, req: FastifyRequest): Viewer => {
  if (req.caller.kind === 'person') return { caller: 'person' }
  if (!req.caller.voice) return { caller: 'agent' }
  return { caller: 'agent', voice: true, voicePrivate: hub.grants.get('alexa', 'voice.alexa.private').mini === 'on' }
}

/** The scopes a query touches on the devices it covers, split by what Mini may do with each. */
const scopesFor = (hub: Hub, types: EventType[] | undefined, device?: string) => {
  const on = new Set<ScopeId>()
  const off: Array<{ scope: ScopeId; label: string }> = []
  for (const d of hub.devices.list()) {
    if (device && d.id !== device) continue
    for (const t of types?.length ? types : EVENT_TYPES) {
      const scope = eventScope(t, d.kind)
      if (scope === 'own' || scope === 'person' || SCOPES[scope].connector !== d.connectorId) continue
      const mini = hub.grants.get(grantTarget(scope, d.id), scope).mini
      if (mini === 'on') on.add(scope)
      else if (mini === 'off' && !off.some(o => o.scope === scope)) off.push({ scope, label: SCOPES[scope].label })
    }
  }
  return { on: [...on], off }
}

export function eventRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/events', { config: { access: 'both', selfAudit: true, audit: 'read' } }, async (req, reply) => {
    const q = toQuery(req.query)
    const viewer = viewerOf(hub, req)
    if (viewer.caller === 'person') return hub.events.query(q, viewer)

    // Mini's reads are written down with what kind of data, how much, and which events: never what they say.
    const caller: AuditCaller = 'agent'
    const detail = viewer.voice ? { detail: 'voice' } : {}
    const logRead = (outcome: 'done' | 'refused' | 'waiting', scopes: ScopeId[], items: EventRow[] = []) => {
      req.audited = true
      hub.audit.append({ caller, ...detail, action: 'read', target: 'events', outcome, data: { count: items.length, ids: items.slice(0, 200).map(e => e.id), scopes } })
    }

    if (!viewer.voice) {
      const asking = hub.events.askingScopes(q.types, q.device)
      if (asking.length) {
        // Some of what Mini asked for is on "ask": the owner decides, in the dashboard, and the rows follow a yes.
        const names = [...new Set(asking.map(a => SCOPES[a.scope].label))].join(', ')
        const where = [...new Set(asking.map(a => hub.devices.get(a.deviceId)?.name ?? a.deviceId))].join(', ')
        const approval = hub.approvals.request({ scope: asking[0].scope, risk: 'read', action: 'events.read', args: { types: q.types ?? [], device: q.device ?? null }, summary: `Let Mini read: ${names} (${where})` })
        const ticket = hub.tickets.create()
        hub.tickets.waitingFor(ticket, 'approval')
        const scopes = [...new Set(asking.map(a => a.scope))]
        logRead('waiting', scopes)
        void hub.approvals.settled(approval.id).then(a => {
          if (a.state === 'yes' && !hub.stop.stopped) {
            hub.tickets.waitingFor(ticket, undefined)
            const result = hub.events.query(q, viewer, asking)
            hub.audit.append({ caller, action: 'read', target: 'events', outcome: 'done', data: { count: result.items.length, ids: result.items.slice(0, 200).map(e => e.id), scopes } })
            hub.tickets.settle(ticket, { done: true, ok: true, data: result })
          } else {
            hub.audit.append({ caller, action: 'read', target: 'events', outcome: 'refused', data: { count: 0, ids: [], scopes } })
            hub.tickets.settle(ticket, { done: true, ok: false, code: 'not-allowed', error: a.state === 'expired' ? 'The owner did not answer in time.' : 'The owner said no.' })
          }
        })
        return reply.code(202).send({ ticket, waitingFor: 'approval' })
      }
    }

    const { on, off } = scopesFor(hub, q.types, q.device)
    const asksOwn = !q.types?.length || q.types.includes('mini_action')
    if (q.types?.length && !on.length && !asksOwn && off.length) {
      logRead('refused', off.map(o => o.scope))
      throw new ApiFailure(403, 'not-allowed', `${off.map(o => o.label).join(', ')}: switched off for Mini. The owner can change this in Mini Hub > Permissions.`, off[0].scope)
    }
    const result = hub.events.query(q, viewer)
    logRead('done', on, result.items)
    return q.types?.length && off.length ? { ...result, notAllowed: off } : result
  })

  app.get('/v1/events/:id', { config: { access: 'both' } }, async req => hub.events.get(Number((req.params as { id: string }).id), viewerOf(hub, req)))

  app.get('/v1/people', { config: { access: 'both' } }, async req => ({ items: hub.events.people(viewerOf(hub, req)) }))

  app.post('/v1/events/seen', { config: { access: 'person' } }, async req => {
    const { ids } = z.object({ ids: z.array(z.number().int()).max(1000) }).parse(req.body)
    hub.events.markSeen(ids)
    return { ok: true }
  })

  // `{ ids }` deletes those events; `{ types }` deletes every event of those kinds, with its own audit row naming them.
  app.delete('/v1/events', { config: { access: 'person', audit: 'delete', selfAudit: true } }, async req => {
    const body = z
      .union([z.object({ ids: z.array(z.number().int()).max(1000) }), z.object({ types: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length) })])
      .parse(req.body)
    if ('ids' in body) return { removed: hub.events.remove(body.ids) }
    const types = [...new Set(body.types)]
    const removed = hub.events.removeTypes(types)
    req.audited = true
    hub.audit.append({ caller: 'person', action: 'delete', target: 'events', outcome: 'done', data: { types, count: removed } })
    hub.live.emit('topic', 'events')
    return { removed }
  })
}

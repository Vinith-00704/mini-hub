import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isScope, SCOPES, type ScopeId } from '@minihub/protocol'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

/** Every switch the owner could set today: each device's own scopes, and one row per shared connector scope. */
const allRows = (hub: Hub) => {
  const devices = hub.devices.list().filter(d => d.id !== 'hub')
  type Row = { target: string; targetName: string; scope: ScopeId; label: string; kind: string; collectable: boolean; collect: boolean; mini: string; voiceSafe: boolean; phone?: { mini: string; pc: string } }
  const rows: Row[] = []
  // A phone's own two lists, as it last reported them (docs/04 > Whose switches win). Shown, never set from here.
  const phoneLists = (id: string, scope: ScopeId): Pick<Row, 'phone'> => {
    const lists = hub.devices.get(id)?.state.lists as { mini?: Record<string, string>; pc?: Record<string, string> } | undefined
    return lists ? { phone: { mini: lists.mini?.[scope] ?? 'off', pc: lists.pc?.[scope] ?? 'off' } } : {}
  }
  const connectors = new Set(devices.map(d => d.connectorId))
  for (const [scope, def] of Object.entries(SCOPES) as Array<[ScopeId, (typeof SCOPES)[ScopeId]]>) {
    const targets = def.perDevice
      ? devices.filter(d => d.connectorId === def.connector).map(d => ({ id: d.id, name: d.name }))
      : connectors.has(def.connector)
        ? [{ id: def.connector, name: def.connector }]
        : []
    for (const t of targets)
      rows.push({ target: t.id, targetName: t.name, scope, label: def.label, kind: def.kind, collectable: def.collectable, ...hub.grants.get(t.id, scope), ...(def.connector === 'android' ? phoneLists(t.id, scope) : {}) })
  }
  return rows
}

const knownTarget = (hub: Hub, target: string): boolean => Boolean(hub.devices.get(target)) || Object.values(SCOPES).some(s => !s.perDevice && s.connector === target)

export function ruleRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/grants', { config: { access: 'both' } }, async () => ({ items: allRows(hub) }))

  app.put('/v1/grants/:target/:scope', { config: { access: 'person', audit: 'grant' } }, async req => {
    const { target, scope } = req.params as { target: string; scope: string }
    if (!isScope(scope)) throw new ApiFailure(404, 'not-found', `There is no permission called "${scope}".`)
    if (!knownTarget(hub, target)) throw new ApiFailure(404, 'not-found', 'There is no such device.')
    const patch = z
      .object({ collect: z.boolean().optional(), mini: z.enum(['off', 'ask', 'on']).optional(), voiceSafe: z.boolean().optional() })
      .strict()
      .parse(req.body)
    if (patch.collect !== undefined && !SCOPES[scope].collectable) throw new ApiFailure(400, 'bad-request', 'This one has nothing to collect.')
    return hub.grants.set(target, scope, {
      ...(patch.collect !== undefined ? { collect: patch.collect } : {}),
      ...(patch.mini !== undefined ? { mini: patch.mini } : {}),
      ...(patch.voiceSafe !== undefined ? { voiceSafe: patch.voiceSafe } : {}),
    })
  })

  app.get('/v1/approvals', { config: { access: 'person' } }, async () => {
    hub.approvals.expireDue()
    return { approvals: hub.approvals.list() }
  })

  app.post('/v1/approvals/:id', { config: { access: 'person', audit: 'approve' } }, async req => {
    const { decision } = z.object({ decision: z.enum(['yes', 'no']) }).parse(req.body)
    return hub.approvals.decide((req.params as { id: string }).id, decision)
  })

  app.post('/v1/stop', { config: { access: 'both', whenStopped: true, selfAudit: true, audit: 'stop' } }, async req => {
    req.audited = true
    await hub.stopMini(req.caller.kind === 'person' ? 'person' : 'agent')
    return { stopped: true }
  })

  app.post('/v1/resume', { config: { access: 'person', audit: 'resume' } }, async () => {
    hub.stop.resume()
    return { stopped: false }
  })

  app.get('/v1/audit', { config: { access: 'both' } }, async req => {
    const q = z
      .object({ caller: z.string().max(20).optional(), action: z.string().max(40).optional(), scope: z.string().max(60).optional(), after: z.coerce.number().int().optional(), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query)
    const query = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined))
    return { items: hub.audit.list(req.caller.kind === 'agent' ? { ...query, agentOnly: true } : query) }
  })

  app.get('/v1/audit/check', { config: { access: 'person' } }, async () => hub.audit.check())
}

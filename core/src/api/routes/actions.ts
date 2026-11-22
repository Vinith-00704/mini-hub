// Doing things: the person runs an action; Mini's request runs, waits for the owner, or is refused (docs/03 > Risk).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { grantTarget } from '../../events.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure, decide } from '../../rules/policy.ts'

const body = z.object({
  connector: z.string().max(40),
  device: z.string().max(100).optional(),
  name: z.string().max(60),
  args: z.unknown().optional(),
})

export function actionRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/actions', { config: { access: 'both' } }, async req => {
    const all = hub.registry.actions()
    if (req.caller.kind === 'person') return { items: all }
    return { items: all.filter(a => !a.personOnly && hub.grants.get(grantTarget(a.scope, a.connector), a.scope).mini !== 'off') }
  })

  app.post('/v1/actions', { config: { access: 'both', selfAudit: true, audit: 'act' } }, async (req, reply) => {
    const b = body.parse(req.body)
    const def = hub.registry.find(b.connector, b.name)
    const caller = req.caller
    const audit = (outcome: 'done' | 'refused' | 'failed' | 'waiting') => {
      req.audited = true
      return hub.audit.append({
        caller: caller.kind === 'person' ? 'person' : 'agent',
        ...(caller.kind === 'agent' && caller.voice ? { detail: 'voice' } : {}),
        action: 'act',
        target: `${b.connector}.${b.name}${b.device ? `@${b.device}` : ''}`,
        scope: def.scope,
        risk: def.risk,
        outcome,
      })
    }

    if (caller.kind === 'agent' && def.personOnly) throw new ApiFailure(403, 'forbidden', 'Only the owner can do this, in Mini Hub.')
    const parsed = def.args.safeParse(b.args ?? {})
    if (!parsed.success) throw new ApiFailure(400, 'bad-request', parsed.error.issues[0]?.message ?? 'Those details are not valid.')
    const args = parsed.data
    const device = b.device ? hub.devices.get(b.device) : undefined
    if (b.device && !device) throw new ApiFailure(404, 'not-found', 'There is no such device.')
    // A grant is looked up under the device the action is for, so the device must belong to the action's connector.
    if (device && device.connectorId !== b.connector) throw new ApiFailure(400, 'bad-request', `${device.name} is not a ${b.connector} device.`)

    const target = grantTarget(def.scope, b.device ?? b.connector)
    const grant = hub.grants.get(target, def.scope)
    const decision = decide({
      caller: caller.kind,
      voice: caller.kind === 'agent' && caller.voice,
      risk: def.risk,
      grant: grant.mini,
      voiceSafe: grant.voiceSafe,
      stopped: hub.stop.stopped,
    })

    if (decision.kind === 'refuse') {
      audit('refused')
      if (decision.code === 'stopped') throw new ApiFailure(423, 'stopped', 'Mini is stopped. The owner can resume it in Mini Hub.')
      throw new ApiFailure(403, 'not-allowed', `"${def.title}" is switched off for Mini. The owner can change this in Mini Hub > Permissions.`, def.scope)
    }

    const ticket = hub.tickets.create()
    const run = async (): Promise<void> => {
      try {
        const data = await def.run(args, device)
        hub.tickets.settle(ticket, { done: true, ok: true, data })
        audit('done')
      } catch (error) {
        hub.tickets.settle(ticket, { done: true, ok: false, error: error instanceof Error ? error.message : 'That did not work.', code: 'unavailable' })
        audit('failed')
      }
    }

    if (decision.kind === 'run') {
      void run()
      return reply.code(202).send({ ticket })
    }

    const approval = hub.approvals.request({
      scope: def.scope,
      risk: def.risk,
      ...(b.device ? { deviceId: b.device } : {}),
      action: `${b.connector}.${b.name}`,
      args,
      summary: def.describe ? def.describe(args, device) : def.title,
    })
    hub.tickets.waitingFor(ticket, 'approval')
    audit('waiting')
    void hub.approvals.settled(approval.id).then(a => {
      // The answer is checked again here: a Stop between the question and the yes still wins.
      if (a.state === 'yes' && !hub.stop.stopped) return run()
      hub.tickets.settle(ticket, { done: true, ok: false, code: 'not-allowed', error: a.state === 'expired' ? 'The owner did not answer in time.' : 'The owner said no.' })
      audit('refused')
    })
    return reply.code(202).send({ ticket, waitingFor: 'approval' })
  })

  app.get('/v1/tickets/:id', { config: { access: 'both' } }, async req => {
    const wait = Number((req.query as { wait?: string }).wait ?? 0)
    return hub.tickets.wait((req.params as { id: string }).id, Number.isFinite(wait) ? wait : 0)
  })
}

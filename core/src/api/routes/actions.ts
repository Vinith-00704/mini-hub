// Doing things: the person runs an action; Mini's request runs, waits for the owner, or is refused (docs/03 > Risk).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SCOPES } from '@minihub/protocol'
import type { ActionInfo } from '../../connectors/types.ts'
import { grantTarget } from '../../events.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure, decide } from '../../rules/policy.ts'

const body = z.object({
  connector: z.string().max(40),
  device: z.string().max(100).optional(),
  name: z.string().max(60),
  args: z.unknown().optional(),
})

/** What a connector's devices are called when Mini or the owner has to say which one. */
const WHICH: Record<string, string> = { android: 'phone', mail: 'account' }

export function actionRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/actions', { config: { access: 'both' } }, async req => {
    const person = req.caller.kind === 'person'
    const devices = hub.devices.list()
    const items: ActionInfo[] = []
    for (const a of hub.registry.actions()) {
      if (!person && a.personOnly) continue
      if (!hub.registry.get(a.connector)?.manifest.multiple) {
        if (person || hub.grants.get(grantTarget(a.scope, a.connector), a.scope).mini !== 'off') items.push(a)
        continue
      }
      // A connector with several devices: which ones it can run on. Mini sees only those whose switch for it is not off.
      const own = devices
        .filter(d => d.connectorId === a.connector)
        .filter(d => person || hub.grants.get(grantTarget(a.scope, d.id), a.scope).mini !== 'off')
        .map(d => ({ id: d.id, name: d.name }))
      if (person || own.length) items.push({ ...a, devices: own })
    }
    return { items }
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
    // With no device named, a per-device action uses its connector's only device; with several, it has to be said.
    // Resolved before anything below names the device: the audit row, the grant and the approval.
    if (!b.device && SCOPES[def.scope].perDevice) {
      const own = hub.devices.list().filter(d => d.connectorId === b.connector)
      if (own.length === 1) b.device = own[0].id
      else if (own.length > 1) {
        // Mini is offered the same names as its list of actions gives: only devices whose switch for this is not off.
        const named = caller.kind === 'person' ? own : own.filter(d => hub.grants.get(grantTarget(def.scope, d.id), def.scope).mini !== 'off')
        // Every one of them is off for Mini: that is the switch's refusal, not a question of which.
        if (!named.length) {
          audit('refused')
          throw new ApiFailure(403, 'not-allowed', `"${def.title}" is switched off for Mini. The owner can change this in Mini Hub > Permissions.`, def.scope)
        }
        throw new ApiFailure(400, 'bad-request', `Say which ${WHICH[b.connector] ?? 'device'}: ${named.map(d => d.name).join(', ')}.`)
      }
    }
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
    const run = async (approvalId?: string): Promise<void> => {
      try {
        const data = await def.run(args, device, {
          origin: caller.kind === 'person' ? 'person' : 'agent',
          approved: caller.kind === 'person' || approvalId !== undefined,
          ...(approvalId ? { approvalId } : {}),
          onWaiting: () => hub.tickets.waitingFor(ticket, 'phone'),
        })
        hub.tickets.settle(ticket, { done: true, ok: true, data })
        audit('done')
      } catch (error) {
        const known = error instanceof ApiFailure
        hub.tickets.settle(ticket, {
          done: true,
          ok: false,
          error: error instanceof Error ? error.message : 'That did not work.',
          code: known ? error.code : 'unavailable',
          ...(known && error.scope ? { scope: error.scope } : {}),
        })
        audit(known && error.code === 'not-allowed' ? 'refused' : 'failed')
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
      if (a.state === 'yes' && !hub.stop.stopped) {
        // The owner said yes: the ticket now waits for the work itself, so Mini can tell "running" from "not answered".
        hub.tickets.waitingFor(ticket, undefined)
        return run(approval.id)
      }
      hub.tickets.settle(ticket, { done: true, ok: false, code: 'not-allowed', error: a.state === 'expired' ? 'The owner did not answer in time.' : 'The owner said no.' })
      audit('refused')
    })
    return reply.code(202).send({ ticket, waitingFor: 'approval' })
  })

  // Mini polls a ticket every few seconds while the owner decides. One row is written per outcome Mini learns, not one
  // per poll: a poll that is still waiting, or that repeats a result already given, writes nothing. A ticket that is
  // not there (the hub restarted) still gets its row from the server's own hook.
  app.get('/v1/tickets/:id', { config: { access: 'both', selfAudit: true } }, async req => {
    const id = (req.params as { id: string }).id
    const wait = Number((req.query as { wait?: string }).wait ?? 0)
    const result = await hub.tickets.wait(id, Number.isFinite(wait) ? wait : 0)
    req.audited = true
    if (req.caller.kind === 'agent' && result.done && hub.tickets.firstTold(id))
      hub.audit.append({ caller: 'agent', ...(req.caller.voice ? { detail: 'voice' } : {}), action: 'read', target: '/v1/tickets/:id', outcome: 'done' })
    return result
  })
}

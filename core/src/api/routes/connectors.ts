// The connectors and their guided setup (docs/05 > Devices and connectors, docs/06 > The interface). Person only for
// setup; what is typed there is never logged, and its audit row names the connector only.

import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Connector, SetupStep } from '../../connectors/types.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

/** How long one run of a setup may take, from its first step. */
const SESSION_MS = 15 * 60_000

const body = z.object({
  session: z.string().max(40).optional(),
  step: z.string().max(40).nullable(),
  input: z.unknown().optional(),
})

type Session = { connector: string; timer: NodeJS.Timeout }

export function connectorRoutes(app: FastifyInstance, hub: Hub): void {
  const sessions = new Map<string, Session>()

  const expired = (): ApiFailure => new ApiFailure(409, 'expired', 'This setup took too long. Start again.')

  /**
   * Ends a run, and tells the connector to drop what it held for it (a password typed but not saved). Every end of a
   * run tells it: cancel, time out, done, error, a failed step, and a step that finished after its run had ended.
   */
  const end = async (id: string, c: Connector): Promise<void> => {
    const s = sessions.get(id)
    if (s) {
      clearTimeout(s.timer)
      sessions.delete(id)
    }
    // Never lets a connector's own failure through, even one thrown before it returned a promise.
    await Promise.resolve()
      .then(() => c.setup?.(hub.registry.ctx(c.manifest.id), id, 'cancel', undefined))
      .catch(() => {})
  }

  const begin = (c: Connector): string => {
    const id = randomBytes(8).toString('hex')
    const timer = setTimeout(() => void end(id, c), SESSION_MS)
    timer.unref()
    sessions.set(id, { connector: c.manifest.id, timer })
    return id
  }

  app.addHook('onClose', async () => {
    for (const s of sessions.values()) clearTimeout(s.timer)
    sessions.clear()
  })

  app.get('/v1/connectors', { config: { access: 'both' } }, async () => {
    const devices = hub.devices.list()
    return {
      items: hub.registry.list().map(c => ({
        id: c.manifest.id,
        name: c.manifest.name,
        kind: c.manifest.kind,
        icon: c.manifest.icon,
        ...c.health(),
        devices: devices.filter(d => d.connectorId === c.manifest.id).length,
      })),
    }
  })

  app.post('/v1/connectors/:id/setup', { config: { access: 'person', audit: 'setup' } }, async req => {
    const c = hub.registry.get((req.params as { id: string }).id)
    if (!c?.setup) throw new ApiFailure(404, 'not-found', 'This kind of device has no setup here.')
    const b = body.parse(req.body ?? {})

    // A first step starts a run; every other step belongs to a run of this connector that has not run out of time.
    let session: string
    if (b.step === null) {
      // Starting again ends the run it replaces, so nothing typed there is kept for its remaining minutes.
      if (b.session !== undefined && sessions.get(b.session)?.connector === c.manifest.id) await end(b.session, c)
      session = begin(c)
    } else {
      session = b.session ?? ''
      const known = sessions.get(session)
      if (known && known.connector !== c.manifest.id) throw new ApiFailure(409, 'conflict', 'This setup is for another kind of device. Start again.')
      if (b.step === 'cancel') {
        if (known) await end(session, c)
        return { session, step: { kind: 'error', text: 'Cancelled.' } satisfies SetupStep }
      }
      if (!known) throw expired()
    }

    let step: SetupStep
    try {
      step = await c.setup(hub.registry.ctx(c.manifest.id), session, b.step, b.input)
    } catch (error) {
      if (!sessions.has(session)) {
        await end(session, c)
        throw expired()
      }
      if (error instanceof ApiFailure) throw error
      await end(session, c)
      // Never the error's own text: it can carry what the owner typed or a server's raw answer.
      hub.log.warn({ connector: c.manifest.id }, 'a setup step failed')
      throw new ApiFailure(500, 'unavailable', 'The setup did not work. Start again.')
    }
    // The run ran out of time, or was cancelled, while this step was under way: what the step kept goes too.
    if (!sessions.has(session)) {
      await end(session, c)
      throw expired()
    }
    if (step.kind === 'done' || step.kind === 'error') await end(session, c)
    return { session, step }
  })
}

import type { FastifyInstance } from 'fastify'
import type { Hub } from '../../hub.ts'

const startOfToday = (): number => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function basicRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/health', { config: { access: 'public' } }, async () => ({ ok: true, version: hub.version }))

  app.get('/v1/state', { config: { access: 'both' } }, async req => {
    const devices = hub.devices.list().filter(d => d.id !== 'hub')
    const connectors = hub.registry.list().map(c => ({ id: c.manifest.id, name: c.manifest.name, ...c.health() }))
    if (req.caller.kind === 'agent') {
      // Mini is told what is connected, not what is in it; reading goes through the grants.
      return { stopped: false, devices: devices.map(d => ({ id: d.id, name: d.name, kind: d.kind })), connectors }
    }
    const mini = hub.mini.snapshot()
    return {
      version: hub.version,
      stopped: hub.stop.stopped,
      devices,
      connectors,
      today: hub.events.counts(startOfToday(), { caller: 'person' }),
      approvalsWaiting: hub.approvals.waiting().length,
      mini: { running: mini.running, ...(mini.profile ? { profile: mini.profile } : {}), ...(mini.phase ? { phase: mini.phase } : {}), cardWaiting: Boolean(mini.card) },
    }
  })
}

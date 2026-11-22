import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { eventScope } from '@minihub/protocol'
import type { Device } from '../../connectors/types.ts'
import { grantTarget } from '../../events.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

/**
 * What Mini may see of a device: what it is, and its state only where the scope for that device's status is on.
 * Never its info (addresses, models, accounts).
 */
const forAgent = (hub: Hub, d: Device): Record<string, unknown> => {
  const scope = eventScope('device_state', d.kind)
  const base = { id: d.id, name: d.name, kind: d.kind }
  if (scope === 'own' || scope === 'person') return base
  return hub.grants.get(grantTarget(scope, d.id), scope).mini === 'on' ? { ...base, state: d.state } : base
}

const view = (hub: Hub, req: FastifyRequest, d: Device) => (req.caller.kind === 'person' ? d : forAgent(hub, d))

export function deviceRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/devices', { config: { access: 'both' } }, async req => ({
    items: hub.devices
      .list()
      .filter(d => d.id !== 'hub')
      .map(d => view(hub, req, d)),
  }))

  app.get('/v1/devices/:id', { config: { access: 'both' } }, async req => {
    const d = hub.devices.get((req.params as { id: string }).id)
    if (!d || d.id === 'hub') throw new ApiFailure(404, 'not-found', 'There is no such device.')
    return view(hub, req, d)
  })

  app.patch('/v1/devices/:id', { config: { access: 'person', audit: 'rename' } }, async req => {
    const patch = z.object({ name: z.string().trim().min(1).max(60).optional(), room: z.string().trim().max(60).nullable().optional() }).parse(req.body)
    return hub.devices.rename((req.params as { id: string }).id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.room !== undefined ? { room: patch.room } : {}),
    })
  })

  app.delete('/v1/devices/:id', { config: { access: 'person', audit: 'remove' } }, async req => {
    const id = (req.params as { id: string }).id
    const d = hub.devices.get(id)
    if (!d || d.id === 'hub') throw new ApiFailure(404, 'not-found', 'There is no such device.')
    if (d.connectorId !== 'android') throw new ApiFailure(400, 'bad-request', `${d.name} is part of the hub and cannot be removed.`)
    const { deleteEvents } = z.object({ deleteEvents: z.boolean().optional() }).parse(req.body ?? {})
    hub.removeDevice(id, deleteEvents === true)
    return { removed: id }
  })

  app.get('/v1/connectors', { config: { access: 'both' } }, async () => ({
    items: hub.registry.list().map(c => ({ id: c.manifest.id, name: c.manifest.name, kind: c.manifest.kind, icon: c.manifest.icon, ...c.health() })),
  }))
}

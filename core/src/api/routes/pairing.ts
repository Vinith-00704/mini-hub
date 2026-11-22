// Pairing a phone from the dashboard (docs/05 > Devices and connectors). Person only; the code is never logged.

import type { FastifyInstance } from 'fastify'
import type { Hub } from '../../hub.ts'

export function pairingRoutes(app: FastifyInstance, hub: Hub): void {
  app.post('/v1/pairing', { config: { access: 'person', audit: 'pair-start' } }, async () => hub.pairing.start())
  app.get('/v1/pairing', { config: { access: 'person' } }, async () => hub.pairing.current() ?? { state: 'none' })
  app.post('/v1/pairing/confirm', { config: { access: 'person', audit: 'pair' } }, async () => ({ deviceId: hub.pairing.confirm() }))
  app.post('/v1/pairing/cancel', { config: { access: 'person', audit: 'pair-cancel' } }, async () => (hub.pairing.cancel(), { ok: true }))
}

// Settings > Network (docs/05): how phones reach this PC. Person only.

import type { FastifyInstance } from 'fastify'
import { LINK_PORT } from '@minihub/protocol/link'
import type { Hub } from '../../hub.ts'

export function networkRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/network', { config: { access: 'person' } }, async () => ({
    open: hub.link.isOpen,
    addresses: hub.link.addresses,
    port: hub.link.isOpen ? hub.link.port : LINK_PORT,
    fingerprint: hub.link.fp,
    name: hub.link.name,
    phones: hub.tokens.paired().length,
    alexa: { state: 'off', note: 'Not set up. It comes with the Echo Dot update.' },
  }))
}

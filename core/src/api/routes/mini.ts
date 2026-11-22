// The dashboard's view of the Mini Bot. A question waiting in the bot is shown, never answered from here.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

export function miniRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/mini', { config: { access: 'person' } }, async () => hub.mini.snapshot())

  app.get('/v1/mini/conversation', { config: { access: 'person' } }, async () => ({ turns: hub.mini.conversation() }))

  app.post('/v1/mini/prompt', { config: { access: 'person', audit: 'prompt' } }, async req => {
    const { text } = promptBody.parse(req.body)
    try {
      return { id: await hub.mini.prompt(text) }
    } catch (error) {
      throw new ApiFailure(503, 'unavailable', error instanceof Error ? error.message : 'Mini is not running.')
    }
  })

  // The bot being away is an answer the owner can act on, not a fault in the hub.
  const reach = async (fn: () => Promise<void>) => {
    try {
      await fn()
      return { ok: true }
    } catch (error) {
      throw new ApiFailure(503, 'unavailable', error instanceof Error ? error.message : 'Mini is not running.')
    }
  }

  app.post('/v1/mini/start', { config: { access: 'person', audit: 'start-bot' } }, async () => reach(() => hub.mini.startBot()))

  app.post('/v1/mini/stop', { config: { access: 'person', audit: 'stop-bot' } }, async () => reach(() => hub.mini.stopBot()))
}

export const promptBody = z.object({ text: z.string().trim().min(1).max(4000) })

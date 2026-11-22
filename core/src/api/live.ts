// WS /v1/live: pushes "this changed" to the dashboard. A browser cannot set headers on a WebSocket, so the person
// key is the first message; anything else closes the socket.

import type { FastifyInstance } from 'fastify'
import type { Hub, LiveTopic } from '../hub.ts'
import { isPersonKey, type Keys } from './server.ts'

const KEY_WAIT_MS = 5000
export const CLOSE_UNAUTHORIZED = 4401

export function liveRoutes(app: FastifyInstance, hub: Hub, keys: Keys): void {
  app.get('/v1/live', { websocket: true, config: { access: 'public' } }, socket => {
    let off: (() => void) | null = null
    const timer = setTimeout(() => socket.close(CLOSE_UNAUTHORIZED, 'no key'), KEY_WAIT_MS)
    socket.once('message', raw => {
      clearTimeout(timer)
      let key: unknown
      try {
        key = (JSON.parse(String(raw)) as { key?: unknown }).key
      } catch {}
      if (!isPersonKey(keys, key)) return socket.close(CLOSE_UNAUTHORIZED, 'wrong key')
      const send = (topic: LiveTopic): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ topic }))
      }
      hub.live.on('topic', send)
      off = () => hub.live.off('topic', send)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      off?.()
    })
  })
}

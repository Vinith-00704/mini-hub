// The core's local API (docs/05-hub-api.md): who is calling, what they may reach, and errors in one shape.

import { timingSafeEqual } from 'node:crypto'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { isScope, type ApiError } from '@minihub/protocol'
import type { Logger } from '../connectors/types.ts'
import type { Hub } from '../hub.ts'
import { ApiFailure } from '../rules/policy.ts'
import { liveRoutes } from './live.ts'
import { actionRoutes } from './routes/actions.ts'
import { basicRoutes } from './routes/basics.ts'
import { deviceRoutes } from './routes/devices.ts'
import { eventRoutes } from './routes/events.ts'
import { miniRoutes } from './routes/mini.ts'
import { ruleRoutes } from './routes/rules.ts'
import { settingsRoutes } from './routes/settings.ts'

export type Caller = { kind: 'person' } | { kind: 'agent'; voice: boolean }

export type Access = 'public' | 'person' | 'both'

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access
    /** The agent may still call this after Stop Mini. */
    whenStopped?: boolean
    /** The route writes its own audit rows. */
    selfAudit?: boolean
    /** The audit action for a person's change through this route. */
    audit?: string
  }
  interface FastifyRequest {
    caller: Caller
    /** The route wrote its own audit row for this request. */
    audited: boolean
  }
}

export type Keys = { person: string; agent: string }

const BODY_LIMIT = 256 * 1024

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const isPersonKey = (keys: Keys, value: unknown): boolean => typeof value === 'string' && same(value, keys.person)

const whoIs = (keys: Keys, req: FastifyRequest): Caller | null => {
  if (isPersonKey(keys, req.headers['x-hub-ui'])) return { kind: 'person' }
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && same(auth.slice(7), keys.agent))
    return { kind: 'agent', voice: req.headers['x-hub-origin'] === 'voice' }
  return null
}

const fail = (reply: FastifyReply, status: number, body: ApiError): FastifyReply => reply.code(status).send(body)

export async function buildServer(hub: Hub, keys: Keys, opts: { uiOrigin?: string; logger?: Logger } = {}): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: BODY_LIMIT, logger: false })
  app.decorateRequest('caller', null as never)
  app.decorateRequest('audited', false)

  // Only the dashboard's own origin may call from a page; preflights are answered before anything else.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (origin && opts.uiOrigin && origin === opts.uiOrigin) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'origin')
      reply.header('access-control-allow-headers', 'x-hub-ui, content-type')
      reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE')
    }
    if (req.method === 'OPTIONS') return reply.code(204).send()
  })

  app.addHook('preHandler', async (req, reply) => {
    const config = req.routeOptions.config
    const access = config.access ?? 'person'
    if (access === 'public') return
    const caller = whoIs(keys, req)
    if (!caller) return fail(reply, 401, { error: 'This needs the hub\'s key.', code: 'unauthorized' })
    req.caller = caller
    if (caller.kind === 'person') return
    if (access === 'person') return fail(reply, 403, { error: 'Only the owner can do this, in Mini Hub.', code: 'forbidden' })
    if (hub.stop.stopped && !config.whenStopped)
      return fail(reply, 423, { error: 'Mini is stopped. The owner can resume it in Mini Hub.', code: 'stopped' })
  })

  // Every request from Mini, and every change by the owner, is written down.
  app.addHook('onResponse', async (req, reply) => {
    const config = req.routeOptions.config
    // A route that audits itself still gets a row here when it ended before writing one (refused, not found, bad input).
    if (!req.caller || (config.selfAudit && req.audited)) return
    const status = reply.statusCode
    const outcome = status === 202 ? 'waiting' : status < 300 ? 'done' : status === 403 || status === 423 ? 'refused' : 'failed'
    const target = req.routeOptions.url ?? 'unknown route'
    if (req.caller.kind === 'agent')
      hub.audit.append({ caller: 'agent', ...(req.caller.voice ? { detail: 'voice' } : {}), action: config.audit ?? 'read', target, outcome })
    else if (config.audit) {
      // A change names what it changed: the device (or connector) and the permission, never the content.
      const params = (req.params ?? {}) as Record<string, string>
      const named = params.target ?? params.id
      hub.audit.append({
        caller: 'person',
        action: config.audit,
        target: named && named.length <= 100 ? named : target,
        ...(isScope(params.scope) ? { scope: params.scope } : {}),
        outcome,
      })
    }
  })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiFailure)
      return fail(reply, error.status, { error: error.message, code: error.code, ...(error.scope ? { scope: error.scope } : {}) })
    if (error instanceof ZodError) return fail(reply, 400, { error: error.issues[0]?.message ?? 'That request is not valid.', code: 'bad-request' })
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status === 413) return fail(reply, 413, { error: 'That request is too large.', code: 'too-large' })
    if (status >= 400 && status < 500) return fail(reply, status, { error: 'That request is not valid.', code: 'bad-request' })
    opts.logger?.error({ err: String(error) }, 'request failed')
    return fail(reply, 500, { error: 'Something went wrong in the hub.', code: 'unavailable' })
  })

  app.setNotFoundHandler((_req, reply) => fail(reply, 404, { error: 'There is nothing here.', code: 'not-found' }))

  await app.register(websocket)
  await app.register(async scope => {
    basicRoutes(scope, hub)
    eventRoutes(scope, hub)
    deviceRoutes(scope, hub)
    actionRoutes(scope, hub)
    ruleRoutes(scope, hub)
    miniRoutes(scope, hub)
    settingsRoutes(scope, hub)
    liveRoutes(scope, hub, keys)
  })
  return app
}

// The dashboard's boards (docs/05 > The dashboard's own things). Person only. Making, renaming, deleting and resetting
// a board is written to the audit log; moving it or changing its tiles is not (it would flood the log).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Hub } from '../../hub.ts'

const name = z.string().trim().min(1, 'Give the board a name.').max(40, 'A board name has at most 40 characters.')
const idOf = (params: unknown): string => (params as { id: string }).id

export function boardRoutes(app: FastifyInstance, hub: Hub): void {
  app.get('/v1/boards', { config: { access: 'person' } }, async () => ({ items: hub.boards.list() }))

  app.post('/v1/boards', { config: { access: 'person', audit: 'board', selfAudit: true } }, async req => {
    const b = z.object({ name, from: z.string().max(40).optional() }).strict().parse(req.body ?? {})
    const board = hub.boards.create(b.name, b.from)
    // The row names the new board by its id, never by its name.
    req.audited = true
    hub.audit.append({ caller: 'person', action: 'board', target: board.id, outcome: 'done' })
    return board
  })

  app.put('/v1/boards/:id', { config: { access: 'person' } }, async req => {
    const patch = z
      .object({ name: name.optional(), position: z.number().int().min(0).max(1000).optional(), layout: z.unknown().optional() })
      .strict()
      .parse(req.body ?? {})
    const id = idOf(req.params)
    const board = hub.boards.update(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.layout !== undefined ? { layout: patch.layout } : {}),
    })
    // A rename is written down, naming the board by its id, never by its name.
    if (patch.name !== undefined) hub.audit.append({ caller: 'person', action: 'board', target: id, outcome: 'done' })
    return board
  })

  app.delete('/v1/boards/:id', { config: { access: 'person', audit: 'board' } }, async req => {
    const id = idOf(req.params)
    hub.boards.remove(id)
    return { removed: id }
  })

  app.post('/v1/boards/:id/reset', { config: { access: 'person', audit: 'board' } }, async req => hub.boards.reset(idOf(req.params)))
}

// Backup and restore (Settings > Data; docs/04 > The backup, docs/05). Person only. The path and the passphrase are
// never logged or audited, and never put in an error: the audit row has the counts only.

import { statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ArchiveFailure, exportTo, importFrom } from '../../data/archive.ts'
import type { Hub } from '../../hub.ts'
import { ApiFailure } from '../../rules/policy.ts'

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The body, checked, with the plain words of each refusal. */
const parse = (raw: unknown): { path: string; passphrase: string } => {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const path = typeof b.path === 'string' && b.path.length <= 1024 ? b.path : ''
  const passphrase = typeof b.passphrase === 'string' ? b.passphrase : ''
  if (!isAbsolute(path) || !/\.minihub$/i.test(path)) throw new ApiFailure(400, 'bad-request', 'Choose a file ending in .minihub.')
  if (!isDir(dirname(path))) throw new ApiFailure(400, 'bad-request', 'That folder does not exist.')
  if (passphrase.length < 10 || passphrase.length > 200) throw new ApiFailure(400, 'bad-request', 'Use a passphrase of at least 10 characters.')
  return { path, passphrase }
}

export function dataRoutes(app: FastifyInstance, hub: Hub): void {
  // One backup or restore at a time.
  let busy = false
  const once = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy) throw new ApiFailure(409, 'conflict', 'A backup or a restore is already running. Wait for it to finish.')
    busy = true
    try {
      return await work()
    } finally {
      busy = false
    }
  }

  const done = (req: FastifyRequest, action: 'export' | 'import', data: Record<string, number>): void => {
    req.audited = true
    hub.audit.append({ caller: 'person', action, target: 'data', outcome: 'done', data })
  }

  app.post('/v1/data/export', { config: { access: 'person', audit: 'export', selfAudit: true } }, async req => {
    const { path, passphrase } = parse(req.body)
    const counts = await once(async () => {
      try {
        return await exportTo(hub.db, path, passphrase, hub.version)
      } catch (error) {
        // Only the error's code: its message names the file.
        hub.log.warn({ code: (error as NodeJS.ErrnoException).code ?? 'unknown' }, 'a backup could not be written')
        throw new ApiFailure(500, 'unavailable', 'The backup could not be written there. Choose another place.')
      }
    })
    done(req, 'export', counts)
    return counts
  })

  app.post('/v1/data/import', { config: { access: 'person', audit: 'import', selfAudit: true } }, async req => {
    const { path, passphrase } = parse(req.body)
    const result = await once(async () => {
      try {
        return await importFrom(hub.db, path, passphrase)
      } catch (error) {
        // Only the cause's code or name is logged: an error's message can name the file.
        if (error instanceof ArchiveFailure) hub.log.warn({ code: error.logCode }, 'a backup could not be restored')
        if (error instanceof ApiFailure) throw error
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') throw new ApiFailure(400, 'bad-request', 'There is no file there.')
        hub.log.warn({ code: code ?? 'unknown' }, 'a backup could not be read')
        throw new ApiFailure(500, 'unavailable', 'The file could not be read.')
      } finally {
        // The dashboard shows what the hub now holds, after a restore or after one was taken back.
        for (const topic of ['events', 'boards', 'devices', 'state'] as const) hub.live.emit('topic', topic)
      }
    })
    done(req, 'import', { added: result.events.added, skipped: result.events.skipped, boards: result.boards, devices: result.devices, boardsLeftOut: result.boardsLeftOut })
    return result
  })
}

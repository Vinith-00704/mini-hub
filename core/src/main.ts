// The hub core's entry point. The shell starts it and writes one line to its standard input:
//   {"dbKey":"<64 hex>","personKey":"<64 hex>","uiOrigin":"<the dashboard's origin, optional>"}
// The keys never touch the disk, the command line or the environment. When standard input ends, the core stops.
//
// Exit codes: 0 stopped normally, 2 the keys or the data could not be used, 3 already running.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import pino from 'pino'
import { buildServer } from './api/server.ts'
import { miniConnector } from './connectors/mini.ts'
import { createHub, VERSION } from './hub.ts'
import { createLogger } from './log.ts'
import { botHome, files, hubHome } from './paths.ts'
import { getMeta, openStore, setMeta, StoreError } from './store/db.ts'

const HEX64 = /^[0-9a-f]{64}$/

const die = (code: number, message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

const readKeys = (): Promise<{ dbKey: string; personKey: string; uiOrigin?: string }> =>
  new Promise(resolve => {
    const lines = createInterface({ input: process.stdin })
    lines.once('line', line => {
      lines.close()
      let raw: Record<string, unknown> = {}
      try {
        raw = JSON.parse(line) as Record<string, unknown>
      } catch {}
      const { dbKey, personKey, uiOrigin } = raw
      if (typeof dbKey !== 'string' || !HEX64.test(dbKey) || typeof personKey !== 'string' || !HEX64.test(personKey))
        die(2, 'The hub needs two keys of 64 hex characters on its first line of input.')
      resolve({ dbKey: dbKey as string, personKey: personKey as string, ...(typeof uiOrigin === 'string' ? { uiOrigin } : {}) })
    })
  })

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Only one core per data folder. The lock is taken before the database is opened, with an exclusive create, so two
 * cores started at the same moment cannot both get it. A lock left by a core that died is taken over.
 */
const takeLock = (lock: string): boolean => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let holder = 0
      try {
        holder = Number(readFileSync(lock, 'utf8').trim())
      } catch {}
      if (holder && holder !== process.pid && isAlive(holder)) return false
      rmSync(lock, { force: true })
    }
  }
  return false
}

/**
 * The installed app, when the core runs from one: the app keeps the core in a `core` folder next to `mini-hub.exe`.
 * Mini starts it to bring the window forward. Undefined in development.
 */
const installedShell = (): string | undefined => {
  const script = process.argv[1]
  if (!script || basename(dirname(script)) !== 'core') return undefined
  const exe = join(dirname(dirname(script)), 'mini-hub.exe')
  return existsSync(exe) ? exe : undefined
}

const writeAtomic = (file: string, text: string): void => {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}

async function main(): Promise<void> {
  const keys = await readKeys()
  const home = hubHome()
  const f = files(home)
  mkdirSync(f.logs, { recursive: true })
  const lock = `${f.info}.lock`
  if (!takeLock(lock)) die(3, 'Mini Hub is already running.')
  const releaseLock = (): void => {
    try {
      if (readFileSync(lock, 'utf8').trim() === String(process.pid)) rmSync(lock, { force: true })
    } catch {}
  }

  const log = createLogger(pino.destination({ dest: f.log, sync: true, mkdir: true }))
  let db
  try {
    db = openStore(f.db, keys.dbKey)
  } catch (error) {
    releaseLock()
    die(2, error instanceof StoreError ? error.message : "The hub's data could not be opened.")
  }

  const agentToken = randomBytes(32).toString('hex')
  const store = db!
  const mini = miniConnector({ botHome: botHome(), mark: { get: () => getMeta(store, 'miniLogMark') ?? '', set: v => setMeta(store, 'miniLogMark', v) } })
  const hub = await createHub(db!, { mini, log, dataDir: home })
  const app = await buildServer(hub, { person: keys.personKey, agent: agentToken }, { ...(keys.uiOrigin ? { uiOrigin: keys.uiOrigin } : {}), logger: log })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const port = (app.server.address() as { port: number }).port
  const shell = installedShell()
  writeAtomic(f.info, JSON.stringify({ port, token: agentToken, pid: process.pid, version: VERSION, ...(shell ? { shell } : {}) }))
  hub.audit.append({ caller: 'system', action: 'start', outcome: 'done', data: { version: VERSION } })
  log.info({ port, version: VERSION }, 'hub started')
  process.stdout.write(`${JSON.stringify({ ready: true, port })}\n`)

  let stopping = false
  const shutdown = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    log.info('hub stopping')
    try {
      const info = JSON.parse(readFileSync(f.info, 'utf8')) as { pid?: number }
      if (info.pid === process.pid) rmSync(f.info, { force: true })
    } catch {}
    try {
      hub.audit.append({ caller: 'system', action: 'stop-hub', outcome: 'done' })
    } catch {}
    await app.close().catch(() => {})
    await hub.close().catch(() => {})
    releaseLock()
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdown())
  process.stdin.on('close', () => void shutdown())
  process.stdin.resume()
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch(error => die(2, `The hub could not start: ${error instanceof Error ? error.message : String(error)}`))

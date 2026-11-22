import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { newKey, scratch } from './helpers.ts'

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url))

let s: ReturnType<typeof scratch>
const running: ChildProcessWithoutNullStreams[] = []

type Started = { child: ChildProcessWithoutNullStreams; port: number; out: string[]; err: string[] }

const start = (home: string, keys: { dbKey: string; personKey: string }, botHome = join(home, 'no-bot')): Promise<Started & { code?: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN], { env: { ...process.env, MINI_HUB_HOME: home, MINI_BOT_HOME: botHome } })
    running.push(child)
    const out: string[] = []
    const err: string[] = []
    child.stderr.on('data', d => err.push(String(d)))
    child.stdout.on('data', d => {
      out.push(String(d))
      const ready = out.join('').match(/\{"ready":true,"port":(\d+)\}/)
      if (ready) resolve({ child, port: Number(ready[1]), out, err })
    })
    child.on('exit', code => resolve({ child, port: 0, out, err, code: code ?? -1 }))
    child.on('error', reject)
    child.stdin.write(`${JSON.stringify(keys)}\n`)
  })

const exited = (child: ChildProcessWithoutNullStreams): Promise<number> =>
  new Promise(resolve => (child.exitCode !== null ? resolve(child.exitCode) : child.on('exit', code => resolve(code ?? -1))))

beforeEach(() => (s = scratch()))
afterEach(async () => {
  for (const c of running.splice(0)) if (c.exitCode === null) (c.kill(), await exited(c))
  s.done()
})

describe('main', () => {
  test('starts, writes hub.json, answers health, and removes hub.json on exit', async () => {
    const keys = { dbKey: newKey(), personKey: newKey() }
    const { child, port } = await start(s.dir, keys)
    expect(port).toBeGreaterThan(0)
    const info = JSON.parse(readFileSync(join(s.dir, 'hub.json'), 'utf8'))
    expect(info).toMatchObject({ port, pid: child.pid })
    expect(info.token).toMatch(/^[0-9a-f]{64}$/)
    expect(info.token).not.toBe(keys.personKey)
    const health = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json()
    expect(health.ok).toBe(true)
    const asAgent = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: { authorization: `Bearer ${info.token}` } })
    expect(asAgent.status).toBe(200)
    child.stdin.end()
    expect(await exited(child)).toBe(0)
    expect(existsSync(join(s.dir, 'hub.json'))).toBe(false)
  })

  test('a second start refuses while the first is alive', async () => {
    const keys = { dbKey: newKey(), personKey: newKey() }
    const first = await start(s.dir, keys)
    const before = readFileSync(join(s.dir, 'hub.json'), 'utf8')
    const second = await start(s.dir, keys)
    expect(second.code).toBe(3)
    expect(second.err.join('')).toContain('Mini Hub is already running')
    expect(readFileSync(join(s.dir, 'hub.json'), 'utf8')).toBe(before)
    first.child.stdin.end()
    await exited(first.child)
  })

  test('two cores started together: one runs, the other exits 3', async () => {
    const keys = { dbKey: newKey(), personKey: newKey() }
    const [a, b] = await Promise.all([start(s.dir, keys), start(s.dir, keys)])
    const codes = [a.code, b.code]
    expect(codes.filter(c => c === 3).length).toBe(1)
    const winner = a.code === 3 ? b : a
    expect(winner.port).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(join(s.dir, 'hub.json'), 'utf8')).pid).toBe(winner.child.pid)
    winner.child.stdin.end()
    await exited(winner.child)
    const again = await start(s.dir, keys)
    expect(again.port).toBeGreaterThan(0)
    again.child.stdin.end()
    await exited(again.child)
  })

  test("a wrong key exits with the data message and leaves hub.db as it was", async () => {
    const first = await start(s.dir, { dbKey: newKey(), personKey: newKey() })
    first.child.stdin.end()
    await exited(first.child)
    const size = statSync(join(s.dir, 'hub.db')).size
    const second = await start(s.dir, { dbKey: newKey(), personKey: newKey() })
    expect(second.code).toBe(2)
    expect(second.err.join('')).toContain("The hub's data could not be opened")
    expect(statSync(join(s.dir, 'hub.db')).size).toBe(size)
  })

  test('refuses keys that are not 64 hex characters', async () => {
    const r = await start(s.dir, { dbKey: 'short', personKey: newKey() })
    expect(r.code).toBe(2)
    expect(existsSync(join(s.dir, 'hub.db'))).toBe(false)
  })

  test('logs never contain a body, a token or a key', async () => {
    const keys = { dbKey: newKey(), personKey: newKey() }
    const { child, port } = await start(s.dir, keys)
    const token = JSON.parse(readFileSync(join(s.dir, 'hub.json'), 'utf8')).token as string
    const marker = 'SECRET-MARKER-7731'
    await fetch(`http://127.0.0.1:${port}/v1/mini/prompt`, { method: 'POST', headers: { 'x-hub-ui': keys.personKey, 'content-type': 'application/json' }, body: JSON.stringify({ text: marker }) })
    await fetch(`http://127.0.0.1:${port}/v1/events?q=${marker}`, { headers: { authorization: `Bearer ${token}` } })
    await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: { 'x-hub-ui': 'wrong-key' } })
    child.stdin.end()
    await exited(child)
    const log = readFileSync(join(s.dir, 'logs', 'core.log'), 'utf8')
    expect(log.length).toBeGreaterThan(0)
    for (const secret of [marker, keys.dbKey, keys.personKey, token]) expect(log.includes(secret)).toBe(false)
  })
})

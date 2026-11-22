import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { miniConnector } from '../src/connectors/mini.ts'
import { scratch } from './helpers.ts'

type Handler = (req: IncomingMessage, body: Record<string, unknown>) => unknown

let s: ReturnType<typeof scratch>
let server: Server | null = null
let routes: Record<string, Handler> = {}
const calls: string[] = []

const listen = async (): Promise<number> => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      const key = `${req.method} ${(req.url ?? '').split('?')[0]}`
      calls.push(key)
      if (req.headers.authorization !== 'Bearer fake-token') return void res.writeHead(401).end()
      const handler = routes[key]
      if (!handler) return void res.writeHead(404).end('{}')
      const out = handler(req, raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
    })
  })
  await new Promise<void>(r => server?.listen(0, '127.0.0.1', r))
  return (server?.address() as AddressInfo).port
}

const writeInfo = (port: number) => writeFileSync(join(s.dir, 'runtime.json'), JSON.stringify({ port, token: 'fake-token', pid: process.pid }))

const baseState = (over: Record<string, unknown> = {}) => ({
  running: true,
  config: { activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Mini', avatar: 'clawd', appearance: { skin: 'claude', accent: 'pink' } }] },
  permissions: { screen: { granted: true }, microphone: { granted: false } },
  card: null,
  activity: { phase: 'idle', detail: '', id: null, preview: null },
  ...over,
})

beforeEach(() => {
  s = scratch()
  routes = {}
  calls.length = 0
})
afterEach(async () => {
  await new Promise<void>(r => (server ? server.close(() => r()) : r()))
  server = null
  s.done()
  // Whatever a test did, the hub never touched the bot's consent.
  expect(calls.filter(c => /\/v1\/(trust|permissions)/.test(c))).toEqual([])
})

describe('mini connector', () => {
  test('reports not running when runtime.json is missing or its port is dead', async () => {
    const mini = miniConnector({ botHome: s.dir })
    expect((await mini.refresh()).running).toBe(false)
    writeInfo(1)
    const state = await mini.refresh()
    expect(state.running).toBe(false)
    expect(mini.snapshot().running).toBe(false)
  })

  test('maps named accents to hex and reads the profile', async () => {
    routes['GET /v1/state'] = () => baseState()
    writeInfo(await listen())
    const state = await miniConnector({ botHome: s.dir }).refresh()
    expect(state.running).toBe(true)
    expect(state.profile).toMatchObject({ name: 'Mini', avatar: 'clawd', accent: '#ef5da8' })
    expect(state.permissions).toEqual({ screen: true, microphone: false })
  })

  test('a hex accent is kept and an unknown one falls back to the default', async () => {
    let accent = '#123abc'
    routes['GET /v1/state'] = () => baseState({ config: { activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'X', avatar: 'custom', appearance: { accent } }] } })
    writeInfo(await listen())
    const mini = miniConnector({ botHome: s.dir })
    expect((await mini.refresh()).profile?.accent).toBe('#123abc')
    accent = 'claude'
    expect((await mini.refresh()).profile?.accent).toBe('#d77757')
  })

  test('follows a reply as it grows', async () => {
    let preview: unknown = null
    routes['POST /v1/prompts'] = (_req, body) => {
      expect(body).toEqual({ text: 'Who called?', source: 'hub' })
      return { id: 'turn-1' }
    }
    routes['GET /v1/state'] = () => baseState({ activity: { phase: 'working', id: 'turn-1', preview } })
    writeInfo(await listen())
    const mini = miniConnector({ botHome: s.dir })
    const id = await mini.prompt('Who called?')
    expect(id).toBe('turn-1')
    preview = { text: 'Asha called', isError: false, id: 'turn-1', partial: true }
    await mini.refresh()
    expect(mini.conversation()).toMatchObject([{ id: 'turn-1', text: 'Who called?', reply: 'Asha called', partial: true }])
    preview = { text: 'Asha called at 9:12.', isError: false, id: 'turn-1' }
    await mini.refresh()
    expect(mini.conversation()).toMatchObject([{ id: 'turn-1', reply: 'Asha called at 9:12.', partial: false }])
  })

  test('stopControl calls the computer stop route', async () => {
    let reason = ''
    routes['POST /v1/computer/stop'] = (_req, body) => ((reason = String(body.reason)), {})
    writeInfo(await listen())
    await miniConnector({ botHome: s.dir }).stopControl()
    expect(reason).toBe('Stopped from Mini Hub')
  })

  test('turns new control log entries into mini_action events once', async () => {
    let entries: unknown[] = [{ at: '2026-11-22T10:00:00.000Z', kind: 'start', task: 'open the browser' }]
    routes['GET /v1/state'] = () => baseState()
    routes['GET /v1/computer/log'] = () => ({ entries })
    writeInfo(await listen())
    const emitted: Array<{ title?: string }> = []
    const mini = miniConnector({ botHome: s.dir })
    await mini.syncLog(e => emitted.push(e))
    entries = [...entries, { at: '2026-11-22T10:00:05.000Z', kind: 'act', action: 'click', what: 'the address bar' }]
    await mini.syncLog(e => emitted.push(e))
    await mini.syncLog(e => emitted.push(e))
    expect(emitted.map(e => e.title)).toEqual(['Started computer control: open the browser', 'click the address bar'])
  })

  test('the log mark survives a restart, and entries in the same millisecond are all kept', async () => {
    const at = '2026-11-22T10:00:00.000Z'
    routes['GET /v1/state'] = () => baseState()
    routes['GET /v1/computer/log'] = () => ({
      entries: [
        { at, kind: 'start', task: 'one' },
        { at, kind: 'act', action: 'click', what: 'a' },
        { at: '2026-11-22T10:00:01.000Z', kind: 'end', task: 'one' },
      ],
    })
    writeInfo(await listen())
    let mark = ''
    const store = { get: () => mark, set: (v: string) => void (mark = v) }
    const first: Array<{ title?: string }> = []
    await miniConnector({ botHome: s.dir, mark: store }).syncLog(e => first.push(e))
    expect(first.map(e => e.title)).toEqual(['Started computer control: one', 'click a', 'Finished: one'])
    const second: unknown[] = []
    await miniConnector({ botHome: s.dir, mark: store }).syncLog(e => second.push(e))
    expect(second).toEqual([])
  })

  test('Start says what to do when the bot cannot be started from here', async () => {
    let spawned = 0
    const mini = miniConnector({ botHome: s.dir, spawn: () => void spawned++ })
    await expect(mini.startBot()).rejects.toThrow(/\/mini-bot start/)
    expect(spawned).toBe(0)
    writeFileSync(join(s.dir, 'start-mini.mjs'), '// launcher')
    await mini.startBot()
    expect(spawned).toBe(1)
  })

  test('a turn whose reply never comes is closed when the bot moves on or stops', async () => {
    let preview: unknown = null
    let up = true
    routes['POST /v1/prompts'] = () => ({ id: `turn-${Math.random()}` })
    routes['GET /v1/state'] = () => (up ? baseState({ activity: { phase: 'working', id: 'other', preview } }) : baseState())
    writeInfo(await listen())
    const mini = miniConnector({ botHome: s.dir })
    await mini.prompt('First')
    preview = { text: 'Something else', id: 'other' }
    await mini.refresh()
    expect(mini.conversation()[0]).toMatchObject({ partial: false, isError: true, reply: 'Mini did not finish this reply.' })
    await mini.prompt('Second')
    up = false
    await server?.close()
    server = null
    await mini.refresh()
    expect(mini.conversation()[1]).toMatchObject({ partial: false, isError: true })
  })

  test('a waiting bot card is reported without its options', async () => {
    routes['GET /v1/state'] = () => baseState({ card: { id: 'c1', kind: 'trust-full', text: 'Turn on full access?', options: [{ id: 'yes', label: 'Turn it on' }] } })
    writeInfo(await listen())
    const state = await miniConnector({ botHome: s.dir }).refresh()
    expect(state.card).toEqual({ kind: 'trust-full', text: 'Turn on full access?' })
  })
})

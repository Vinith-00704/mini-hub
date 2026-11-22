import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildServer } from '../src/api/server.ts'
import { createHub, type Hub } from '../src/hub.ts'
import type { MiniLink, MiniState } from '../src/connectors/mini.ts'
import { openStore } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

const PERSON = 'p'.repeat(64)
const AGENT = 'a'.repeat(64)

const fakeMini = (): MiniLink & { prompts: string[]; stops: number } => {
  const prompts: string[] = []
  const self = {
    prompts,
    stops: 0,
    snapshot: (): MiniState => ({ running: true, profile: { name: 'Mini', avatar: 'clawd', accent: '#d77757' }, card: { kind: 'trust-full', text: 'Turn on full access?' } }),
    refresh: async () => self.snapshot(),
    prompt: async (text: string) => (prompts.push(text), 'turn-1'),
    conversation: () => [],
    startBot: async () => {},
    stopBot: async () => {},
    stopControl: async () => void self.stops++,
    syncLog: async () => {},
    onChange: () => () => {},
  }
  return self
}

let s: ReturnType<typeof scratch>
let hub: Hub
let app: FastifyInstance
let mini: ReturnType<typeof fakeMini>
const ran: string[][] = []

beforeEach(async () => {
  s = scratch()
  mini = fakeMini()
  ran.length = 0
  hub = await createHub(openStore(join(s.dir, 'hub.db'), newKey()), {
    mini,
    exec: async (cmd, args) => void ran.push([cmd, ...args]),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  })
  app = await buildServer(hub, { person: PERSON, agent: AGENT }, { uiOrigin: 'http://127.0.0.1:5173' })
})
afterEach(async () => {
  await app.close()
  await hub.close()
  s.done()
})

const asPerson = { 'x-hub-ui': PERSON }
const asAgent = { authorization: `Bearer ${AGENT}` }
const asVoice = { ...asAgent, 'x-hub-origin': 'voice' }

const waitTicket = async (ticket: string, headers: Record<string, string> = asAgent) => {
  for (let i = 0; i < 10; i++) {
    const r = await app.inject({ method: 'GET', url: `/v1/tickets/${ticket}?wait=200`, headers })
    if (r.json().done) return r.json()
  }
  return { done: false }
}

describe('who may call', () => {
  test('no key is unauthorized, and health needs none', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/state' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/v1/state', headers: { 'x-hub-ui': 'wrong' } })).statusCode).toBe(401)
    const health = await app.inject({ method: 'GET', url: '/v1/health' })
    expect(health.statusCode).toBe(200)
    expect(Object.keys(health.json()).sort()).toEqual(['ok', 'version'])
  })

  test('1 the agent cannot reach person routes', async () => {
    const tries = [
      ['PUT', '/v1/grants/pc/pc.power', { mini: 'on' }],
      ['POST', '/v1/approvals/x', { decision: 'yes' }],
      ['POST', '/v1/resume', {}],
      ['PATCH', '/v1/settings', { theme: 'light' }],
      ['DELETE', '/v1/events', { ids: [1] }],
      ['POST', '/v1/mini/prompt', { text: 'hi' }],
      ['GET', '/v1/approvals', undefined],
      ['GET', '/v1/audit/check', undefined],
      ['PATCH', '/v1/devices/pc', { name: 'x' }],
    ] as const
    for (const [method, url, payload] of tries) {
      const r = await app.inject({ method, url, headers: asAgent, ...(payload ? { payload } : {}) })
      expect([url, r.statusCode, r.json().code]).toEqual([url, 403, 'forbidden'])
    }
  })
})

describe('actions', () => {
  test('2 an important action never runs without an approval, with the grant off or on', async () => {
    const off = await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'shut_down', args: {} } })
    expect(off.statusCode).toBe(403)
    expect(off.json()).toMatchObject({ code: 'not-allowed', scope: 'pc.power' })
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'on' } })
    const on = await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'shut_down', args: {} } })
    expect(on.statusCode).toBe(202)
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${on.json().ticket}?wait=0`, headers: asAgent })).json()).toEqual({ done: false, waitingFor: 'approval' })
    expect(ran).toEqual([])
    const [approval] = (await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals
    expect(approval.summary).toBe('Shut down this PC')
    await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asPerson, payload: { decision: 'no' } })
    expect(await waitTicket(on.json().ticket)).toMatchObject({ done: true, ok: false, code: 'not-allowed' })
    expect(ran).toEqual([])
  })

  test('yes runs the action once', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'on' } })
    const on = await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'restart', args: {} } })
    const [approval] = (await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals
    await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asPerson, payload: { decision: 'yes' } })
    expect(await waitTicket(on.json().ticket)).toMatchObject({ done: true, ok: true })
    expect(ran).toEqual([['shutdown', '/r', '/t', '0']])
    const again = await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asPerson, payload: { decision: 'yes' } })
    expect(again.json().code).toBe('decided')
    expect(ran.length).toBe(1)
  })

  test('3 an approval cannot be answered by the agent or without a key', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'on' } })
    await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'sleep', args: {} } })
    const [approval] = (await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals
    expect((await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asAgent, payload: { decision: 'yes' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asVoice, payload: { decision: 'yes' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, payload: { decision: 'yes' } })).statusCode).toBe(401)
    expect(ran).toEqual([])
  })

  test('the person runs an action directly', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/actions', headers: asPerson, payload: { connector: 'pc', name: 'lock', args: {} } })
    expect(await waitTicket(r.json().ticket, asPerson)).toMatchObject({ done: true, ok: true })
    expect(ran).toEqual([['rundll32.exe', 'user32.dll,LockWorkStation']])
  })

  test('a voice turn never creates an approval', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'on', voiceSafe: true } })
    const r = await app.inject({ method: 'POST', url: '/v1/actions', headers: asVoice, payload: { connector: 'pc', name: 'shut_down', args: {} } })
    expect(r.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals).toEqual([])
  })
})

describe('stop', () => {
  test('4 after Stop every agent route but health and stop is 423', async () => {
    await app.inject({ method: 'POST', url: '/v1/stop', headers: asPerson })
    expect(mini.stops).toBe(1)
    for (const url of ['/v1/state', '/v1/events', '/v1/actions', '/v1/grants', '/v1/audit']) {
      const r = await app.inject({ method: 'GET', url, headers: asAgent })
      expect([url, r.statusCode, r.json().code]).toEqual([url, 423, 'stopped'])
    }
    expect((await app.inject({ method: 'POST', url: '/v1/stop', headers: asAgent })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/health', headers: asAgent })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/state', headers: asPerson })).json().stopped).toBe(true)
    await app.inject({ method: 'POST', url: '/v1/resume', headers: asPerson })
    expect((await app.inject({ method: 'GET', url: '/v1/state', headers: asAgent })).statusCode).toBe(200)
  })

  test('Stop answers every waiting approval no', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'on' } })
    const r = await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'sleep', args: {} } })
    await app.inject({ method: 'POST', url: '/v1/stop', headers: asPerson })
    // Mini itself can no longer poll once stopped; the owner can still see how it ended.
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${r.json().ticket}`, headers: asAgent })).statusCode).toBe(423)
    expect(await waitTicket(r.json().ticket, asPerson)).toMatchObject({ done: true, ok: false })
    expect(ran).toEqual([])
  })
})

describe('events and audit', () => {
  test('an ask grant turns an agent read into an approval, and yes returns the rows', async () => {
    hub.devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
    hub.grants.set('phone-a', 'phone.messages.read', { collect: true, mini: 'ask' })
    hub.events.add('phone-a', 1, { type: 'sms', occurredAt: 5, who: 'Asha', body: 'see you at 8' })
    const r = await app.inject({ method: 'GET', url: '/v1/events?type=sms', headers: asAgent })
    expect(r.statusCode).toBe(202)
    const [approval] = (await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals
    expect(approval.summary).toContain('Messages')
    await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asPerson, payload: { decision: 'yes' } })
    const done = await waitTicket(r.json().ticket)
    expect(done.ok).toBe(true)
    expect(done.data.items.map((e: { body: string }) => e.body)).toEqual(['see you at 8'])
  })

  test('the agent is told which switch is off', async () => {
    hub.devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
    hub.grants.set('phone-a', 'phone.calls.read', { collect: true })
    hub.grants.set('phone-a', 'phone.messages.read', { collect: true, mini: 'on' })
    // Only switched-off kinds: refused, naming the switch.
    const only = await app.inject({ method: 'GET', url: '/v1/events?type=call', headers: asAgent })
    expect(only.statusCode).toBe(403)
    expect(only.json()).toMatchObject({ code: 'not-allowed', scope: 'phone.calls.read' })
    // Some allowed, some not: the allowed rows, and which switches are off.
    const mixed = await app.inject({ method: 'GET', url: '/v1/events?type=call&type=sms', headers: asAgent })
    expect(mixed.statusCode).toBe(200)
    expect(mixed.json()).toMatchObject({ items: [], notAllowed: [{ scope: 'phone.calls.read', label: 'Call history' }] })
  })

  test('7 the audit chain check reports a hand-edited row', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'ask' } })
    await app.inject({ method: 'GET', url: '/v1/state', headers: asAgent })
    expect((await app.inject({ method: 'GET', url: '/v1/audit/check', headers: asPerson })).json()).toEqual({ ok: true })
    hub.db.prepare("UPDATE audit SET outcome = 'refused' WHERE id = 1").run()
    expect((await app.inject({ method: 'GET', url: '/v1/audit/check', headers: asPerson })).json()).toEqual({ ok: false, brokenAt: 1 })
  })

  test('a permission change is logged with the device and the permission', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'ask' } })
    const [row] = hub.audit.list({ action: 'grant' })
    expect(row).toMatchObject({ caller: 'person', target: 'pc', scope: 'pc.power', outcome: 'done' })
  })

  test('the agent sees only its own audit rows', async () => {
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'ask' } })
    await app.inject({ method: 'GET', url: '/v1/state', headers: asAgent })
    const rows = (await app.inject({ method: 'GET', url: '/v1/audit', headers: asAgent })).json().items
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r: { caller: string }) => r.caller === 'agent')).toBe(true)
  })
})

describe('review fixes', () => {
  test('the agent sees devices without their state or info unless allowed', async () => {
    hub.devices.upsert({ id: 'mail-1', connectorId: 'mail', kind: 'mail-account', name: 'Mail', info: { address: 'me@example.com' }, state: { unread: 4 } })
    const list = (await app.inject({ method: 'GET', url: '/v1/devices', headers: asAgent })).json().items
    const pc = list.find((d: { id: string }) => d.id === 'pc')
    expect(pc).toEqual({ id: 'pc', name: 'This PC', kind: 'pc' })
    expect(JSON.stringify(list)).not.toContain('example.com')
    const one = (await app.inject({ method: 'GET', url: '/v1/devices/mail-1', headers: asAgent })).json()
    expect(one).toEqual({ id: 'mail-1', name: 'Mail', kind: 'mail-account' })
    await app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.status.read', headers: asPerson, payload: { mini: 'on' } })
    const allowed = (await app.inject({ method: 'GET', url: '/v1/devices/pc', headers: asAgent })).json()
    expect(allowed.state.memoryFreeMb).toBeGreaterThan(0)
    expect(allowed.info).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/v1/devices', headers: asPerson })).json().items.find((d: { id: string }) => d.id === 'mail-1').info).toEqual({ address: 'me@example.com' })
  })

  test('a refused agent action is audited, after Stop and for an unknown action', async () => {
    await app.inject({ method: 'POST', url: '/v1/stop', headers: asPerson })
    expect((await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'shut_down' } })).statusCode).toBe(423)
    await app.inject({ method: 'POST', url: '/v1/resume', headers: asPerson })
    expect((await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', name: 'no_such' } })).statusCode).toBe(404)
    const rows = hub.audit.list({ agentOnly: true })
    expect(rows.filter(r => r.action === 'act').map(r => r.outcome)).toEqual(['failed', 'refused'])
  })

  test('an agent read is logged with its scope and count, and a read of only switched-off kinds is refused', async () => {
    hub.devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
    hub.grants.set('phone-a', 'phone.messages.read', { collect: true, mini: 'on' })
    hub.grants.set('phone-a', 'phone.calls.read', { collect: true })
    hub.events.add('phone-a', 1, { type: 'sms', occurredAt: 5, who: 'Asha', body: 'hi' })
    hub.events.add('phone-a', 2, { type: 'sms', occurredAt: 6, who: 'Ravi', body: 'yo' })
    const ok = await app.inject({ method: 'GET', url: '/v1/events?type=sms', headers: asAgent })
    expect(ok.json().items.length).toBe(2)
    const off = await app.inject({ method: 'GET', url: '/v1/events?type=call', headers: asAgent })
    expect(off.statusCode).toBe(403)
    expect(off.json()).toMatchObject({ code: 'not-allowed', scope: 'phone.calls.read' })
    const reads = hub.audit.list({ agentOnly: true, action: 'read' }).filter(r => r.target === 'events')
    expect(reads.map(r => [r.outcome, r.data.count])).toEqual([
      ['refused', 0],
      ['done', 2],
    ])
    expect(reads[1].data.ids).toHaveLength(2)
    expect(reads[1].data.scopes).toEqual(['phone.messages.read'])
    expect(JSON.stringify(reads)).not.toContain('Asha')
  })

  test('an approved read is logged when its rows are handed over', async () => {
    hub.devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
    hub.grants.set('phone-a', 'phone.messages.read', { collect: true, mini: 'ask' })
    hub.events.add('phone-a', 1, { type: 'sms', occurredAt: 5, who: 'Asha', body: 'hi' })
    const r = await app.inject({ method: 'GET', url: '/v1/events?type=sms', headers: asAgent })
    const [approval] = (await app.inject({ method: 'GET', url: '/v1/approvals', headers: asPerson })).json().approvals
    await app.inject({ method: 'POST', url: `/v1/approvals/${approval.id}`, headers: asPerson, payload: { decision: 'yes' } })
    await waitTicket(r.json().ticket)
    const reads = hub.audit.list({ agentOnly: true, action: 'read' }).filter(x => x.target === 'events')
    expect(reads.map(x => x.outcome)).toEqual(['done', 'waiting'])
    expect(reads[0].data.count).toBe(1)
  })

  test("the agent cannot borrow another device's grant for an action", async () => {
    hub.devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
    hub.grants.set('phone-a', 'pc.power', { mini: 'on' })
    const r = await app.inject({ method: 'POST', url: '/v1/actions', headers: asAgent, payload: { connector: 'pc', device: 'phone-a', name: 'lock' } })
    expect(r.statusCode).toBe(400)
    expect(ran).toEqual([])
  })

  test('a bad page size is a bad request, not a crash', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/events?limit=abc', headers: asPerson })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/v1/audit?limit=abc', headers: asPerson })).statusCode).toBe(400)
  })
})

describe('mini', () => {
  test('the dashboard sees a bot card without any way to answer it', async () => {
    const r = (await app.inject({ method: 'GET', url: '/v1/mini', headers: asPerson })).json()
    expect(r.card).toEqual({ kind: 'trust-full', text: 'Turn on full access?' })
    expect(JSON.stringify(r)).not.toContain('options')
  })

  test('a prompt from the dashboard reaches Mini', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/mini/prompt', headers: asPerson, payload: { text: 'Who called?' } })
    expect(r.json()).toEqual({ id: 'turn-1' })
    expect(mini.prompts).toEqual(['Who called?'])
  })
})

describe('web', () => {
  test('a request from another origin gets no CORS header', async () => {
    const good = await app.inject({ method: 'OPTIONS', url: '/v1/state', headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'GET' } })
    expect(good.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    const bad = await app.inject({ method: 'OPTIONS', url: '/v1/state', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' } })
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('live sockets without the person key are closed', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const closed = await new Promise<number>(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/live`)
      ws.on('open', () => ws.send(JSON.stringify({ key: 'wrong' })))
      ws.on('close', code => resolve(code))
    })
    expect(closed).toBe(4401)
    const topics = await new Promise<string>(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/live`)
      ws.on('open', () => {
        ws.send(JSON.stringify({ key: PERSON }))
        setTimeout(() => void app.inject({ method: 'PUT', url: '/v1/grants/pc/pc.power', headers: asPerson, payload: { mini: 'ask' } }), 50)
      })
      ws.on('message', m => {
        resolve(JSON.parse(String(m)).topic)
        ws.close()
      })
    })
    expect(topics).toBe('grants')
  })
})

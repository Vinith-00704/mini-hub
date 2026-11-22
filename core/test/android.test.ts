import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { LinkFrame } from '@minihub/protocol/link'
import { buildServer } from '../src/api/server.ts'
import { createHub, type Hub } from '../src/hub.ts'
import type { MiniLink } from '../src/connectors/mini.ts'
import { openStore } from '../src/store/db.ts'
import { fakeMini, newKey, quiet, scratch, until } from './helpers.ts'
import { testPhone, type TestPhone } from './phone.ts'

const PERSON = 'p'.repeat(64)
const AGENT = 'a'.repeat(64)
const asPerson = { 'x-hub-ui': PERSON }
const asAgent = { authorization: `Bearer ${AGENT}` }

let s: ReturnType<typeof scratch>
let hub: Hub
let app: FastifyInstance
let mini: ReturnType<typeof fakeMini>
const tokens: Record<string, string> = {}

beforeEach(async () => {
  s = scratch()
  mini = fakeMini()
  hub = await createHub(openStore(join(s.dir, 'hub.db'), newKey()), {
    mini: mini as unknown as MiniLink,
    log: quiet,
    link: { port: 0, hosts: ['127.0.0.1'], announce: false, name: 'Test PC' },
    phones: { commandMs: 300, maxWaitMs: 900 },
  })
  app = await buildServer(hub, { person: PERSON, agent: AGENT }, { uiOrigin: 'http://127.0.0.1:5173' })
  for (const id of ['phone-a', 'phone-b']) {
    hub.devices.upsert({ id, connectorId: 'android', kind: 'phone', name: `Test ${id}` })
    tokens[id] = hub.tokens.issue(id)
  }
  await hub.link.open()
})
afterEach(async () => {
  await app.close()
  await hub.close()
  s.done()
})

/** A phone that says hello and has been welcomed. */
const linked = async (id = 'phone-a', lastSeq = 0): Promise<{ ph: TestPhone; welcome: Extract<LinkFrame, { t: 'welcome' }> }> => {
  const ph = await testPhone(hub.link.port)
  ph.send({ t: 'hello', v: 1, deviceId: id, token: tokens[id], appVersion: '0.2.0', lastSeq, time: Date.now() })
  return { ph, welcome: await ph.next('welcome') }
}

const sms = (seq: number) => ({ seq, type: 'sms', occurredAt: 1_000 + seq, who: 'Asha Example', whoKey: '+15550123', app: 'sms', title: 'Asha Example', body: `Message ${seq}` })
const setGrant = (target: string, scope: string, patch: object) => app.inject({ method: 'PUT', url: `/v1/grants/${target}/${scope}`, headers: asPerson, payload: patch })
const count = (id = 'phone-a') => (hub.db.prepare('SELECT COUNT(*) AS n FROM events WHERE device_id = ?').get(id) as { n: number }).n

/** Sends events from..to in batches of 200, each waiting for its ack. */
const sendRange = async (ph: TestPhone, from: number, to: number) => {
  for (let at = from; at <= to; at += 200) {
    const end = Math.min(at + 199, to)
    const before = ph.frames.length
    ph.send({ t: 'events', from: at, items: Array.from({ length: end - at + 1 }, (_, i) => sms(at + i)) })
    const ack = await ph.next('ack', before)
    expect(ack.seq).toBe(end)
  }
}

const runStatus = async (device: string, headers: Record<string, string> = asPerson) => {
  const r = await app.inject({ method: 'POST', url: '/v1/actions', headers, payload: { connector: 'android', device, name: 'status', args: {} } })
  return r
}
const ticket = async (id: string, headers: Record<string, string> = asPerson) => {
  for (let i = 0; i < 40; i++) {
    const t = (await app.inject({ method: 'GET', url: `/v1/tickets/${id}?wait=200`, headers })).json()
    if (t.done) return t
  }
  throw new Error('ticket never finished')
}

describe('handing over the record', () => {
  beforeEach(async () => void (await setGrant('phone-a', 'phone.messages.read', { collect: true })))

  test('the welcome says how far the hub has got and what to collect', async () => {
    const { welcome } = await linked()
    expect(welcome).toMatchObject({ t: 'welcome', v: 1, ackSeq: 0 })
    expect(welcome.collect['phone.messages.read']).toBe(true)
    expect(welcome.collect['phone.calls.read']).toBe(false)
  })

  test('a resent batch is stored once', async () => {
    const { ph } = await linked()
    await sendRange(ph, 1, 3)
    ph.close()
    const again = await linked('phone-a', 3)
    expect(again.welcome.ackSeq).toBe(3)
    const before = again.ph.frames.length
    again.ph.send({ t: 'events', from: 1, items: [sms(1), sms(2), sms(3)] })
    expect((await again.ph.next('ack', before)).seq).toBe(3)
    expect(count()).toBe(3)
  })

  test('an out-of-order batch is answered with the hub’s real position', async () => {
    const { ph } = await linked()
    await sendRange(ph, 1, 5)
    const before = ph.frames.length
    ph.send({ t: 'events', from: 9, items: [sms(9)] })
    expect((await ph.next('ack', before)).seq).toBe(5)
    expect(count()).toBe(5)
  })

  test('10,000 events with the connection dropped midway end as exactly 10,000, in order', async () => {
    const first = await linked()
    await sendRange(first.ph, 1, 5000)
    // The plug is pulled while a batch is in flight.
    first.ph.send({ t: 'events', from: 5001, items: Array.from({ length: 200 }, (_, i) => sms(5001 + i)) })
    first.ph.ws.terminate()
    await until(() => !hub.link.connected('phone-a'))

    const second = await linked('phone-a', 10_000)
    const resume = second.welcome.ackSeq + 1
    expect([5001, 5201]).toContain(resume)
    await sendRange(second.ph, resume, 10_000)
    expect(count()).toBe(10_000)
    const seqs = (hub.db.prepare('SELECT seq FROM events WHERE device_id = ? ORDER BY id').all('phone-a') as Array<{ seq: number }>).map(r => r.seq)
    expect(seqs).toEqual(Array.from({ length: 10_000 }, (_, i) => i + 1))
  }, 60_000)

  test('a gap is recorded and the hub moves past it', async () => {
    const { ph } = await linked()
    await sendRange(ph, 1, 2)
    const before = ph.frames.length
    ph.send({ t: 'gap', from: 3, to: 4, reason: 'deleted on the phone before it was sent' })
    expect((await ph.next('ack', before)).seq).toBe(4)
    const row = hub.db.prepare('SELECT last_seq, gaps_json FROM sync_state WHERE device_id = ?').get('phone-a') as { last_seq: number; gaps_json: string }
    expect(row.last_seq).toBe(4)
    expect(JSON.parse(row.gaps_json)).toEqual([expect.objectContaining({ from: 3, to: 4 })])
    await sendRange(ph, 5, 5)
  })

  test('with the hub’s collect switch off, nothing of that kind is stored', async () => {
    await setGrant('phone-a', 'phone.messages.read', { collect: false })
    const { ph } = await linked()
    await sendRange(ph, 1, 3)
    expect(count()).toBe(0)
  })
})

describe('switches and state', () => {
  test('a collect change on the dashboard reaches the phone as settings with a new rev', async () => {
    const { ph, welcome } = await linked()
    const before = ph.frames.length
    await setGrant('phone-a', 'phone.usage.read', { collect: true })
    const settings = await ph.next('settings', before)
    expect(settings.rev).toBeGreaterThan(welcome.settingsRev)
    expect(settings.collect['phone.usage.read']).toBe(true)
  })

  test('a change for another phone is not sent to this one', async () => {
    const { ph } = await linked('phone-a')
    const before = ph.frames.length
    await setGrant('phone-b', 'phone.usage.read', { collect: true })
    await new Promise(r => setTimeout(r, 100))
    expect(ph.frames.slice(before).filter(f => f.t === 'settings')).toHaveLength(0)
  })

  test('the state frame updates the device and tells the dashboard', async () => {
    const topics: string[] = []
    hub.live.on('topic', t => void topics.push(t))
    const { ph } = await linked()
    ph.send({ t: 'state', battery: 75, charging: true, network: 'wifi', brain: 'ok', controlling: false, stopped: false, lists: { mini: { 'phone.usage.read': 'off' }, pc: { 'phone.usage.read': 'ask' } } })
    await until(() => hub.devices.get('phone-a')?.state.battery === 75)
    expect(hub.devices.get('phone-a')?.state).toMatchObject({ online: true, charging: true, network: 'wifi', brain: 'ok', lists: { pc: { 'phone.usage.read': 'ask' } } })
    expect(topics).toContain('devices')
    ph.close()
    await until(() => hub.devices.get('phone-a')?.state.online === false)
    expect(hub.devices.get('phone-a')?.lastSeenAt).toBeGreaterThan(0)
  })

  test('the phone’s own collect switches, reported in its state, become the hub’s copy', async () => {
    const { ph } = await linked()
    const before = ph.frames.length
    ph.send({ t: 'state', brain: 'ok', controlling: false, stopped: false, collect: { 'phone.calls.read': true, 'phone.usage.read': false }, lists: { mini: {}, pc: {} } })
    await until(() => hub.grants.get('phone-a', 'phone.calls.read').collect)
    expect(hub.devices.get('phone-a')?.state).not.toHaveProperty('collect')
    // The hub does not echo the phone's own change back as a settings change.
    await new Promise(r => setTimeout(r, 100))
    expect(ph.frames.slice(before).filter(f => f.t === 'settings')).toHaveLength(0)
    // Events of that kind are now kept.
    await sendRange(ph, 1, 1)
    expect(hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'call'").get()).toEqual({ n: 0 })
    ph.send({ t: 'events', from: 2, items: [{ seq: 2, type: 'call', occurredAt: 5, who: 'Asha Example' }] })
    await until(() => (hub.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'call'").get() as { n: number }).n === 1)
  })

  test('closing the link marks linked phones as away', async () => {
    const { ph } = await linked()
    ph.send({ t: 'state', battery: 70, brain: 'ok', controlling: false, stopped: false, lists: { mini: {}, pc: {} } })
    await until(() => hub.devices.get('phone-a')?.state.battery === 70)
    await hub.link.close()
    expect(hub.devices.get('phone-a')?.state.online).toBe(false)
  })

  test('after a restart no phone is shown as online until it links again', async () => {
    hub.devices.setState('phone-a', { online: true })
    const again = await createHub(hub.db, { mini: mini as unknown as MiniLink, log: quiet, link: { port: 0, hosts: ['127.0.0.1'], announce: false } })
    expect(again.devices.get('phone-a')?.state.online).toBe(false)
    await again.link.close()
  })

  test('the phone’s own lists are in the grants view', async () => {
    const { ph } = await linked()
    ph.send({ t: 'state', brain: 'ok', controlling: false, stopped: false, lists: { mini: { 'phone.usage.read': 'on' }, pc: { 'phone.usage.read': 'ask' } } })
    await until(() => hub.devices.get('phone-a')?.state.brain === 'ok')
    const rows = (await app.inject({ method: 'GET', url: '/v1/grants', headers: asPerson })).json().items as Array<{ target: string; scope: string; phone?: { mini: string; pc: string } }>
    expect(rows.find(r => r.target === 'phone-a' && r.scope === 'phone.usage.read')?.phone).toEqual({ mini: 'on', pc: 'ask' })
  })
})

describe('stop', () => {
  test('Stop Mini sends stop to every linked phone and nothing else is needed for it', async () => {
    const a = await linked('phone-a')
    const b = await linked('phone-b')
    expect((await app.inject({ method: 'POST', url: '/v1/stop', headers: asPerson })).statusCode).toBe(200)
    await a.ph.next('stop')
    await b.ph.next('stop')
  })

  test('Stop answers a command still waiting on the phone with stopped', async () => {
    const { ph } = await linked()
    ph.ws.on('message', d => {
      const f = JSON.parse(String(d)) as LinkFrame
      if (f.t === 'cmd') ph.send({ t: 'waiting', id: f.id, until: Date.now() + 60_000 })
    })
    const r = await runStatus('phone-a')
    await ph.next('cmd')
    await app.inject({ method: 'POST', url: '/v1/stop', headers: asPerson })
    expect(await ticket(r.json().ticket)).toMatchObject({ ok: false, code: 'stopped' })
  })

  test('Stop on my PC too, from the phone, stops the hub', async () => {
    const { ph } = await linked()
    ph.send({ t: 'stop-request' })
    await until(() => hub.stop.stopped)
    expect(mini.stops).toBe(1)
    const row = hub.db.prepare("SELECT caller FROM audit WHERE action = 'stop'").get() as { caller: string }
    expect(row.caller).toBe('device')
  })
})

describe('the status command', () => {
  test('status goes to the phone and its answer comes back', async () => {
    const { ph } = await linked()
    ph.ws.on('message', d => {
      const f = JSON.parse(String(d)) as LinkFrame
      if (f.t === 'cmd') ph.send({ t: 'result', id: f.id, ok: true, data: { battery: 64, charging: false, network: 'wifi' } })
    })
    const r = await runStatus('phone-a')
    expect(r.statusCode).toBe(202)
    expect(await ticket(r.json().ticket)).toMatchObject({ done: true, ok: true, data: { battery: 64 } })
    const cmd = ph.frames.find(f => f.t === 'cmd') as Extract<LinkFrame, { t: 'cmd' }>
    expect(cmd).toMatchObject({ name: 'status', origin: 'person', approved: true })
  })

  test('no answer in time fails, and waiting extends the deadline to at most the limit', async () => {
    const silent = await linked()
    const r = await runStatus('phone-a')
    expect(await ticket(r.json().ticket)).toMatchObject({ ok: false, code: 'timeout' })
    silent.ph.close()

    const { ph } = await linked()
    ph.ws.on('message', d => {
      const f = JSON.parse(String(d)) as LinkFrame
      if (f.t === 'cmd') ph.send({ t: 'waiting', id: f.id, until: Date.now() + 60_000 })
    })
    const started = Date.now()
    const w = await runStatus('phone-a')
    expect(await ticket(w.json().ticket)).toMatchObject({ ok: false, code: 'timeout' })
    const took = Date.now() - started
    expect(took).toBeGreaterThan(600)
    expect(took).toBeLessThan(3000)
  })

  test('a phone that is not linked is said to be away', async () => {
    const r = await runStatus('phone-a')
    expect(await ticket(r.json().ticket)).toMatchObject({ ok: false, code: 'offline' })
  })

  test('a not-allowed answer from the phone reaches the agent with the scope', async () => {
    await setGrant('phone-a', 'phone.usage.read', { mini: 'on' })
    const { ph } = await linked()
    ph.ws.on('message', d => {
      const f = JSON.parse(String(d)) as LinkFrame
      if (f.t === 'cmd') ph.send({ t: 'result', id: f.id, ok: false, error: 'From my PC is off for battery and app use.', code: 'not-allowed' })
    })
    const r = await runStatus('phone-a', asAgent)
    expect(r.statusCode).toBe(202)
    const t = await ticket(r.json().ticket, asAgent)
    expect(t).toMatchObject({ ok: false, code: 'not-allowed', scope: 'phone.usage.read' })
    expect(t.error).toContain('From my PC')
    const cmd = ph.frames.find(f => f.t === 'cmd') as Extract<LinkFrame, { t: 'cmd' }>
    expect(cmd).toMatchObject({ origin: 'agent', approved: false })
  })

  test('grants are per device: turning usage on for one phone does not open another', async () => {
    await setGrant('phone-a', 'phone.usage.read', { mini: 'on' })
    const b = await runStatus('phone-b', asAgent)
    expect(b.statusCode).toBe(403)
    expect(b.json()).toMatchObject({ code: 'not-allowed', scope: 'phone.usage.read' })
    const a = await runStatus('phone-a', asAgent)
    expect(a.statusCode).toBe(202)
  })
})

describe('removing a phone', () => {
  test('removing a phone revokes its token, closes its link, and can delete what it sent', async () => {
    await setGrant('phone-a', 'phone.messages.read', { collect: true })
    const { ph } = await linked()
    await sendRange(ph, 1, 3)
    const r = await app.inject({ method: 'DELETE', url: '/v1/devices/phone-a', headers: asPerson, payload: { deleteEvents: true } })
    expect(r.statusCode).toBe(200)
    await ph.until(() => ph.closed)
    expect(hub.tokens.check('phone-a', tokens['phone-a']!)).toBe(false)
    expect(hub.devices.get('phone-a')).toBeUndefined()
    expect(count()).toBe(0)
    expect((await app.inject({ method: 'DELETE', url: '/v1/devices/phone-b', headers: asAgent })).statusCode).toBe(403)
  })

  test('removing a phone while it is sending does not bring the hub down, and nothing more is stored', async () => {
    await setGrant('phone-a', 'phone.messages.read', { collect: true })
    const { ph } = await linked()
    await sendRange(ph, 1, 2)
    hub.removeDevice('phone-a', false)
    ph.send({ t: 'events', from: 3, items: [sms(3)] })
    ph.send({ t: 'state', brain: 'ok', controlling: false, stopped: false, lists: { mini: {}, pc: {} } })
    await ph.until(() => ph.closed)
    await new Promise(r => setTimeout(r, 100))
    expect(count()).toBe(2)
    expect(hub.devices.get('phone-a')).toBeUndefined()
  })

  test('removing the last phone closes the link', async () => {
    for (const id of ['phone-a', 'phone-b']) await app.inject({ method: 'DELETE', url: `/v1/devices/${id}`, headers: asPerson, payload: {} })
    await until(() => !hub.link.isOpen, 3000)
  })

  test('the PC itself cannot be removed', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/v1/devices/pc', headers: asPerson, payload: {} })).statusCode).toBe(400)
  })
})

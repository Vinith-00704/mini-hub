import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SCOPES, type ScopeId } from '@minihub/protocol'
import { pairingCommit, pairingWords, parsePairingLink } from '@minihub/protocol/link'
import { buildServer } from '../src/api/server.ts'
import { createHub, type Hub } from '../src/hub.ts'
import type { MiniLink } from '../src/connectors/mini.ts'
import { openStore } from '../src/store/db.ts'
import { fakeMini, newKey, quiet, scratch, until } from './helpers.ts'
import { testPhone } from './phone.ts'

const PERSON = 'p'.repeat(64)
const AGENT = 'a'.repeat(64)
const asPerson = { 'x-hub-ui': PERSON }
const asAgent = { authorization: `Bearer ${AGENT}` }

let s: ReturnType<typeof scratch>
let hub: Hub
let app: FastifyInstance
let clock = 5_000_000

beforeEach(async () => {
  s = scratch()
  clock = 5_000_000
  hub = await createHub(openStore(join(s.dir, 'hub.db'), newKey()), {
    mini: fakeMini() as unknown as MiniLink,
    log: quiet,
    now: () => clock,
    link: { port: 0, hosts: ['127.0.0.1'], announce: false, name: 'Test PC' },
  })
  app = await buildServer(hub, { person: PERSON, agent: AGENT }, { uiOrigin: 'http://127.0.0.1:5173' })
})
afterEach(async () => {
  await app.close()
  await hub.close()
  s.done()
})

const NONCE = 'bm9uY2Utbm90LXJlYWwtMDE'
const pair = (code: string, nonce = NONCE) => ({ t: 'pair', v: 1, code, commit: pairingCommit(nonce), deviceName: 'Test phone', model: 'Example Phone 1', appVersion: '0.2.0' })
const start = async () => {
  const r = await app.inject({ method: 'POST', url: '/v1/pairing', headers: asPerson })
  expect(r.statusCode).toBe(200)
  return r.json() as { qr: string; address: string; code: string; expiresAt: number }
}
const current = async () => (await app.inject({ method: 'GET', url: '/v1/pairing', headers: asPerson })).json()
const phone = () => testPhone(hub.link.port)
/** A phone that pairs properly: commits, gets the hub's value, reveals. */
const toCheck = async (code: string, nonce = NONCE) => {
  const ph = await phone()
  ph.send(pair(code, nonce))
  await ph.next('pair-nonce')
  ph.send({ t: 'pair-reveal', nonce })
  await until(async () => (await current()).state === 'check')
  return ph
}

describe('pairing', () => {
  test('starting a pairing opens the link and gives a code the phone can read', async () => {
    expect(hub.link.isOpen).toBe(false)
    const p = await start()
    expect(hub.link.isOpen).toBe(true)
    expect(parsePairingLink(p.qr)).toMatchObject({ host: '127.0.0.1', port: hub.link.port, fp: hub.link.fp, code: p.code, name: 'Test PC' })
    expect(p.address).toBe(`127.0.0.1:${hub.link.port}`)
    expect(Buffer.from(p.code, 'base64url').length).toBe(16)
    expect(p.expiresAt).toBe(clock + 5 * 60_000)
  })

  test('the words on the hub are the words the phone computes', async () => {
    const p = await start()
    const ph = await toCheck(p.code)
    const hubNonce = (await ph.next('pair-nonce')).nonce
    const view = await current()
    expect(view.words).toEqual(pairingWords(hub.link.fp, p.code, NONCE, hubNonce))
    expect(view.deviceName).toBe('Test phone')
    expect(JSON.stringify(view)).not.toContain(p.code)
  })

  test('the device gets its token only after the owner presses Pair, and the hub keeps only its hash', async () => {
    const p = await start()
    const ph = await toCheck(p.code)
    await new Promise(r => setTimeout(r, 50))
    expect(ph.frames.filter(f => f.t === 'paired')).toHaveLength(0)

    const ok = await app.inject({ method: 'POST', url: '/v1/pairing/confirm', headers: asPerson })
    expect(ok.statusCode).toBe(200)
    const id = ok.json().deviceId as string
    const paired = await ph.next('paired')
    expect(paired).toMatchObject({ deviceId: id, hubName: 'Test PC' })
    expect(hub.tokens.check(id, paired.token)).toBe(true)
    const row = hub.db.prepare('SELECT token_hash FROM devices WHERE id = ?').get(id) as { token_hash: string }
    expect(row.token_hash).not.toBe(paired.token)
    expect(hub.devices.get(id)).toMatchObject({ connectorId: 'android', kind: 'phone', name: 'Test phone', info: { model: 'Example Phone 1', appVersion: '0.2.0' } })
    expect(await current()).toMatchObject({ state: 'done', deviceId: id })
    expect(hub.link.isOpen).toBe(true)
  })

  test('a new phone starts with every switch off', async () => {
    const p = await start()
    await toCheck(p.code)
    const id = (await app.inject({ method: 'POST', url: '/v1/pairing/confirm', headers: asPerson })).json().deviceId as string
    const phoneScopes = (Object.keys(SCOPES) as ScopeId[]).filter(k => SCOPES[k].connector === 'android')
    expect(phoneScopes.length).toBeGreaterThan(5)
    for (const scope of phoneScopes) expect(hub.grants.get(id, scope)).toMatchObject({ collect: false, mini: 'off' })
  })

  test('a pairing code works once and only for five minutes', async () => {
    const p = await start()
    await toCheck(p.code)
    const second = await phone()
    second.send(pair(p.code, 'YW5vdGhlci1waG9uZS1ub25jZQ'))
    await second.until(() => second.closed)
    expect(second.frames[0]).toMatchObject({ t: 'refused', reason: 'This pairing code was already used.' })

    const q = await start()
    const late = await phone()
    clock += 5 * 60_000 + 1
    late.send(pair(q.code))
    await late.until(() => late.closed)
    expect(late.frames[0]).toMatchObject({ t: 'refused', reason: 'This pairing code has expired. Make a new one on the dashboard.' })
    expect((await current()).state).toBe('expired')

    clock -= 5 * 60_000 + 1
    const r = await start()
    const wrong = await phone()
    wrong.send(pair(r.code.slice(0, -2) + (r.code.endsWith('xx') ? 'yy' : 'xx')))
    await wrong.until(() => wrong.closed)
    expect(wrong.frames[0]).toMatchObject({ t: 'refused', reason: 'That pairing code is not right.' })
  })

  test('no words are shown before the phone reveals what it committed to', async () => {
    const p = await start()
    const ph = await phone()
    ph.send(pair(p.code))
    await ph.next('pair-nonce')
    await new Promise(r => setTimeout(r, 50))
    expect(await current()).not.toHaveProperty('words')
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/confirm', headers: asPerson })).statusCode).toBe(409)
  })

  test('a reveal that does not match the commitment ends the pairing', async () => {
    const p = await start()
    const ph = await phone()
    ph.send(pair(p.code, NONCE))
    await ph.next('pair-nonce')
    ph.send({ t: 'pair-reveal', nonce: 'c29tZXRoaW5nLWVsc2UtZW50aXJlbHk' })
    await ph.until(() => ph.closed)
    expect(ph.frames.at(-1)).toMatchObject({ t: 'refused' })
    expect((await current()).state).toBe('cancelled')
  })

  test('a reveal without a pairing is refused', async () => {
    await start()
    const ph = await phone()
    ph.send({ t: 'pair-reveal', nonce: NONCE })
    await ph.until(() => ph.closed)
    expect(ph.frames[0]).toMatchObject({ t: 'refused' })
  })

  test('cancelling tells a waiting phone and the code stops working', async () => {
    const p = await start()
    const ph = await toCheck(p.code)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/cancel', headers: asPerson })).statusCode).toBe(200)
    await ph.until(() => ph.closed)
    expect(ph.frames.at(-1)).toMatchObject({ t: 'refused', reason: 'Pairing was cancelled on the dashboard.' })
    expect((await current()).state).toBe('cancelled')
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/confirm', headers: asPerson })).statusCode).toBe(409)
  })

  test('Pair after the phone went away says so', async () => {
    const p = await start()
    const ph = await toCheck(p.code)
    ph.close()
    await until(async () => (await current()).state !== 'check')
    const r = await app.inject({ method: 'POST', url: '/v1/pairing/confirm', headers: asPerson })
    expect(r.statusCode).toBe(409)
  })

  test('one pairing at a time: a second start replaces the first', async () => {
    const p = await start()
    const q = await start()
    expect(q.code).not.toBe(p.code)
    const ph = await phone()
    ph.send(pair(p.code))
    await ph.until(() => ph.closed)
    expect(ph.frames[0]).toMatchObject({ t: 'refused' })
  })

  test('the link closes again when a pairing ends without a phone', async () => {
    await start()
    await app.inject({ method: 'POST', url: '/v1/pairing/cancel', headers: asPerson })
    await until(() => !hub.link.isOpen)
  })

  test('the agent cannot reach the pairing routes', async () => {
    for (const [method, url] of [['POST', '/v1/pairing'], ['GET', '/v1/pairing'], ['POST', '/v1/pairing/confirm'], ['POST', '/v1/pairing/cancel']] as const) {
      const r = await app.inject({ method, url, headers: asAgent })
      expect([url, r.statusCode, r.json().code]).toEqual([url, 403, 'forbidden'])
    }
  })

  test('the audit names the pairing but never the code', async () => {
    const p = await start()
    const rows = JSON.stringify(hub.db.prepare('SELECT * FROM audit').all())
    expect(rows).toContain('pair-start')
    expect(rows).not.toContain(p.code)
  })
})

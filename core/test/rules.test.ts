import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Approvals, APPROVAL_MS } from '../src/rules/approvals.ts'
import { Grants } from '../src/rules/grants.ts'
import { ApiFailure, decide, type PolicyInput } from '../src/rules/policy.ts'
import { StopState } from '../src/rules/stop.ts'
import { Tickets } from '../src/tickets.ts'
import { openStore, type Store } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

let s: ReturnType<typeof scratch>
let db: Store
let key: string
beforeEach(() => {
  s = scratch()
  key = newKey()
  db = openStore(join(s.dir, 'hub.db'), key)
})
afterEach(() => {
  db.close()
  s.done()
})

describe('policy', () => {
  const base: PolicyInput = { caller: 'agent', risk: 'read', grant: 'off', stopped: false }
  const cases: Array<[string, Partial<PolicyInput>, ReturnType<typeof decide>]> = [
    ['the person may do anything', { caller: 'person', risk: 'important', grant: 'off' }, { kind: 'run' }],
    ['off refuses', {}, { kind: 'refuse', code: 'not-allowed' }],
    ['ask asks', { grant: 'ask' }, { kind: 'ask' }],
    ['on runs an act', { risk: 'act', grant: 'on' }, { kind: 'run' }],
    ['important asks even when on', { risk: 'important', grant: 'on' }, { kind: 'ask' }],
    ['stopped refuses everything', { grant: 'on', stopped: true }, { kind: 'refuse', code: 'stopped' }],
    ['voice needs safe by voice', { voice: true, risk: 'act', grant: 'on', voiceSafe: false }, { kind: 'refuse', code: 'not-allowed' }],
    ['voice runs a safe act', { voice: true, risk: 'act', grant: 'on', voiceSafe: true }, { kind: 'run' }],
    ['voice never does important', { voice: true, risk: 'important', grant: 'on', voiceSafe: true }, { kind: 'refuse', code: 'not-allowed' }],
    ['voice reads nothing private without its switch', { voice: true, grant: 'on', isPrivateRead: true, voicePrivate: false }, { kind: 'refuse', code: 'not-allowed' }],
    ['voice reads private with its switch', { voice: true, grant: 'on', isPrivateRead: true, voicePrivate: true }, { kind: 'run' }],
    ['voice never makes an approval', { voice: true, grant: 'ask' }, { kind: 'refuse', code: 'not-allowed' }],
  ]
  for (const [name, input, expected] of cases) test(name, () => expect(decide({ ...base, ...input })).toEqual(expected))
})

describe('grants', () => {
  test('a missing row is off', () => {
    expect(new Grants(db).get('phone-a', 'phone.calls.read')).toEqual({ collect: false, mini: 'off', voiceSafe: false })
  })

  test('grants are per target', () => {
    const g = new Grants(db)
    g.set('phone-a', 'phone.calls.read', { collect: true, mini: 'on' })
    expect(g.get('phone-a', 'phone.calls.read')).toEqual({ collect: true, mini: 'on', voiceSafe: false })
    expect(g.get('phone-b', 'phone.calls.read').mini).toBe('off')
  })

  test('a partial change keeps the rest', () => {
    const g = new Grants(db)
    g.set('mail-1', 'mail.read', { collect: true })
    g.set('mail-1', 'mail.read', { mini: 'ask' })
    expect(g.get('mail-1', 'mail.read')).toEqual({ collect: true, mini: 'ask', voiceSafe: false })
    expect(g.list()).toEqual([{ target: 'mail-1', scope: 'mail.read', collect: true, mini: 'ask', voiceSafe: false }])
  })

  test('refuses a scope that does not exist', () => {
    expect(() => new Grants(db).set('x', 'made.up' as never, { mini: 'on' })).toThrow(ApiFailure)
  })
})

describe('approvals', () => {
  const ask = { scope: 'pc.power', risk: 'important' as const, action: 'pc.shut_down', args: {}, summary: 'Shut down this PC' }

  test('an approval cannot be decided twice or after expiry', () => {
    let now = 1000
    const a = new Approvals(db, () => now)
    const first = a.request(ask)
    expect(first.state).toBe('waiting')
    expect(first.expiresAt).toBe(1000 + APPROVAL_MS)
    expect(a.decide(first.id, 'yes').state).toBe('yes')
    expect(() => a.decide(first.id, 'no')).toThrow(expect.objectContaining({ status: 409, code: 'decided' }))
    const second = a.request(ask)
    now += APPROVAL_MS + 1
    expect(() => a.decide(second.id, 'yes')).toThrow(expect.objectContaining({ status: 409, code: 'expired' }))
    expect(() => a.decide('nope', 'yes')).toThrow(expect.objectContaining({ status: 404 }))
  })

  test('noAll answers every waiting approval no', () => {
    const a = new Approvals(db)
    a.request(ask)
    a.request(ask)
    a.noAll()
    expect(a.list().map(x => x.state)).toEqual(['no', 'no'])
  })

  test('a wait settles when the owner answers', async () => {
    const a = new Approvals(db)
    const r = a.request(ask)
    setTimeout(() => a.decide(r.id, 'no'), 20)
    expect((await a.settled(r.id)).state).toBe('no')
  })
})

describe('stop', () => {
  test('stop survives a reopen', () => {
    new StopState(db).stop()
    db.close()
    db = openStore(join(s.dir, 'hub.db'), key)
    const again = new StopState(db)
    expect(again.stopped).toBe(true)
    again.resume()
    expect(again.stopped).toBe(false)
  })
})

describe('tickets', () => {
  test('a ticket wait returns at its deadline', async () => {
    const t = new Tickets()
    const id = t.create()
    const start = Date.now()
    expect(await t.wait(id, 5000)).toEqual({ done: false })
    const waited = Date.now() - start
    expect(waited).toBeGreaterThanOrEqual(1900)
    expect(waited).toBeLessThan(2600)
  })

  test('a settled ticket answers at once', async () => {
    const t = new Tickets()
    const id = t.create()
    setTimeout(() => t.settle(id, { done: true, ok: true, data: 7 }), 10)
    expect(await t.wait(id, 2000)).toEqual({ done: true, ok: true, data: 7 })
    expect(await t.wait(id, 0)).toEqual({ done: true, ok: true, data: 7 })
  })

  test('an unknown ticket is not found', async () => {
    await expect(new Tickets().wait('nope', 0)).rejects.toMatchObject({ status: 404 })
  })
})

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DeviceStore } from '../src/connectors/registry.ts'
import { Events } from '../src/events.ts'
import { Grants } from '../src/rules/grants.ts'
import { openStore, type Store } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

let s: ReturnType<typeof scratch>
let db: Store
let grants: Grants
let events: Events
const person = { caller: 'person' } as const
const agent = { caller: 'agent' } as const

beforeEach(() => {
  s = scratch()
  db = openStore(join(s.dir, 'hub.db'), newKey())
  const devices = new DeviceStore(db)
  devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Phone A' })
  devices.upsert({ id: 'phone-b', connectorId: 'android', kind: 'phone', name: 'Phone B' })
  grants = new Grants(db)
  for (const d of ['phone-a', 'phone-b']) {
    grants.set(d, 'phone.messages.read', { collect: true })
    grants.set(d, 'phone.calls.read', { collect: true })
  }
  events = new Events(db, grants, devices)
})
afterEach(() => {
  db.close()
  s.done()
})

const sms = (body: string, at = 1000) => ({ type: 'sms' as const, occurredAt: at, who: 'Asha', whoKey: '+15550101', body, title: body })

describe('events', () => {
  test('a duplicate (device, seq) is stored once', () => {
    expect(events.add('phone-a', 1, sms('hi'))).not.toBeNull()
    expect(events.add('phone-a', 1, sms('hi again'))).toBeNull()
    expect(events.query({}, person).items.length).toBe(1)
  })

  test('collect off stores nothing', () => {
    expect(events.add('phone-a', 1, { type: 'notification', occurredAt: 1, title: 'x' })).toBeNull()
    expect(events.query({}, person).items.length).toBe(0)
  })

  test('the agent sees only granted types, per device', () => {
    events.add('phone-a', 1, sms('from a'))
    events.add('phone-b', 1, sms('from b'))
    events.add('phone-a', 2, { type: 'call', occurredAt: 2000, who: 'Ravi', title: 'Missed call' })
    expect(events.query({}, agent).items.length).toBe(0)
    grants.set('phone-a', 'phone.messages.read', { mini: 'on' })
    const seen = events.query({}, agent).items
    expect(seen.map(e => e.body)).toEqual(['from a'])
    grants.set('phone-b', 'phone.messages.read', { mini: 'ask' })
    expect(events.query({}, agent).items.length).toBe(1)
    expect(events.query({}, person).items.length).toBe(3)
  })

  test('the agent never sees system events, and sees its own actions', () => {
    events.addHub({ type: 'system', occurredAt: 1, title: 'Dropped old events' })
    events.addHub({ type: 'mini_action', occurredAt: 2, title: 'Read 3 messages' })
    expect(events.query({}, agent).items.map(e => e.type)).toEqual(['mini_action'])
    expect(events.query({}, person).items.length).toBe(2)
  })

  test('search finds words in body', () => {
    events.add('phone-a', 1, sms('are we still on for tonight'))
    events.add('phone-a', 2, sms('bringing the charger'))
    expect(events.query({ q: 'charger' }, person).items.map(e => e.body)).toEqual(['bringing the charger'])
  })

  test('paging returns every row once', () => {
    for (let i = 1; i <= 120; i++) events.add('phone-a', i, sms(`message ${i}`, i * 10))
    const seen = new Set<number>()
    let cursor: string | undefined
    let pages = 0
    do {
      const page = events.query({ limit: 50, ...(cursor ? { cursor } : {}) }, person)
      for (const e of page.items) seen.add(e.id)
      cursor = page.cursor
      pages++
    } while (cursor)
    expect(seen.size).toBe(120)
    expect(pages).toBe(3)
  })

  test('seen, counts and remove', () => {
    const id = events.add('phone-a', 1, sms('one')) as number
    events.add('phone-a', 2, { type: 'call', occurredAt: 2000, who: 'Ravi', title: 'Missed call', data: { direction: 'missed' } })
    expect(events.counts(0, person)).toMatchObject({ sms: 1, call: 1 })
    events.markSeen([id])
    expect(events.query({ unseen: true }, person).items.map(e => e.type)).toEqual(['call'])
    events.remove([id])
    expect(events.query({}, person).items.length).toBe(1)
  })
})

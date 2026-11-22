import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Audit } from '../src/audit/audit.ts'
import { openStore, type Store } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

let s: ReturnType<typeof scratch>
let db: Store
let audit: Audit
let clock = 1000
beforeEach(() => {
  s = scratch()
  db = openStore(join(s.dir, 'hub.db'), newKey())
  audit = new Audit(db, () => clock++)
})
afterEach(() => {
  db.close()
  s.done()
})

describe('audit', () => {
  test('rows chain by hash', () => {
    const a = audit.append({ caller: 'person', action: 'grant', scope: 'mail.read', outcome: 'done' })
    const b = audit.append({ caller: 'agent', action: 'read', scope: 'mail.read', outcome: 'refused', data: { count: 3 } })
    expect(a.prevHash).toBe('0'.repeat(64))
    expect(b.prevHash).toBe(a.hash)
    expect(audit.check()).toEqual({ ok: true })
  })

  test('check finds a row changed by hand', () => {
    audit.append({ caller: 'person', action: 'grant', outcome: 'done' })
    const b = audit.append({ caller: 'agent', action: 'act', outcome: 'refused' })
    audit.append({ caller: 'agent', action: 'act', outcome: 'done' })
    db.prepare("UPDATE audit SET outcome = 'done' WHERE id = ?").run(b.id)
    expect(audit.check()).toEqual({ ok: false, brokenAt: b.id })
  })

  test('agentOnly lists only agent rows', () => {
    audit.append({ caller: 'person', action: 'grant', outcome: 'done' })
    audit.append({ caller: 'agent', action: 'read', outcome: 'done' })
    audit.append({ caller: 'system', action: 'start', outcome: 'done' })
    const rows = audit.list({ agentOnly: true })
    expect(rows.map(r => r.caller)).toEqual(['agent'])
  })

  test('lists newest first, filtered, and limited', () => {
    for (let i = 0; i < 5; i++) audit.append({ caller: 'agent', action: i % 2 ? 'act' : 'read', outcome: 'done' })
    const rows = audit.list({ action: 'read', limit: 2 })
    expect(rows.length).toBe(2)
    expect(rows[0].id).toBeGreaterThan(rows[1].id)
    expect(rows.every(r => r.action === 'read')).toBe(true)
  })

  test('data refuses free text over 200 characters', () => {
    expect(() => audit.append({ caller: 'agent', action: 'read', outcome: 'done', data: { note: 'x'.repeat(201) } })).toThrow()
  })
})

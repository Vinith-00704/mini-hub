import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { getMeta, getSetting, openStore, setSetting, StoreError } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

let s: ReturnType<typeof scratch>
beforeEach(() => (s = scratch()))
afterEach(() => s.done())

describe('store', () => {
  test('creates an encrypted database that a plain open cannot read', () => {
    const file = join(s.dir, 'hub.db')
    const db = openStore(file, newKey())
    db.prepare("INSERT INTO meta (key, value) VALUES ('probe', 'hello-plain-text')").run()
    db.close()
    expect(readFileSync(file).includes(Buffer.from('hello-plain-text'))).toBe(false)
    const plain = new Database(file)
    expect(() => plain.prepare('SELECT * FROM meta').all()).toThrow()
    plain.close()
  })

  test('applies migrations once', () => {
    const file = join(s.dir, 'hub.db')
    const key = newKey()
    openStore(file, key).close()
    const db = openStore(file, key)
    expect(getMeta(db, 'schema')).toBe('1')
    db.close()
  })

  test("refuses a wrong key and keeps the file", () => {
    const file = join(s.dir, 'hub.db')
    const k1 = newKey()
    const db = openStore(file, k1)
    setSetting(db, 'theme', 'light')
    db.close()
    const size = statSync(file).size
    expect(() => openStore(file, newKey())).toThrow(StoreError)
    expect(() => openStore(file, newKey())).toThrow("The hub's data could not be opened")
    expect(statSync(file).size).toBe(size)
    const again = openStore(file, k1)
    expect(getSetting(again, 'theme', 'dark')).toBe('light')
    again.close()
  })

  test('full-text search works on events', () => {
    const db = openStore(join(s.dir, 'hub.db'), newKey())
    db.prepare("INSERT INTO devices (id, connector_id, kind, name, added_at) VALUES ('d1', 'pc', 'pc', 'PC', 1)").run()
    db.prepare(
      "INSERT INTO events (device_id, seq, type, occurred_at, received_at, title, body) VALUES ('d1', 1, 'home_state', 1, 1, 'Bedroom', 'lamp switched on')",
    ).run()
    const hits = db.prepare("SELECT rowid FROM events_fts WHERE events_fts MATCH 'lamp'").all()
    expect(hits.length).toBe(1)
    db.prepare('DELETE FROM events').run()
    expect(db.prepare("SELECT rowid FROM events_fts WHERE events_fts MATCH 'lamp'").all().length).toBe(0)
    db.close()
  })
})

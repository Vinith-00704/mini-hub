import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openStore } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

const SEED = fileURLToPath(new URL('../../tools/seed.mjs', import.meta.url))

let s: ReturnType<typeof scratch>
beforeEach(() => (s = scratch()))
afterEach(() => s.done())

const seed = (home: string, key: string) => spawnSync(process.execPath, [SEED, home, key], { encoding: 'utf8' })

describe('seed', () => {
  test('seed refuses a real data folder', () => {
    const real = join(process.env.APPDATA ?? 'C:/Users/x/AppData/Roaming', 'MiniHub-seed-check')
    const r = seed(real, newKey())
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('only fills a scratch folder')
    expect(existsSync(join(real, 'hub.db'))).toBe(false)
  })

  test('seed fills a scratch hub', () => {
    const key = newKey()
    const r = seed(s.dir, key)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const db = openStore(join(s.dir, 'hub.db'), key)
    const counts = Object.fromEntries((db.prepare('SELECT type, count(*) AS n FROM events GROUP BY type').all() as Array<{ type: string; n: number }>).map(r => [r.type, r.n]))
    expect(counts.call).toBeGreaterThan(0)
    expect(counts.sms).toBeGreaterThan(0)
    expect(counts.chat).toBeGreaterThan(0)
    expect(counts.mail).toBeGreaterThan(0)
    expect(counts.notification).toBeGreaterThan(0)
    expect(counts.mini_action).toBeGreaterThan(0)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(60)
    const devices = (db.prepare('SELECT id FROM devices ORDER BY id').all() as Array<{ id: string }>).map(d => d.id)
    expect(devices).toEqual(expect.arrayContaining(['pc', 'phone-test', 'mail-test']))
    const grants = db.prepare("SELECT count(*) AS n FROM grants WHERE state != 'off'").get() as { n: number }
    expect(grants.n).toBe(0)
    const people = (db.prepare('SELECT DISTINCT who FROM events WHERE who IS NOT NULL').all() as Array<{ who: string }>).map(r => r.who)
    expect(people.some(p => p.length >= 300)).toBe(false)
    expect(people.some(p => p.length > 150)).toBe(true)
    db.close()
  })
})

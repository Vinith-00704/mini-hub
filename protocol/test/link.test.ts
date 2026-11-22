import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { linkFrame, MAX_BATCH, pairingCommit, pairingLink, pairingWords, parsePairingLink } from '../src/link.ts'
import { WORDS } from '../src/words.ts'

const examples = join(import.meta.dirname, '..', 'examples', 'link')
const read = (dir: string) =>
  readdirSync(join(examples, dir))
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: f, value: JSON.parse(readFileSync(join(examples, dir, f), 'utf8')) as unknown }))

describe('link frames', () => {
  test('every valid example parses and every invalid one is refused', () => {
    const valid = read('valid')
    const invalid = read('invalid')
    expect(valid.length).toBeGreaterThanOrEqual(17)
    expect(invalid.length).toBeGreaterThanOrEqual(6)
    for (const { file, value } of valid) expect(linkFrame.safeParse(value).success, file).toBe(true)
    for (const { file, value } of invalid) expect(linkFrame.safeParse(value).success, file).toBe(false)
  })

  test('every kind of frame has a valid example', () => {
    const kinds = new Set(read('valid').map(e => (e.value as { t: string }).t))
    for (const t of ['hello', 'welcome', 'refused', 'pair', 'pair-nonce', 'pair-reveal', 'paired', 'events', 'ack', 'gap', 'cmd', 'waiting', 'result', 'stop', 'stop-request', 'ping', 'pong', 'settings', 'state'])
      expect(kinds.has(t), t).toBe(true)
  })

  test('an events frame with 201 items is refused', () => {
    const items = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ seq: i + 1, type: 'device_state', occurredAt: 1 }))
    expect(linkFrame.safeParse({ t: 'events', from: 1, items }).success).toBe(false)
    expect(linkFrame.safeParse({ t: 'events', from: 1, items: items.slice(0, MAX_BATCH) }).success).toBe(true)
  })
})

describe('pairing words', () => {
  const fp = 'ab'.repeat(32)
  test('the four words depend on the certificate, the code and both sides’ random values', () => {
    const a = pairingWords(fp, 'code-1', 'phone-1', 'hub-1')
    expect(a).toHaveLength(4)
    expect(pairingWords(fp, 'code-1', 'phone-1', 'hub-1')).toEqual(a)
    expect(pairingWords(fp, 'code-1', 'phone-2', 'hub-1')).not.toEqual(a)
    expect(pairingWords(fp, 'code-1', 'phone-1', 'hub-2')).not.toEqual(a)
    expect(pairingWords('cd'.repeat(32), 'code-1', 'phone-1', 'hub-1')).not.toEqual(a)
    for (const w of a) expect(WORDS).toContain(w)
  })

  test('the phone commits to its random value before it sees the hub’s', () => {
    const c = pairingCommit('phone-secret-value-1')
    expect(c).toMatch(/^[0-9a-f]{64}$/)
    expect(pairingCommit('phone-secret-value-1')).toBe(c)
    expect(pairingCommit('phone-secret-value-2')).not.toBe(c)
  })

  test('the word list has 256 distinct words', () => {
    expect(WORDS).toHaveLength(256)
    expect(new Set(WORDS).size).toBe(256)
  })

  test('the words for the shared example are exactly the listed four', () => {
    const ex = JSON.parse(readFileSync(join(examples, 'pairing-words.json'), 'utf8')) as { fp: string; code: string; phoneNonce: string; hubNonce: string; commit: string; words: string[] }
    expect(pairingWords(ex.fp, ex.code, ex.phoneNonce, ex.hubNonce)).toEqual(ex.words)
    expect(pairingCommit(ex.phoneNonce)).toBe(ex.commit)
  })
})

describe('the pairing link', () => {
  const p = { host: '192.168.1.20', port: 47800, fp: 'cd'.repeat(32), code: 'Zm9vYmFyYmF6cXV4MTIzNA', name: 'Study PC' }
  test('a pairing link round-trips', () => {
    const uri = pairingLink(p)
    expect(uri.startsWith('minihub://pair?v=1&')).toBe(true)
    expect(parsePairingLink(uri)).toEqual(p)
  })

  test('another version is refused', () => {
    expect(() => parsePairingLink(pairingLink(p).replace('v=1', 'v=2'))).toThrow()
    expect(() => parsePairingLink('https://example.com/?v=1')).toThrow()
  })
})

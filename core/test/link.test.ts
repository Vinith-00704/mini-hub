import { connect as tlsConnect } from 'node:tls'
import { join } from 'node:path'
import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { LinkFrame } from '@minihub/protocol/link'
import { loadOrMakeCert } from '../src/link/cert.ts'
import { privateAddresses } from '../src/link/addresses.ts'
import { Guard } from '../src/link/guard.ts'
import { DeviceLink } from '../src/link/server.ts'
import { Tokens } from '../src/link/tokens.ts'
import { DeviceStore } from '../src/connectors/registry.ts'
import { openStore, type Store } from '../src/store/db.ts'
import { newKey, scratch, until } from './helpers.ts'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

let s: ReturnType<typeof scratch>
let db: Store
let link: DeviceLink
let tokens: Tokens
let devices: DeviceStore

const url = () => `wss://127.0.0.1:${link.port}/v1/link`

/** A test phone. It trusts any certificate: the phone's pinning is tested on the phone. */
const client = async () => {
  const ws = new WebSocket(url(), { rejectUnauthorized: false })
  const frames: LinkFrame[] = []
  let closed = false
  ws.on('message', d => frames.push(JSON.parse(String(d)) as LinkFrame))
  ws.on('close', () => void (closed = true))
  await new Promise<void>((ok, fail) => (ws.once('open', () => ok()), ws.once('error', fail)))
  return {
    ws,
    frames,
    get closed() {
      return closed
    },
    send: (f: object) => ws.send(JSON.stringify(f)),
    until: async (check: () => boolean, ms = 2000) => {
      const end = Date.now() + ms
      while (!check()) {
        if (Date.now() > end) throw new Error('timed out')
        await new Promise(r => setTimeout(r, 10))
      }
    },
  }
}

const hello = (deviceId: string, token: string) => ({ t: 'hello', v: 1, deviceId, token, appVersion: '0.2.0', lastSeq: 0, time: Date.now() })

let clock = 1_000_000
beforeEach(async () => {
  s = scratch()
  db = openStore(join(s.dir, 'hub.db'), newKey())
  devices = new DeviceStore(db)
  tokens = new Tokens(db)
  devices.upsert({ id: 'phone-a', connectorId: 'android', kind: 'phone', name: 'Test phone' })
  link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, hosts: ['127.0.0.1'], announce: false, pingMs: 60_000, now: () => clock })
  await link.open()
})
afterEach(async () => {
  await link.close()
  db.close()
  s.done()
})

describe('the device link', () => {
  test('a client without a valid token is refused', async () => {
    const good = tokens.issue('phone-a')

    const wrong = await client()
    wrong.send(hello('phone-a', 'not-the-token'))
    await wrong.until(() => wrong.closed)
    expect(wrong.frames[0]).toMatchObject({ t: 'refused' })

    const unknown = await client()
    unknown.send(hello('phone-zzz', good))
    await unknown.until(() => unknown.closed)
    expect(unknown.frames[0]).toMatchObject({ t: 'refused' })

    const noHello = await client()
    noHello.send({ t: 'events', from: 1, items: [{ seq: 1, type: 'sms', occurredAt: 1 }] })
    await noHello.until(() => noHello.closed)
    expect(noHello.frames[0]).toMatchObject({ t: 'refused' })

    const right = await client()
    const seen: string[] = []
    link.onConnect(id => void seen.push(id))
    right.send(hello('phone-a', good))
    await right.until(() => seen.length === 1)
    expect(link.connected('phone-a')).toBe(true)
    expect(right.closed).toBe(false)
    right.ws.close()
  })

  test('a removed device’s token stops working and its open connection closes', async () => {
    const token = tokens.issue('phone-a')
    const c = await client()
    c.send(hello('phone-a', token))
    await c.until(() => link.connected('phone-a'))

    tokens.revoke('phone-a')
    link.drop('phone-a')
    await c.until(() => c.closed)
    expect(link.connected('phone-a')).toBe(false)

    const again = await client()
    again.send(hello('phone-a', token))
    await again.until(() => again.closed)
    expect(again.frames[0]).toMatchObject({ t: 'refused' })
  })

  test('the hub keeps only a hash of the token', async () => {
    const token = tokens.issue('phone-a')
    const row = db.prepare('SELECT token_hash FROM devices WHERE id = ?').get('phone-a') as { token_hash: string }
    expect(row.token_hash).not.toContain(token)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Buffer.from(token, 'base64url').length).toBe(32)
  })

  test('five wrong tokens close the door to that address for ten minutes', async () => {
    const token = tokens.issue('phone-a')
    for (let i = 0; i < 5; i++) {
      const c = await client()
      c.send(hello('phone-a', 'wrong'))
      await c.until(() => c.closed)
    }
    const blocked = await client()
    blocked.send(hello('phone-a', token))
    await blocked.until(() => blocked.closed)
    expect(blocked.frames[0]).toMatchObject({ t: 'refused' })
    expect(link.connected('phone-a')).toBe(false)

    clock += 10 * 60_000 + 1
    const later = await client()
    later.send(hello('phone-a', token))
    await later.until(() => link.connected('phone-a'))
    later.ws.close()
  })

  test('a locked-out address sending a broken frame does not bring the hub down', async () => {
    const token = tokens.issue('phone-a')
    for (let i = 0; i < 5; i++) {
      const c = await client()
      c.send(hello('phone-a', 'wrong'))
      await c.until(() => c.closed)
    }
    // A raw upgrade, then an unmasked client frame: a WebSocket protocol error on a refused connection.
    await new Promise<void>(resolve => {
      const s = tlsConnect({ host: '127.0.0.1', port: link.port, rejectUnauthorized: false }, () => {
        s.write('GET /v1/link HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')
        s.once('data', () => s.write(Buffer.from([0x81, 0x02, 0x68, 0x69])))
      })
      s.on('error', () => {})
      s.on('close', () => resolve())
      setTimeout(() => (s.destroy(), resolve()), 1500)
    })
    await new Promise(r => setTimeout(r, 100))
    clock += 10 * 60_000 + 1
    const later = await client()
    later.send(hello('phone-a', token))
    await later.until(() => link.connected('phone-a'))
    later.ws.close()
  })

  test('a listener that throws does not bring the hub down', async () => {
    const token = tokens.issue('phone-a')
    link.onFrame(() => {
      throw new Error('a listener failed')
    })
    const c = await client()
    c.send(hello('phone-a', token))
    await c.until(() => link.connected('phone-a'))
    c.send({ t: 'state', brain: 'ok', controlling: false, stopped: false, lists: { mini: {}, pc: {} } })
    c.send({ t: 'ping', time: 1 })
    await c.until(() => c.frames.some(f => f.t === 'pong'))
    expect(c.closed).toBe(false)
    c.ws.close()
  })

  test('TLS 1.2 is refused', async () => {
    const outcome = await new Promise<string>(resolve => {
      const sock = tlsConnect({ host: '127.0.0.1', port: link.port, maxVersion: 'TLSv1.2', rejectUnauthorized: false })
      sock.once('secureConnect', () => (sock.destroy(), resolve('connected')))
      sock.once('error', () => resolve('refused'))
    })
    expect(outcome).toBe('refused')
  })

  test('two missed pings close the link', async () => {
    await link.close()
    link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, hosts: ['127.0.0.1'], announce: false, pingMs: 40 })
    await link.open()
    const token = tokens.issue('phone-a')
    const c = await client()
    c.send(hello('phone-a', token))
    await c.until(() => link.connected('phone-a'))
    // This client never answers the hub's pings.
    await c.until(() => c.closed, 3000)
    expect(c.frames.filter(f => f.t === 'ping').length).toBeGreaterThanOrEqual(2)
  })

  test('a phone that answers pings stays linked', async () => {
    await link.close()
    link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, hosts: ['127.0.0.1'], announce: false, pingMs: 40 })
    await link.open()
    const token = tokens.issue('phone-a')
    const c = await client()
    c.ws.on('message', d => {
      const f = JSON.parse(String(d)) as LinkFrame
      if (f.t === 'ping') c.send({ t: 'pong', time: f.time })
    })
    c.send(hello('phone-a', token))
    await c.until(() => link.connected('phone-a'))
    await new Promise(r => setTimeout(r, 300))
    expect(c.closed).toBe(false)
    c.ws.close()
  })
})

describe('following the PC’s network', () => {
  test('the link opens once the PC gets a home network address', async () => {
    await link.close()
    let hosts: string[] = []
    link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, findHosts: () => hosts, watchMs: 30, announce: false })
    await link.open()
    expect(link.isOpen).toBe(false)
    hosts = ['127.0.0.1']
    await until(() => link.isOpen)
    expect(link.addresses).toEqual(['127.0.0.1'])
  })

  test('a listener that cannot start leaves the link closed, and it tries again', async () => {
    await link.close()
    // 192.0.2.1 is a documentation address: never this PC's, so listening on it fails.
    let hosts = ['127.0.0.1', '192.0.2.1']
    link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, findHosts: () => hosts, watchMs: 30, announce: false })
    await link.open()
    expect(link.isOpen).toBe(false)
    expect(link.addresses).toEqual([])
    hosts = ['127.0.0.1']
    await until(() => link.isOpen)
  })

  test('closing the link stops it following the network', async () => {
    await link.close()
    let hosts: string[] = []
    link = new DeviceLink({ db, tokens, cert: await loadOrMakeCert(db), log: quiet, port: 0, findHosts: () => hosts, watchMs: 30, announce: false })
    await link.open()
    await link.close()
    hosts = ['127.0.0.1']
    await new Promise(r => setTimeout(r, 150))
    expect(link.isOpen).toBe(false)
  })
})

describe('the certificate', () => {
  test('the certificate is the same after a restart', async () => {
    const a = await loadOrMakeCert(db)
    const b = await loadOrMakeCert(db)
    expect(b.fp).toBe(a.fp)
    expect(a.fp).toMatch(/^[0-9a-f]{64}$/)
    expect(a.keyPem).toContain('PRIVATE KEY')
  })

  test('every new certificate is valid DER, whatever its random serial', async () => {
    const { makeCert } = await import('../src/link/cert.ts')
    for (let i = 0; i < 600; i++) expect(() => makeCert()).not.toThrow()
  }, 30_000)

  test('dates before 2050 are written as UTCTime, as RFC 5280 asks', async () => {
    const { derTime } = await import('../src/link/cert.ts')
    expect(derTime(new Date(Date.UTC(2026, 10, 22, 8, 5, 3)))).toEqual(Buffer.concat([Buffer.from([0x17, 13]), Buffer.from('261122080503Z', 'ascii')]))
    expect(derTime(new Date(Date.UTC(2051, 0, 1)))[0]).toBe(0x18)
  })

  test('the certificate is a proper self-signed X.509 that is not a CA', async () => {
    const { X509Certificate } = await import('node:crypto')
    const c = new X509Certificate((await loadOrMakeCert(db)).certPem)
    expect(c.subject).toBe('CN=Mini Hub')
    expect(c.issuer).toBe('CN=Mini Hub')
    expect(c.ca).toBe(false)
    expect(c.verify(c.publicKey)).toBe(true)
    expect(Date.parse(c.validTo) - Date.now()).toBeGreaterThan(9 * 365 * 24 * 3600_000)
  })
})

describe('where the link listens', () => {
  test('the link listens only on private addresses', () => {
    const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null })
    const table = {
      wifi: [v4('192.168.1.20'), { ...v4('fe80::1'), family: 'IPv6' }],
      lan: [v4('10.0.0.5')],
      vm: [v4('172.20.3.4')],
      notPrivate: [v4('172.32.0.1'), v4('8.8.4.4'), v4('169.254.10.10')],
      loop: [v4('127.0.0.1', true)],
    }
    expect(privateAddresses(table as never)).toEqual(['192.168.1.20', '10.0.0.5', '172.20.3.4'])
  })

  test('the guard forgets a good address', () => {
    let now = 0
    const g = new Guard(() => now)
    for (let i = 0; i < 4; i++) g.failed('a')
    g.succeeded('a')
    g.failed('a')
    expect(g.allowed('a')).toBe(true)
    for (let i = 0; i < 4; i++) g.failed('a')
    expect(g.allowed('a')).toBe(false)
    now += 10 * 60_000 + 1
    expect(g.allowed('a')).toBe(true)
  })
})

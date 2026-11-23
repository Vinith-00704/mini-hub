// The device link (docs/04 > The link protocol): a WebSocket over TLS 1.3 at wss://<private address>:47800/v1/link.
// This file is the door: it checks who is knocking, keeps each phone's one connection alive, and hands frames on.
// What the frames mean is the android connector's business (connectors/android.ts) and pairing's (pairing.ts).

import { createServer, type Server } from 'node:https'
import { networkInterfaces, hostname } from 'node:os'
import type { AddressInfo } from 'node:net'
import { Bonjour } from 'bonjour-service'
import { WebSocketServer, type WebSocket } from 'ws'
import { LINK_PORT, linkFrame, type FrameOf, type LinkFrame, type REFUSED_CODES } from '@minihub/protocol/link'
import type { Logger } from '../connectors/types.ts'
import type { Store } from '../store/db.ts'
import { privateAddresses } from './addresses.ts'
import type { HubCert } from './cert.ts'
import { Guard } from './guard.ts'
import type { Tokens } from './tokens.ts'

const PATH = '/v1/link'
const FIRST_FRAME_MS = 10_000
const MAX_FRAME = 4 * 1024 * 1024

export type PairSocket = { send(f: LinkFrame): void; close(): void; addr: string; onClose(fn: () => void): void; refuse(reason: string): void }

type Conn = { ws: WebSocket; addr: string; deviceId?: string; missed: number; timer?: NodeJS.Timeout; first?: NodeJS.Timeout; dropped?: boolean; pairSocket?: PairSocket }
type PairFrame = FrameOf<'pair'> | FrameOf<'pair-reveal'>

export type LinkOptions = {
  db: Store
  tokens: Tokens
  cert: HubCert
  log: Logger
  /** 47800; 0 in tests. */
  port?: number
  /** Where to listen, fixed (tests). */
  hosts?: string[]
  /** Where to listen now; the PC's private addresses when neither this nor `hosts` is given. */
  findHosts?: () => string[]
  /** How often to look at the PC's addresses while the link is wanted: 30 s. */
  watchMs?: number
  /** Announce `_minihub._tcp` on the home network while open. */
  announce?: boolean
  pingMs?: number
  name?: string
  now?: () => number
}

export class DeviceLink {
  #servers: Server[] = []
  #wss?: WebSocketServer
  #bonjour?: Bonjour
  #conns = new Set<Conn>()
  #byDevice = new Map<string, Conn>()
  #guard: Guard
  #onConnect: Array<(deviceId: string, hello: FrameOf<'hello'>) => void> = []
  #onFrame: Array<(deviceId: string, f: LinkFrame) => void> = []
  #onDisconnect: Array<(deviceId: string) => void> = []
  #onPair?: (socket: PairSocket, f: PairFrame) => boolean
  #hosts: string[] = []
  /** open() and close() run one after the other, never together. */
  #busy: Promise<void> = Promise.resolve()
  /** The link should be open (a phone is paired or a pairing is under way), whether or not it could be. */
  #wanted = false
  #watch?: NodeJS.Timeout

  private o: LinkOptions
  constructor(o: LinkOptions) {
    this.o = o
    this.#guard = new Guard(o.now)
  }

  get isOpen(): boolean {
    return this.#servers.length > 0
  }

  /** The port the first listener got (47800, or a free one in tests). */
  get port(): number {
    return (this.#servers[0]?.address() as AddressInfo | null)?.port ?? 0
  }

  /** The addresses the link listens on now. */
  get addresses(): string[] {
    return this.isOpen ? [...this.#hosts] : []
  }

  get fp(): string {
    return this.o.cert.fp
  }

  get name(): string {
    return this.o.name ?? hostname()
  }

  onConnect(fn: (deviceId: string, hello: FrameOf<'hello'>) => void): void {
    this.#onConnect.push(fn)
  }
  onFrame(fn: (deviceId: string, f: LinkFrame) => void): void {
    this.#onFrame.push(fn)
  }
  onDisconnect(fn: (deviceId: string) => void): void {
    this.#onDisconnect.push(fn)
  }
  /** Pairing claims `pair` and `pair-reveal` frames. It answers whether the code was right (a wrong one counts against the address). */
  onPair(fn: (socket: PairSocket, f: PairFrame) => boolean): void {
    this.#onPair = fn
  }

  #hostsNow(): string[] {
    if (this.o.findHosts) return this.o.findHosts()
    if (this.o.hosts) return this.o.hosts
    return privateAddresses(networkInterfaces())
  }

  /**
   * Opens the link, and keeps it following the PC's network: when Wi-Fi comes up after the hub, or the address
   * changes, the listeners move with it. A start that fails is tried again on the next look.
   */
  open(): Promise<void> {
    this.#wanted = true
    if (!this.#watch) {
      this.#watch = setInterval(() => void this.#follow(), this.o.watchMs ?? 30_000)
      this.#watch.unref()
    }
    return (this.#busy = this.#busy.then(() => this.#open(), () => this.#open()))
  }

  close(): Promise<void> {
    this.#wanted = false
    clearInterval(this.#watch)
    this.#watch = undefined
    return (this.#busy = this.#busy.then(() => this.#close(), () => this.#close()))
  }

  #follow(): Promise<void> {
    return (this.#busy = this.#busy.then(
      async () => {
        if (!this.#wanted) return
        const now = this.#hostsNow()
        const same = now.length === this.#hosts.length && now.every(h => this.#hosts.includes(h))
        if (same && this.isOpen) return
        if (this.isOpen) await this.#close()
        await this.#open()
      },
      () => {},
    ))
  }

  async #open(): Promise<void> {
    if (this.isOpen || !this.#wanted) return
    const hosts = this.#hostsNow()
    if (hosts.length === 0) {
      this.o.log.warn('the device link has no private network to listen on')
      return
    }
    try {
      await this.#listen(hosts)
    } catch (error) {
      // A half-started link is no link: close what did start, and try again on the next look.
      this.o.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'the device link could not start')
      await this.#close()
    }
  }

  async #listen(hosts: string[]): Promise<void> {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME })
    wss.on('connection', (ws: WebSocket, addr: string) => this.#accept(ws, addr))
    this.#wss = wss
    for (const host of hosts) {
      const server = createServer({ cert: this.o.cert.certPem, key: this.o.cert.keyPem, minVersion: 'TLSv1.3' })
      server.on('tlsClientError', () => {})
      server.on('request', (_req, res) => (res.statusCode = 404, res.end()))
      server.on('upgrade', (req, socket, head) => {
        if (req.url !== PATH) return void socket.destroy()
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req.socket.remoteAddress ?? '?'))
      })
      await new Promise<void>((ok, fail) => {
        server.once('error', fail)
        server.listen(this.o.port ?? LINK_PORT, host, () => (server.off('error', fail), ok()))
      })
      this.#servers.push(server)
    }
    this.#hosts = hosts
    if (this.o.announce !== false) {
      try {
        this.#bonjour = new Bonjour({}, (error: unknown) => this.o.log.warn({ err: String(error) }, 'announcing the hub on the home network failed'))
        this.#bonjour.publish({ name: this.name, type: 'minihub', port: this.port, txt: { v: '1', fp: this.fp } })
      } catch (error) {
        this.o.log.warn({ err: String(error) }, 'could not announce the hub on the home network')
      }
    }
    this.o.log.info({ port: this.port }, 'device link open')
  }

  async #close(): Promise<void> {
    const bonjour = this.#bonjour
    this.#bonjour = undefined
    if (bonjour) await new Promise<void>(ok => bonjour.unpublishAll(() => (bonjour.destroy(), ok())))
    // Every linked phone is told as gone first, so nothing is left showing it online.
    const linked = [...this.#byDevice.keys()]
    this.#byDevice.clear()
    for (const id of linked) this.#tell(this.#onDisconnect, id)
    for (const c of this.#conns) c.ws.terminate()
    this.#conns.clear()
    this.#wss?.close()
    this.#wss = undefined
    await Promise.all(this.#servers.map(s => new Promise<void>(ok => s.close(() => ok()))))
    this.#servers = []
    this.#hosts = []
  }

  connected(deviceId: string): boolean {
    return this.#byDevice.has(deviceId)
  }

  send(deviceId: string, f: LinkFrame): boolean {
    const c = this.#byDevice.get(deviceId)
    if (!c || c.ws.readyState !== c.ws.OPEN) return false
    c.ws.send(JSON.stringify(f))
    return true
  }

  /** Closes a device's connection now (it was removed). */
  drop(deviceId: string): void {
    const c = this.#byDevice.get(deviceId)
    if (!c) return
    this.#byDevice.delete(deviceId)
    // Frames already on their way from a removed phone are ignored, not handled for a device that is gone.
    c.dropped = true
    clearInterval(c.timer)
    c.ws.close(4001, 'removed')
    setTimeout(() => c.ws.terminate(), 1000).unref()
  }

  /** `code` tells the phone what to do next (wait, pair again); the pairing path gives none. */
  #refuse(c: Conn, reason: string, code?: (typeof REFUSED_CODES)[number]): void {
    c.ws.send(JSON.stringify({ t: 'refused', reason, ...(code ? { code } : {}) }))
    c.ws.close(4003, 'refused')
    setTimeout(() => c.ws.terminate(), 1000).unref()
  }

  /** Runs each listener on its own: one that throws is logged and never takes the hub down. */
  #tell<A extends unknown[]>(fns: Array<(...a: A) => void>, ...args: A): void {
    for (const fn of fns)
      try {
        fn(...args)
      } catch (error) {
        this.o.log.error({ err: error instanceof Error ? error.message : String(error) }, 'a device link listener failed')
      }
  }

  #accept(ws: WebSocket, addr: string): void {
    // First of all: a socket error (a broken frame, a reset) must never become an uncaught exception.
    ws.on('error', () => {})
    const c: Conn = { ws, addr, missed: 0 }
    this.#conns.add(c)
    if (!this.#guard.allowed(addr)) return this.#refuse(c, 'Too many wrong tries from this address. Try again in 10 minutes.', 'locked-out')
    // A knock with nothing said is dropped; pairing clears this (the owner may take a while to compare the words).
    const first = setTimeout(() => c.deviceId ?? ws.terminate(), FIRST_FRAME_MS)
    first.unref()
    c.first = first
    ws.on('close', () => {
      clearTimeout(first)
      clearInterval(c.timer)
      this.#conns.delete(c)
      if (c.deviceId && this.#byDevice.get(c.deviceId) === c) {
        this.#byDevice.delete(c.deviceId)
        this.#tell(this.#onDisconnect, c.deviceId)
      }
    })
    ws.on('message', (data, isBinary) => {
      let parsed: ReturnType<typeof linkFrame.safeParse>
      try {
        parsed = isBinary ? linkFrame.safeParse(null) : linkFrame.safeParse(JSON.parse(String(data)))
      } catch {
        parsed = linkFrame.safeParse(null)
      }
      if (!parsed.success) {
        if (!c.deviceId) return this.#refuse(c, 'That is not something this hub understands.', 'bad-frame')
        this.o.log.warn({ device: c.deviceId }, 'a frame from a phone did not match the protocol')
        return
      }
      const f = parsed.data
      if (c.dropped) return
      if (!c.deviceId) return this.#opening(c, f)
      if (f.t === 'ping') return void ws.send(JSON.stringify({ t: 'pong', time: f.time }))
      if (f.t === 'pong') return void (c.missed = 0)
      this.#tell(this.#onFrame, c.deviceId, f)
    })
  }

  #opening(c: Conn, f: LinkFrame): void {
    if (f.t === 'pair' || f.t === 'pair-reveal') {
      // One pairing socket per connection, so the reveal is known to come from the phone that committed.
      const socket: PairSocket = c.pairSocket ?? {
        send: x => c.ws.send(JSON.stringify(x)),
        close: () => c.ws.close(),
        addr: c.addr,
        onClose: fn => void c.ws.on('close', fn),
        refuse: reason => this.#refuse(c, reason),
      }
      c.pairSocket = socket
      if (!this.#onPair) return this.#refuse(c, 'No pairing is under way. Start one on the dashboard.')
      clearTimeout(c.first)
      let right = false
      try {
        right = this.#onPair(socket, f)
      } catch (error) {
        this.o.log.error({ err: error instanceof Error ? error.message : String(error) }, 'pairing failed')
        return this.#refuse(c, 'Pairing failed on the PC. Try again.')
      }
      if (!right) this.#guard.failed(c.addr)
      return
    }
    if (f.t !== 'hello') return this.#refuse(c, 'Say hello first.', 'bad-frame')
    if (!this.o.tokens.check(f.deviceId, f.token)) {
      this.#guard.failed(c.addr)
      return this.#refuse(c, 'This phone is not paired with this hub, or it was removed. Pair it again.', 'not-paired')
    }
    this.#guard.succeeded(c.addr)
    const old = this.#byDevice.get(f.deviceId)
    if (old) old.ws.terminate()
    c.deviceId = f.deviceId
    this.#byDevice.set(f.deviceId, c)
    const pingMs = this.o.pingMs ?? 30_000
    c.timer = setInterval(() => {
      if (c.missed >= 2) return void c.ws.terminate()
      c.missed++
      c.ws.send(JSON.stringify({ t: 'ping', time: Date.now() }))
    }, pingMs)
    c.timer.unref()
    this.#tell(this.#onConnect, f.deviceId, f)
  }
}

// Pairing a phone (docs/04 > Pairing a device): a one-time code in a QR, the four words on both screens, the
// owner's Pair, then the phone's token, once. One pairing at a time.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { pairingCommit, pairingLink, pairingWords, type FrameOf } from '@minihub/protocol/link'
import type { DeviceStore } from '../connectors/registry.ts'
import { ApiFailure } from '../rules/policy.ts'
import { preferredAddress } from './addresses.ts'
import type { DeviceLink, PairSocket } from './server.ts'
import type { Tokens } from './tokens.ts'

const LIFE_MS = 5 * 60_000
const CLOSE_AFTER_MS = 1500

export type PairingState = 'waiting' | 'check' | 'done' | 'expired' | 'cancelled'
export type PairingView = { state: PairingState; expiresAt: number; words?: string[]; deviceName?: string; deviceId?: string }
export type PairingStart = { qr: string; address: string; code: string; expiresAt: number }

type Session = {
  code: string
  expiresAt: number
  state: PairingState
  socket?: PairSocket
  hello?: FrameOf<'pair'>
  /** The phone's commitment, and the hub's own random value sent in answer to it. */
  commit?: string
  hubNonce?: string
  words?: string[]
  deviceId?: string
  timer?: NodeJS.Timeout
}

type Deps = { link: DeviceLink; tokens: Tokens; devices: DeviceStore; now: () => number; onChange: () => void }

export class Pairing {
  #s?: Session
  #d: Deps
  #closing?: NodeJS.Timeout
  #disposed = false

  constructor(d: Deps) {
    this.#d = d
    d.link.onPair((socket, f) => this.#knock(socket, f))
  }

  async start(): Promise<PairingStart> {
    this.#end('cancelled', 'A new pairing was started on the dashboard.', false)
    await this.#d.link.open()
    const host = preferredAddress(this.#d.link.addresses)
    if (!host) throw new ApiFailure(409, 'no-network', 'This PC is not on a home network the phone can reach. Connect to your Wi-Fi and try again.')
    const code = randomBytes(16).toString('base64url')
    const expiresAt = this.#d.now() + LIFE_MS
    const s: Session = { code, expiresAt, state: 'waiting' }
    s.timer = setTimeout(() => this.#expireIfDue(), LIFE_MS + 50)
    s.timer.unref()
    this.#s = s
    this.#d.onChange()
    const port = this.#d.link.port
    return { qr: pairingLink({ host, port, fp: this.#d.link.fp, code, name: this.#d.link.name }), address: `${host}:${port}`, code, expiresAt }
  }

  current(): PairingView | null {
    this.#expireIfDue()
    const s = this.#s
    if (!s) return null
    return {
      state: s.state,
      expiresAt: s.expiresAt,
      ...(s.words ? { words: s.words } : {}),
      ...(s.hello ? { deviceName: s.hello.deviceName } : {}),
      ...(s.deviceId ? { deviceId: s.deviceId } : {}),
    }
  }

  /** The owner pressed Pair. Makes the device and sends its token, once. */
  confirm(): string {
    this.#expireIfDue()
    const s = this.#s
    if (!s || s.state !== 'check' || !s.socket || !s.hello)
      throw new ApiFailure(409, 'conflict', 'There is no phone waiting to be paired. Start again.')
    const id = `phone-${randomBytes(4).toString('hex')}`
    this.#d.devices.upsert({
      id,
      connectorId: 'android',
      kind: 'phone',
      name: s.hello.deviceName,
      info: { model: s.hello.model, appVersion: s.hello.appVersion },
    })
    const token = this.#d.tokens.issue(id)
    s.socket.send({ t: 'paired', deviceId: id, token, hubName: this.#d.link.name })
    s.socket.close()
    s.state = 'done'
    s.deviceId = id
    clearTimeout(s.timer)
    this.#d.onChange()
    return id
  }

  cancel(): void {
    this.#end('cancelled', 'Pairing was cancelled on the dashboard.')
  }

  #knock(socket: PairSocket, f: FrameOf<'pair'> | FrameOf<'pair-reveal'>): boolean {
    this.#expireIfDue()
    const s = this.#s
    if (f.t === 'pair-reveal') {
      if (!s || s.socket !== socket || s.state !== 'waiting' || !s.commit || !s.hubNonce)
        return socket.refuse('No pairing is under way. Start one on the dashboard.'), true
      if (pairingCommit(f.nonce) !== s.commit) {
        this.#end('cancelled', 'Pairing failed: the phone did not answer as it said it would. Start again on the dashboard.')
        return true
      }
      s.state = 'check'
      s.words = pairingWords(this.#d.link.fp, s.code, f.nonce, s.hubNonce)
      this.#d.onChange()
      return true
    }
    if (!s) return socket.refuse('No pairing is under way. Start one on the dashboard.'), true
    const right = f.code.length === s.code.length && timingSafeEqual(Buffer.from(f.code), Buffer.from(s.code))
    if (!right) return socket.refuse('That pairing code is not right.'), false
    if (s.state === 'expired') return socket.refuse('This pairing code has expired. Make a new one on the dashboard.'), true
    if (s.state === 'cancelled') return socket.refuse('Pairing was cancelled on the dashboard.'), true
    if (s.state !== 'waiting' || s.socket) return socket.refuse('This pairing code was already used.'), true
    // The code is now taken. The words come only after the phone reveals what it committed to.
    s.socket = socket
    s.hello = f
    s.commit = f.commit
    s.hubNonce = randomBytes(16).toString('base64url')
    socket.send({ t: 'pair-nonce', nonce: s.hubNonce })
    socket.onClose(() => {
      if (this.#s === s && s.socket === socket && (s.state === 'check' || s.state === 'waiting')) {
        s.state = 'cancelled'
        s.socket = undefined
        this.closeIfUnused()
        this.#d.onChange()
      }
    })
    this.#d.onChange()
    return true
  }

  #expireIfDue(): void {
    const s = this.#s
    if (s && (s.state === 'waiting' || s.state === 'check') && this.#d.now() > s.expiresAt)
      this.#end('expired', 'This pairing code has expired. Make a new one on the dashboard.')
  }

  #end(state: 'expired' | 'cancelled', reason: string, closeLink = true): void {
    const s = this.#s
    if (!s || (s.state !== 'waiting' && s.state !== 'check')) return
    clearTimeout(s.timer)
    s.state = state
    const socket = s.socket
    s.socket = undefined
    socket?.refuse(reason)
    if (closeLink) this.closeIfUnused()
    this.#d.onChange()
  }

  /**
   * The link stays closed while no phone is paired and no pairing is under way (docs/03 > The network). It closes a
   * moment later, so a refusal just sent still reaches the phone, and not at all if a pairing started meanwhile.
   */
  closeIfUnused(): void {
    if (this.#disposed) return
    clearTimeout(this.#closing)
    this.#closing = setTimeout(() => {
      const live = this.#s && (this.#s.state === 'waiting' || this.#s.state === 'check')
      if (!live && this.#d.tokens.paired().length === 0) void this.#d.link.close()
    }, CLOSE_AFTER_MS)
    this.#closing.unref()
  }

  /** The hub is closing: no timers may run after it. */
  dispose(): void {
    this.#disposed = true
    clearTimeout(this.#closing)
    clearTimeout(this.#s?.timer)
  }
}

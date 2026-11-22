// What linked phones say and are told (docs/04 > The link protocol): the record handed over in order with acks,
// the collect switches pushed when the owner changes them, the phone's live state, commands with their deadlines,
// and Stop. The door itself (who may connect) is server.ts.

import { randomUUID } from 'node:crypto'
import { SCOPES, type ScopeId } from '@minihub/protocol'
import type { FrameOf, LinkFrame } from '@minihub/protocol/link'
import type { DeviceStore } from '../connectors/registry.ts'
import type { Logger } from '../connectors/types.ts'
import type { Events } from '../events.ts'
import { ApiFailure } from '../rules/policy.ts'
import type { Grants } from '../rules/grants.ts'
import { getMeta, setMeta, type Store } from '../store/db.ts'
import type { DeviceLink } from './server.ts'

/** How a command was started on the hub; goes to the phone, which writes it in its own log. */
export type CommandOrigin = { origin: 'person' | 'agent'; approved: boolean; approvalId?: string; onWaiting?: () => void }

export type PhoneOptions = { commandMs?: number; maxWaitMs?: number }

type Pending = { deviceId: string; started: number; timer: NodeJS.Timeout; resolve(v: unknown): void; reject(e: unknown): void; scope?: ScopeId; onWaiting?: () => void }

const PHONE_SCOPES = (Object.keys(SCOPES) as ScopeId[]).filter(k => SCOPES[k].connector === 'android')
const COLLECTABLE = PHONE_SCOPES.filter(k => SCOPES[k].collectable)

type Deps = {
  db: Store
  link: DeviceLink
  events: Events
  devices: DeviceStore
  grants: Grants
  log: Logger
  now: () => number
  /** The phone asked for "Stop on my PC too". */
  onStopRequest: () => Promise<void>
  options?: PhoneOptions
}

export class Phones {
  #d: Deps
  #pending = new Map<string, Pending>()
  #sentCollect = new Map<string, string>()

  constructor(d: Deps) {
    this.#d = d
    d.link.onConnect((id, hello) => this.#welcome(id, hello))
    d.link.onFrame((id, f) => this.#frame(id, f))
    d.link.onDisconnect(id => this.#gone(id))
    d.grants.onChange(() => this.#pushSettings())
    // Nothing is linked yet when the hub starts: a phone shown online now would be what the last run left behind.
    for (const dev of d.devices.list()) if (dev.connectorId === 'android' && dev.state.online !== false) d.devices.setState(dev.id, { online: false })
  }

  /** The hub's copy of what this phone collects. */
  collectFor(deviceId: string): Partial<Record<ScopeId, boolean>> {
    return Object.fromEntries(COLLECTABLE.map(s => [s, this.#d.grants.get(deviceId, s).collect]))
  }

  lastSeq(deviceId: string): number {
    const row = this.#d.db.prepare('SELECT last_seq FROM sync_state WHERE device_id = ?').get(deviceId) as { last_seq: number } | undefined
    return row?.last_seq ?? 0
  }

  /** Sends a command and waits for the phone's answer (30 s; a `waiting` answer extends it to at most 2 minutes). */
  command(deviceId: string, name: string, args: Record<string, unknown>, how: CommandOrigin, scope?: ScopeId): Promise<unknown> {
    const id = randomUUID()
    const sent = this.#d.link.send(deviceId, {
      t: 'cmd',
      id,
      name,
      args,
      origin: how.origin,
      approved: how.approved,
      ...(how.approvalId ? { approvalId: how.approvalId } : {}),
    })
    if (!sent) return Promise.reject(new ApiFailure(409, 'offline', 'The phone is not linked now. It links when it is on your home Wi-Fi.'))
    return new Promise((resolve, reject) => {
      const p: Pending = {
        deviceId,
        started: Date.now(),
        timer: setTimeout(() => this.#timeout(id), this.#d.options?.commandMs ?? 30_000),
        resolve,
        reject,
        ...(scope ? { scope } : {}),
        ...(how.onWaiting ? { onWaiting: how.onWaiting } : {}),
      }
      this.#pending.set(id, p)
    })
  }

  /** Stop Mini: every linked phone is told. Never refused, needs no switch. */
  stopAll(): void {
    // Whatever was still waiting on a phone ends now: Stop answers every waiting question no (docs/03).
    for (const [id] of this.#pending) this.#settle(id, p => p.reject(new ApiFailure(423, 'stopped', 'Mini was stopped.')))
    for (const d of this.#d.devices.list()) if (d.connectorId === 'android') this.#d.link.send(d.id, { t: 'stop' })
  }

  /** The phone was removed: its record position goes with it. */
  forget(deviceId: string): void {
    this.#d.db.prepare('DELETE FROM sync_state WHERE device_id = ?').run(deviceId)
    this.#sentCollect.delete(deviceId)
    for (const [id, p] of this.#pending) if (p.deviceId === deviceId) this.#settle(id, p => p.reject(new ApiFailure(409, 'offline', 'The phone was removed.')))
  }

  dispose(): void {
    for (const [id] of this.#pending) this.#settle(id, p => p.reject(new ApiFailure(409, 'offline', 'The hub is closing.')))
  }

  #rev(deviceId: string): number {
    return Number(getMeta(this.#d.db, `settingsRev:${deviceId}`) ?? '0')
  }

  #welcome(deviceId: string, hello: FrameOf<'hello'>): void {
    const collect = this.collectFor(deviceId)
    this.#sentCollect.set(deviceId, JSON.stringify(collect))
    this.#d.link.send(deviceId, { t: 'welcome', v: 1, ackSeq: this.lastSeq(deviceId), time: this.#d.now(), collect, settingsRev: this.#rev(deviceId) })
    this.#d.devices.setState(deviceId, { online: true, appVersion: hello.appVersion })
  }

  #gone(deviceId: string): void {
    if (this.#d.devices.get(deviceId)) this.#d.devices.setState(deviceId, { online: false })
    for (const [id, p] of this.#pending) if (p.deviceId === deviceId) this.#settle(id, p => p.reject(new ApiFailure(409, 'offline', 'The phone went away before it answered.')))
  }

  /** The phone's own collect switches win: the hub's copy is set to them, and not sent back as a change. */
  #followPhone(deviceId: string, collect: Partial<Record<ScopeId, boolean>>): void {
    const next = { ...this.collectFor(deviceId) }
    for (const s of COLLECTABLE) if (collect[s] !== undefined) next[s] = collect[s]
    this.#sentCollect.set(deviceId, JSON.stringify(next))
    for (const s of COLLECTABLE) if (collect[s] !== undefined && this.#d.grants.get(deviceId, s).collect !== collect[s]) this.#d.grants.set(deviceId, s, { collect: collect[s]! })
  }

  #pushSettings(): void {
    for (const d of this.#d.devices.list()) {
      if (d.connectorId !== 'android' || !this.#d.link.connected(d.id)) continue
      const collect = this.collectFor(d.id)
      const json = JSON.stringify(collect)
      if (this.#sentCollect.get(d.id) === json) continue
      const rev = this.#rev(d.id) + 1
      setMeta(this.#d.db, `settingsRev:${d.id}`, String(rev))
      this.#sentCollect.set(d.id, json)
      this.#d.link.send(d.id, { t: 'settings', rev, collect })
    }
  }

  #frame(deviceId: string, f: LinkFrame): void {
    this.#d.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(this.#d.now(), deviceId)
    switch (f.t) {
      case 'events':
        return this.#events(deviceId, f)
      case 'gap':
        return this.#gap(deviceId, f)
      case 'state': {
        const { t: _t, collect, ...state } = f
        if (collect) this.#followPhone(deviceId, collect)
        return this.#d.devices.setState(deviceId, { ...state, online: true })
      }
      case 'waiting': {
        const p = this.#pending.get(f.id)
        if (!p || p.deviceId !== deviceId) return
        clearTimeout(p.timer)
        const limit = p.started + (this.#d.options?.maxWaitMs ?? 120_000)
        p.timer = setTimeout(() => this.#timeout(f.id), Math.max(0, Math.min(f.until, limit) - Date.now()))
        p.onWaiting?.()
        return
      }
      case 'result': {
        const p = this.#pending.get(f.id)
        if (!p || p.deviceId !== deviceId) return
        if (f.ok) return this.#settle(f.id, p => p.resolve(f.data))
        const code = f.code === 'not-allowed' || f.code === 'stopped' ? f.code : 'unavailable'
        return this.#settle(f.id, p => p.reject(new ApiFailure(code === 'not-allowed' ? 403 : 409, code, f.error ?? 'The phone said no.', p.scope)))
      }
      case 'stop-request':
        return void this.#d.onStopRequest().catch(error => this.#d.log.warn({ err: String(error) }, 'stop from the phone did not finish'))
      default:
        return
    }
  }

  #events(deviceId: string, f: FrameOf<'events'>): void {
    const at = this.lastSeq(deviceId)
    if (f.from !== at + 1) return void this.#d.link.send(deviceId, { t: 'ack', seq: at })
    const last = f.items[f.items.length - 1]!.seq
    this.#d.db.transaction(() => {
      for (const { seq, ...e } of f.items) this.#d.events.add(deviceId, seq, e)
      this.#position(deviceId, last)
    })()
    this.#d.link.send(deviceId, { t: 'ack', seq: last })
  }

  /** Events the phone had to drop (deleted by the owner before they were sent). The hub notes it and moves on. */
  #gap(deviceId: string, f: FrameOf<'gap'>): void {
    const at = this.lastSeq(deviceId)
    this.#d.db.transaction(() => {
      const row = this.#d.db.prepare('SELECT gaps_json FROM sync_state WHERE device_id = ?').get(deviceId) as { gaps_json: string } | undefined
      const gaps = [...(row ? (JSON.parse(row.gaps_json) as unknown[]) : []), { from: f.from, to: f.to, reason: f.reason, at: this.#d.now() }].slice(-100)
      this.#position(deviceId, f.from <= at + 1 && f.to > at ? f.to : at, gaps)
    })()
    this.#d.link.send(deviceId, { t: 'ack', seq: this.lastSeq(deviceId) })
  }

  #position(deviceId: string, seq: number, gaps?: unknown[]): void {
    this.#d.db
      .prepare(
        `INSERT INTO sync_state (device_id, last_seq, last_sync_at, gaps_json) VALUES (?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET last_seq = excluded.last_seq, last_sync_at = excluded.last_sync_at, gaps_json = COALESCE(?, gaps_json)`,
      )
      .run(deviceId, seq, this.#d.now(), JSON.stringify(gaps ?? []), gaps ? JSON.stringify(gaps) : null)
  }

  #timeout(id: string): void {
    this.#settle(id, p => p.reject(new ApiFailure(504, 'timeout', 'The phone did not answer in time.')))
  }

  #settle(id: string, fn: (p: Pending) => void): void {
    const p = this.#pending.get(id)
    if (!p) return
    this.#pending.delete(id)
    clearTimeout(p.timer)
    fn(p)
  }
}

// What every connector provides (docs/06-connectors.md > The interface). Setup steps come with the connectors that need them.

import type { NewEvent, Risk, ScopeId } from '@minihub/protocol'
import type { ZodType } from 'zod'

export type Logger = {
  info(obj: object | string, msg?: string): void
  warn(obj: object | string, msg?: string): void
  error(obj: object | string, msg?: string): void
  debug(obj: object | string, msg?: string): void
}

export type Device = {
  id: string
  connectorId: string
  kind: string
  name: string
  room?: string
  info: Record<string, unknown>
  state: Record<string, unknown>
  addedAt: number
  lastSeenAt?: number
}

export type DeviceInput = { id: string; connectorId: string; kind: string; name: string; info?: Record<string, unknown>; state?: Record<string, unknown> }

export type DeviceAccess = {
  upsert(d: DeviceInput): Device
  setState(id: string, patch: Record<string, unknown>): void
  list(): Device[]
  get(id: string): Device | undefined
}

export type Ctx = {
  /** Stores an event (if its collect switch is on) and tells the dashboard. */
  emit(e: NewEvent & { deviceId: string }): void
  devices: DeviceAccess
  log: Logger
  signal: AbortSignal
}

export type ActionDef = {
  title: string
  scope: ScopeId
  risk: Risk
  args: ZodType
  /** The plain-words question for an approval, from the real arguments. Required for act and important actions. */
  describe?: (args: unknown, device?: Device) => string
  run: (args: unknown, device?: Device) => Promise<unknown>
  /** Only the owner may use it, from the dashboard; never offered to Mini. */
  personOnly?: boolean
}

export type Connector = {
  manifest: {
    id: string
    name: string
    kind: 'device' | 'account' | 'service'
    icon: string
    scopes: ScopeId[]
    eventTypes: string[]
    widgets: string[]
    multiple: boolean
  }
  start(ctx: Ctx): Promise<void>
  stop(): Promise<void>
  health(): { state: 'ok' | 'degraded' | 'down' | 'off'; note?: string }
  actions: Record<string, ActionDef>
}

export type ActionInfo = { connector: string; name: string; title: string; scope: ScopeId; risk: Risk; personOnly: boolean }

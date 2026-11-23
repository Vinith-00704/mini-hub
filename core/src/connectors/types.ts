// What every connector provides (docs/06-connectors.md > The interface).

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

/** One value the owner types in a setup form. A password field's value is never sent back. */
export type Field = {
  name: string
  label: string
  kind: 'text' | 'email' | 'password' | 'number' | 'choice'
  required: boolean
  value?: string | number
  hint?: string
  choices?: Array<{ value: string; label: string }>
}

/** What the setup wizard shows next. A form comes back with `error` when what was typed did not work. */
export type SetupStep =
  | { kind: 'form'; id: string; title: string; text: string; fields: Field[]; error?: string }
  | { kind: 'show'; id: string; title: string; text: string; qr?: string; code?: string }
  | { kind: 'confirm'; id: string; title: string; text: string }
  | { kind: 'done'; devices: string[] }
  | { kind: 'error'; text: string }

/** This connector's passwords and tokens, kept only in the encrypted database. */
export type SecretAccess = { get(name: string): string | undefined; set(name: string, value: string): void; delete(name: string): void }

/** This connector's own settings. `set` merges one level deep; a key set to undefined goes. */
export type SettingsAccess = { get(): Record<string, unknown>; set(patch: Record<string, unknown>): void }

/** Whether a device's collect switch is on, and a call when any switch changes. Read only: a connector never sets one. */
export type GrantAccess = { collecting(deviceId: string, scope: ScopeId): boolean; onChange(fn: () => void): () => void }

export type Ctx = {
  /** Stores an event (if its collect switch is on) and tells the dashboard. */
  emit(e: NewEvent & { deviceId: string }): void
  devices: DeviceAccess
  log: Logger
  signal: AbortSignal
  secrets: SecretAccess
  settings: SettingsAccess
  grants: GrantAccess
}

/** Who started an action and whether the owner approved it; a device that checks its own switches needs this. */
export type RunContext = { origin: 'person' | 'agent'; approved: boolean; approvalId?: string; onWaiting?: () => void }

export type ActionDef = {
  title: string
  scope: ScopeId
  risk: Risk
  args: ZodType
  /** The plain-words question for an approval, from the real arguments. Required for act and important actions. */
  describe?: (args: unknown, device?: Device) => string
  run: (args: unknown, device?: Device, how?: RunContext) => Promise<unknown>
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
  /** One step of the owner's setup (docs/06). `session` is the hub's id for this run of the wizard. */
  setup?(ctx: Ctx, session: string, step: string | null, input: unknown): Promise<SetupStep>
  /** The owner removed one of this connector's devices: stop using it and forget its settings and secrets. */
  remove?(deviceId: string): Promise<void>
}

export type ActionInfo = {
  connector: string
  name: string
  title: string
  scope: ScopeId
  risk: Risk
  personOnly: boolean
  /** A JSON Schema for the action's arguments, as they are sent. */
  args: Record<string, unknown>
  /** For a connector with `manifest.multiple`: the devices it can be run on. */
  devices?: Array<{ id: string; name: string }>
}

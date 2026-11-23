// What the screens fetch. Query keys start with the live topic that invalidates them (app/live.ts).

import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from './api.ts'

export type Device = { id: string; connectorId: string; kind: string; name: string; info?: Record<string, unknown>; state: Record<string, unknown>; lastSeenAt?: number }
/** What a phone still needs before a collect switch that is on can do anything, by scope (the state frame's `needs`). */
export type Needs = Partial<Record<string, 'permission' | 'notification-access' | 'apps'>>
export type PairingView = { state: 'none' | 'waiting' | 'check' | 'done' | 'expired' | 'cancelled'; expiresAt?: number; words?: string[]; deviceName?: string; deviceId?: string }
export type PairingStart = { qr: string; address: string; code: string; expiresAt: number }
export type MiniProfile = { name: string; avatar: string; accent: string; sprite?: unknown }
export type HubState = {
  version: string
  stopped: boolean
  devices: Device[]
  today: Record<string, number>
  approvalsWaiting: number
  mini: { running: boolean; profile?: MiniProfile; phase?: string; cardWaiting: boolean }
}
export type MiniState = {
  running: boolean
  profile?: MiniProfile
  phase?: string
  detail?: string
  card?: { kind: string; text: string }
  permissions?: Record<string, boolean>
  assistant?: { status?: string }
}
export type Turn = { id: string; text: string; reply?: string; partial: boolean; isError: boolean; at: number }
/** What Mini asked to do, and what exactly: `action` is "connector.name" and `args` are the arguments as they will be run. */
export type Approval = { id: string; summary: string; state: string; expiresAt: number; risk: string; scope: string; requestedAt?: number; action?: string; args?: unknown; deviceId?: string }
/** A kind of device the hub can set up, with how many of its devices exist (`GET /v1/connectors`). */
export type Connector = { id: string; name: string; kind: string; icon: string; state: string; note?: string; devices: number }
/** One value a setup step asks for. */
export type SetupField = { name: string; label: string; kind: 'text' | 'email' | 'password' | 'number' | 'choice'; required: boolean; value?: string | number; hint?: string; choices?: Array<{ value: string; label: string }> }
/** What a connector's setup wants next (`POST /v1/connectors/:id/setup`). */
export type SetupStep =
  | { kind: 'form'; id: string; title: string; text: string; fields: SetupField[]; error?: string }
  | { kind: 'show'; id: string; title: string; text: string; qr?: string; code?: string }
  | { kind: 'confirm'; id: string; title: string; text: string }
  | { kind: 'done'; devices: string[] }
  | { kind: 'error'; text: string }
export type GrantRow = { target: string; targetName: string; scope: string; label: string; kind: string; collectable: boolean; collect: boolean; mini: 'off' | 'ask' | 'on'; voiceSafe: boolean; phone?: { mini: string; pc: string } }
export type AuditRow = { id: number; at: number; caller: string; detail?: string; action: string; target?: string; scope?: string; risk?: string; outcome: string; data: Record<string, unknown> }
export type EventRow = {
  id: number
  deviceId: string
  type: string
  occurredAt: number
  who?: string
  whoKey?: string
  app?: string
  title?: string
  body?: string
  data: Record<string, unknown>
  seenAt?: number
}
/** How long things are kept (Settings > Data): a kind left out is kept for ever. `mailBody` is how much of a mail is stored. */
export type Keep = 'forever' | '1y' | '90d' | '30d'
export type Retention = { events: Partial<Record<string, Keep>>; audit: '1y' | '2y' | 'forever'; mailBody: 'subjects' | 'extract' | 'full' }
export type UiSettings = {
  theme: 'dark' | 'light' | 'system'
  accent: string
  density: 'comfortable' | 'compact'
  privacy: boolean
  retention?: Retention
  dataDir?: string | null
  version?: string
}
/** What Settings > Network shows (`GET /v1/network`). */
export type NetworkInfo = { open: boolean; addresses: string[]; port: number; fingerprint: string; name: string; phones: number; alexa: { state: string; note: string } }

/** An action as `GET /v1/actions` lists it: its arguments as a JSON Schema, and for a connector with several devices, which. */
export type ActionInfo = { connector: string; name: string; title: string; scope: string; risk: 'read' | 'act' | 'important'; personOnly: boolean; args: Record<string, unknown>; devices?: Array<{ id: string; name: string }> }

export const useHubState = () => useQuery({ queryKey: ['state'], queryFn: () => api<HubState>('/v1/state'), refetchInterval: 30_000 })
export const useMini = () => useQuery({ queryKey: ['mini'], queryFn: () => api<MiniState>('/v1/mini'), refetchInterval: 5_000 })
export const useConversation = () =>
  useQuery({
    queryKey: ['mini', 'conversation'],
    queryFn: () => api<{ turns: Turn[] }>('/v1/mini/conversation'),
    refetchInterval: q => (q.state.data?.turns.some(t => t.reply === undefined || t.partial) ? 500 : 5_000),
  })
export const useApprovals = () => useQuery({ queryKey: ['approvals'], queryFn: () => api<{ approvals: Approval[] }>('/v1/approvals'), refetchInterval: 10_000 })
export const useGrants = () => useQuery({ queryKey: ['grants'], queryFn: () => api<{ items: GrantRow[] }>('/v1/grants') })
export const useDevices = (enabled = true) => useQuery({ queryKey: ['devices'], queryFn: () => api<{ items: Device[] }>('/v1/devices'), enabled })
export const useDevice = (id: string) => useQuery({ queryKey: ['devices', id], queryFn: () => api<Device>(`/v1/devices/${encodeURIComponent(id)}`) })
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<UiSettings>('/v1/settings') })
export const useAudit = (params: Record<string, string> = {}) =>
  useQuery({ queryKey: ['audit', params], queryFn: () => api<{ items: AuditRow[] }>(`/v1/audit?${new URLSearchParams({ limit: '200', ...params })}`) })
export const useAuditCheck = () => useQuery({ queryKey: ['audit', 'check'], queryFn: () => api<{ ok: boolean; brokenAt?: number }>('/v1/audit/check') })
export const useEvents = (params: Record<string, string | string[]>, enabled = true) => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : [v]) search.append(k, one)
  return useQuery({ queryKey: ['events', params], queryFn: () => api<{ items: EventRow[] }>(`/v1/events?${search}`), enabled })
}

/** The newest events of one type from each of the given devices (one request per device, so another device's cannot crowd them out). */
export const useEventsPerDevice = (type: string, limit: string, deviceIds: string[], enabled = true) =>
  useQueries({
    queries: deviceIds.map(device => {
      const params = { type, limit, device }
      return { queryKey: ['events', params], queryFn: () => api<{ items: EventRow[] }>(`/v1/events?${new URLSearchParams(params)}`), enabled }
    }),
  })

export type DayCounts = { date: string; cameIn: { call: number; sms: number; chat: number; notification: number; mail: number }; miniDid: number }
export type DaySum = { calls: number; messages: number; notifications: number; mail: number; miniDid: number }
export type Stats = { days: DayCounts[]; today: DaySum & { waiting: number }; yesterday: DaySum }

/** What came in and what Mini did, per day; refreshed when events, approvals or the audit change (live topics). */
export const useStats = (days = 7, enabled = true) =>
  useQuery({ queryKey: ['events', 'stats', days], queryFn: () => api<Stats>(`/v1/stats?days=${days}`), refetchInterval: 60_000, enabled })

/** What the owner can run by hand (for the quick-action buttons). */
export const useActions = (enabled = true) => useQuery({ queryKey: ['actions'], queryFn: () => api<{ items: ActionInfo[] }>('/v1/actions'), enabled })

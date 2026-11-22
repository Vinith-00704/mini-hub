// What the screens fetch. Query keys start with the live topic that invalidates them (app/live.ts).

import { useQuery } from '@tanstack/react-query'
import { api } from './api.ts'

export type Device = { id: string; connectorId: string; kind: string; name: string; info?: Record<string, unknown>; state: Record<string, unknown>; lastSeenAt?: number }
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
export type Approval = { id: string; summary: string; state: string; expiresAt: number; risk: string; scope: string; requestedAt?: number }
export type GrantRow = { target: string; targetName: string; scope: string; label: string; kind: string; collectable: boolean; collect: boolean; mini: 'off' | 'ask' | 'on'; voiceSafe: boolean; phone?: { mini: string; pc: string } }
export type AuditRow = { id: number; at: number; caller: string; detail?: string; action: string; target?: string; scope?: string; risk?: string; outcome: string; data: Record<string, unknown> }
export type EventRow = {
  id: number
  deviceId: string
  type: string
  occurredAt: number
  who?: string
  app?: string
  title?: string
  body?: string
  data: Record<string, unknown>
  seenAt?: number
}
export type UiSettings = { theme: 'dark' | 'light' | 'system'; accent: string; density: 'comfortable' | 'compact'; privacy: boolean; dataDir?: string | null; version?: string }

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
export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: () => api<{ items: Device[] }>('/v1/devices') })
export const useDevice = (id: string) => useQuery({ queryKey: ['devices', id], queryFn: () => api<Device>(`/v1/devices/${encodeURIComponent(id)}`) })
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<UiSettings>('/v1/settings') })
export const useAudit = (params: Record<string, string> = {}) =>
  useQuery({ queryKey: ['audit', params], queryFn: () => api<{ items: AuditRow[] }>(`/v1/audit?${new URLSearchParams({ limit: '200', ...params })}`) })
export const useAuditCheck = () => useQuery({ queryKey: ['audit', 'check'], queryFn: () => api<{ ok: boolean; brokenAt?: number }>('/v1/audit/check') })
export const useEvents = (params: Record<string, string | string[]>) => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) for (const one of Array.isArray(v) ? v : [v]) search.append(k, one)
  return useQuery({ queryKey: ['events', params], queryFn: () => api<{ items: EventRow[] }>(`/v1/events?${search}`) })
}

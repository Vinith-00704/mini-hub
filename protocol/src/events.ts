// What happened, from every source (docs/04-data-and-sync.md > Event types).

import { z } from 'zod'
import type { ScopeId } from './scopes.ts'

export const EVENT_TYPES = [
  'call',
  'sms',
  'chat',
  'notification',
  'mail',
  'device_state',
  'app_usage',
  'home_state',
  'mini_action',
  'voice_request',
  'system',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

const BY_TYPE: Record<Exclude<EventType, 'device_state'>, ScopeId | 'own' | 'person'> = {
  call: 'phone.calls.read',
  sms: 'phone.messages.read',
  chat: 'phone.messages.read',
  notification: 'phone.notifications.read',
  mail: 'mail.read',
  app_usage: 'phone.usage.read',
  home_state: 'home.read',
  // The agent may always read the record of its own actions, and never the hub's own notes or what was said to the Echo Dot.
  mini_action: 'own',
  voice_request: 'person',
  system: 'person',
}

/** The scope that governs collecting an event type and the agent reading it. `device_state` depends on the kind of device. */
export const eventScope = (type: EventType, deviceKind?: string): ScopeId | 'own' | 'person' => {
  if (type !== 'device_state') return BY_TYPE[type]
  if (deviceKind === 'phone') return 'phone.usage.read'
  if (deviceKind === 'pc') return 'pc.status.read'
  return 'home.read'
}

export const MAX_TITLE = 300
export const MAX_BODY = 20_000
export const MAX_WHO = 200

export const newEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  occurredAt: z.number().int().nonnegative(),
  who: z.string().max(MAX_WHO).optional(),
  whoKey: z.string().max(MAX_WHO).optional(),
  app: z.string().max(200).optional(),
  title: z.string().max(MAX_TITLE).optional(),
  body: z.string().max(MAX_BODY).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

export type NewEvent = z.infer<typeof newEventSchema>

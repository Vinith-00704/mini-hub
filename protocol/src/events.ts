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
  if (deviceKind === 'mail-account') return 'mail.read'
  return 'home.read'
}

export const MAX_TITLE = 300
export const MAX_BODY = 20_000
export const MAX_WHO = 200

/** One-time codes, as the dashboard and the phone hide them: a text that talks about a code has every number of code length hidden. */
export const CODE_WORD = /\b(otp|code|pin|passcode|verification)\b/i
const CODE_NUMBER = /\b\d{4,8}\b/g
export const CODE_MASK = '••••••'

/** Masks one-time codes in texts that belong together (a subject and its body): a code word in any of them masks all. */
export function maskCodes<T extends Array<string | undefined>>(...texts: T): T {
  if (!texts.some(t => t !== undefined && CODE_WORD.test(t))) return texts
  return texts.map(t => (t === undefined ? t : t.replace(CODE_NUMBER, CODE_MASK))) as T
}

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

// What `data` holds for the types the phone records. A contract for both sides to follow, not a gate: the hub never
// refuses an event over the shape of its `data` (a refusal would stall the phone's sync), and extra keys are kept.
export const CALL_DIRECTIONS = ['in', 'out', 'missed', 'rejected'] as const

export const callData = z.looseObject({ direction: z.enum(CALL_DIRECTIONS), seconds: z.number().int().nonnegative() })
export const smsData = z.looseObject({ direction: z.enum(['in', 'out']), thread: z.string().max(40) })
export const chatData = z.looseObject({
  conversation: z.string().max(MAX_WHO).optional(),
  canReply: z.boolean(),
  notificationKey: z.string().max(300),
  package: z.string().max(200),
  group: z.boolean(),
})
export const notificationData = z.looseObject({
  category: z.string().max(60).optional(),
  ongoing: z.boolean(),
  package: z.string().max(200),
  notificationKey: z.string().max(300),
})

// What Mini did on a phone or on the PC, in one record. `scope` is a hub scope or the phone's own (PHONE_ONLY_SCOPES), `reason`
// is why it was refused and `count` how many things it read. Counts only: never a name, a number or text from the record.
export const miniActionData = z.looseObject({
  tool: z.string().max(60),
  scope: z.string().max(60).optional(),
  scopes: z.array(z.string().max(60)).max(10).optional(),
  risk: z.enum(['read', 'act', 'important']).optional(),
  outcome: z.enum(['done', 'refused', 'failed']),
  reason: z.string().max(40).optional(),
  approvalId: z.string().max(80).optional(),
  count: z.number().int().nonnegative().optional(),
  on: z.enum(['pc', 'phone']).optional(),
})

// One mail in a watched account (docs/06 > mail). `account` is the mail device's id; `to` and `cc` hold at most ten addresses each.
export const mailData = z.looseObject({
  account: z.string().max(100),
  folder: z.string().max(200),
  uid: z.number().int().positive(),
  uidValidity: z.string().max(40),
  messageId: z.string().max(300).optional(),
  hasAttachments: z.boolean(),
  attachments: z.array(z.object({ name: z.string().max(200), type: z.string().max(100), size: z.number().int().nonnegative() })).max(20),
  unread: z.boolean(),
  to: z.array(z.string().max(254)).max(10).optional(),
  cc: z.array(z.string().max(254)).max(10).optional(),
})

export const EVENT_DATA = { call: callData, sms: smsData, chat: chatData, notification: notificationData, mail: mailData, mini_action: miniActionData } as const

export type CallData = z.infer<typeof callData>
export type SmsData = z.infer<typeof smsData>
export type ChatData = z.infer<typeof chatData>
export type NotificationData = z.infer<typeof notificationData>
export type MailData = z.infer<typeof mailData>
export type MiniActionData = z.infer<typeof miniActionData>

// The device link between the hub and a phone (docs/04-data-and-sync.md > The link protocol), version 1.
// One JSON object per WebSocket text frame, each with `t`. The phone app reads the same examples
// (protocol/examples/link) in its own tests, so the two sides cannot drift apart.
// Kept out of index.ts: it uses node:crypto, and the dashboard never needs it.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { EVENT_TYPES, MAX_BODY, MAX_TITLE, MAX_WHO } from './events.ts'
import { isScope } from './scopes.ts'
import { WORDS } from './words.ts'

export const LINK_VERSION = 1
export const MAX_BATCH = 200
export const LINK_PORT = 47800

const id = z.string().min(1).max(100)
const time = z.number().int().nonnegative()
const seq = z.number().int().positive()
const scopeKey = z.string().refine(isScope, 'not a scope')
const grantState = z.enum(['off', 'ask', 'on'])
const collect = z.partialRecord(scopeKey, z.boolean())

export const linkEvent = z.object({
  seq,
  type: z.enum(EVENT_TYPES),
  occurredAt: time,
  who: z.string().max(MAX_WHO).optional(),
  whoKey: z.string().max(MAX_WHO).optional(),
  app: z.string().max(200).optional(),
  title: z.string().max(MAX_TITLE).optional(),
  body: z.string().max(MAX_BODY).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

const hello = z.object({ t: z.literal('hello'), v: z.literal(LINK_VERSION), deviceId: id, token: z.string().min(1).max(200), appVersion: z.string().max(40), lastSeq: z.number().int().nonnegative(), time })
const welcome = z.object({ t: z.literal('welcome'), v: z.literal(LINK_VERSION), ackSeq: z.number().int().nonnegative(), time, collect, settingsRev: z.number().int().nonnegative() })
// Why a hub refused: not paired (or token not known), too many wrong tries, or a frame it could not read.
// `code` is absent from older hubs, and a refusal without it means 'not-paired'.
export const REFUSED_CODES = ['not-paired', 'locked-out', 'bad-frame'] as const
// What the phone still needs before a collect switch that is on can do anything, first missing thing first.
export const NEEDS = ['permission', 'notification-access', 'apps'] as const
const refused = z.object({ t: z.literal('refused'), reason: z.string().min(1).max(300), code: z.enum(REFUSED_CODES).optional() })
const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const nonce = z.string().min(16).max(100)
// Pairing is a commit-then-reveal exchange: the phone commits to its random value, the hub answers with its own,
// then the phone reveals. The words come from both, so a device in between cannot steer them (docs/04, step 4).
const pair = z.object({
  t: z.literal('pair'),
  v: z.literal(LINK_VERSION),
  code: z.string().min(1).max(100),
  commit: hex64,
  deviceName: z.string().trim().min(1).max(60),
  model: z.string().max(100),
  appVersion: z.string().max(40),
})
const pairNonce = z.object({ t: z.literal('pair-nonce'), nonce })
const pairReveal = z.object({ t: z.literal('pair-reveal'), nonce })
const paired = z.object({ t: z.literal('paired'), deviceId: id, token: z.string().min(1).max(200), hubName: z.string().max(60) })
const events = z
  .object({ t: z.literal('events'), from: seq, items: z.array(linkEvent).min(1).max(MAX_BATCH) })
  .refine(f => f.items.every((e, i) => e.seq === f.from + i), 'items must be numbered from `from`, one after another')
const ack = z.object({ t: z.literal('ack'), seq: z.number().int().nonnegative() })
const gap = z.object({ t: z.literal('gap'), from: seq, to: seq, reason: z.string().max(200) }).refine(f => f.to >= f.from, '`to` before `from`')
const cmd = z.object({
  t: z.literal('cmd'),
  id,
  name: z.string().min(1).max(60),
  args: z.record(z.string(), z.unknown()),
  origin: z.enum(['person', 'agent']),
  approved: z.boolean(),
  approvalId: z.string().max(100).optional(),
})
const waiting = z.object({ t: z.literal('waiting'), id, until: time })
const result = z
  .object({ t: z.literal('result'), id, ok: z.boolean(), data: z.unknown().optional(), error: z.string().max(500).optional(), code: z.string().max(60).optional() })
  .refine(f => f.ok || (f.error !== undefined && f.code !== undefined), 'a failed result needs error and code')
const stop = z.object({ t: z.literal('stop') })
const stopRequest = z.object({ t: z.literal('stop-request') })
const ping = z.object({ t: z.literal('ping'), time })
const pong = z.object({ t: z.literal('pong'), time })
const settings = z.object({ t: z.literal('settings'), rev: z.number().int().nonnegative(), collect })
const state = z.object({
  t: z.literal('state'),
  battery: z.number().int().min(0).max(100).optional(),
  charging: z.boolean().optional(),
  network: z.enum(['wifi', 'mobile', 'none']).optional(),
  brain: z.enum(['ok', 'asleep', 'broken']),
  controlling: z.boolean(),
  stopped: z.boolean(),
  // The phone's own collect switches. The phone's switches win (docs/04 > Whose switches win): the hub's copy follows.
  collect: collect.optional(),
  // Set by the phone only for a kind whose collect switch is on and that has no source able to run.
  needs: z.partialRecord(scopeKey, z.enum(NEEDS)).optional(),
  lists: z.object({ mini: z.partialRecord(scopeKey, grantState), pc: z.partialRecord(scopeKey, grantState) }),
})

export const linkFrame = z.discriminatedUnion('t', [
  hello, welcome, refused, pair, pairNonce, pairReveal, paired, events, ack, gap, cmd, waiting, result, stop, stopRequest, ping, pong, settings, state,
])

export type LinkFrame = z.infer<typeof linkFrame>
export type LinkEvent = z.infer<typeof linkEvent>
export type FrameOf<T extends LinkFrame['t']> = Extract<LinkFrame, { t: T }>

/**
 * The four words both screens show while pairing: from the hub's certificate as each side sees it, the code, and
 * both random values. The phone's value was committed to before the hub's was known, so nobody can choose them.
 */
export function pairingWords(fp: string, code: string, phoneNonce: string, hubNonce: string): string[] {
  const digest = createHash('sha256').update(`minihub-pair-v2|${fp}|${code}|${phoneNonce}|${hubNonce}`, 'utf8').digest()
  return [0, 1, 2, 3].map(i => WORDS[digest[i]!]!)
}

/** What the phone sends first: the hash of its random value, which it reveals only after the hub has sent its own. */
export const pairingCommit = (phoneNonce: string): string => createHash('sha256').update(`minihub-commit|${phoneNonce}`, 'utf8').digest('hex')

export type PairingInfo = { host: string; port: number; fp: string; code: string; name: string }

export function pairingLink(p: PairingInfo): string {
  const q = new URLSearchParams({ v: String(LINK_VERSION), host: `${p.host}:${p.port}`, fp: p.fp, code: p.code, name: p.name })
  return `minihub://pair?${q.toString()}`
}

export function parsePairingLink(uri: string): PairingInfo {
  const prefix = 'minihub://pair?'
  if (!uri.startsWith(prefix)) throw new Error('This is not a Mini Hub pairing code.')
  const q = new URLSearchParams(uri.slice(prefix.length))
  if (q.get('v') !== String(LINK_VERSION)) throw new Error('This pairing code is from another version of Mini Hub.')
  const hostPort = q.get('host') ?? ''
  const at = hostPort.lastIndexOf(':')
  const host = hostPort.slice(0, at)
  const port = Number(hostPort.slice(at + 1))
  const fp = q.get('fp') ?? ''
  const code = q.get('code') ?? ''
  if (at < 1 || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{64}$/.test(fp) || !code)
    throw new Error('This pairing code is incomplete.')
  return { host, port, fp, code, name: q.get('name') ?? 'Mini Hub' }
}

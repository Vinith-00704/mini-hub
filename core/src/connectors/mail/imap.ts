// IMAP for the mail connector: making a connection, finding folders, and turning a message into plain text
// (docs/06 > mail). Every connection uses TLS with the certificate checked, and imapflow's own logging is off.

import { convert } from 'html-to-text'
import { ImapFlow, type MessageAddressObject, type MessageEnvelopeObject, type MessageStructureObject } from 'imapflow'
import type { MailInfo } from './providers.ts'

/** Connecting may take this long; one action at most ACTION_MS, all told. */
export const CONNECT_MS = 20_000
export const ACTION_MS = 60_000
/** The most of one text part that is ever fetched: a large mail costs no more than this. */
export const TEXT_BYTES = 262_144
export const MAX_ATTACHMENTS = 20

export const MOVED = 'That mail has moved or the mailbox was rebuilt. Search again.'

/** A new client for this account. It has an `error` listener from the start, so a dropped line never stops the hub. */
export function imapClient(info: MailInfo, pass: string): ImapFlow {
  const { host, port, security } = info.imap
  const client = new ImapFlow({
    host,
    port,
    secure: security === 'tls',
    ...(security === 'starttls' ? { doSTARTTLS: true } : {}),
    auth: { user: info.username, pass },
    logger: false,
    tls: { rejectUnauthorized: true },
    disableAutoIdle: false,
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
  })
  client.on('error', () => {})
  return client
}

/** Closes a client: a polite LOGOUT if it answers within a few seconds, and the socket goes either way. */
export async function closeClient(client: ImapFlow): Promise<void> {
  if (!client.usable) return void client.close()
  await Promise.race([client.logout().catch(() => {}), new Promise(r => setTimeout(r, 5000).unref())])
  if (!client.isClosed) client.close()
}

/** Why a connection or a command failed, in a word. Never the server's own text: that can carry anything. */
export type Failure = 'auth' | 'tls' | 'timeout' | 'network' | 'other'

const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|^ERR_SSL|^ERR_TLS/
const TIMEOUTS = new Set(['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'ETIMEOUT', 'ETIMEDOUT', 'ACTION_TIMEOUT'])
const NETWORK = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EDNS',
  'ECONNECTION',
  'ESOCKET',
  'NoConnection',
  'EConnectionClosed',
  'ClosedAfterConnectText',
  'ClosedAfterConnectTLS',
])

export function classify(error: unknown): Failure {
  const e = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    originalCode?: unknown
    authenticationFailed?: unknown
    tlsFailed?: unknown
  }
  const codes = [e.code, e.originalCode].filter((c): c is string => typeof c === 'string')
  if (e.authenticationFailed === true || codes.includes('EAUTH') || codes.includes('ENOAUTH')) return 'auth'
  if (e.tlsFailed === true || codes.includes('ETLS') || codes.some(c => CERT.test(c))) return 'tls'
  if (codes.some(c => TIMEOUTS.has(c))) return 'timeout'
  if (codes.some(c => NETWORK.has(c))) return 'network'
  return 'other'
}

/** Cuts a string to at most `max` UTF-16 units without splitting a surrogate pair. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s
  let end = max
  const c = s.charCodeAt(end - 1)
  if (c >= 0xd800 && c <= 0xdbff) end -= 1
  return s.slice(0, end)
}

/** Three or more blank lines become two; trailing spaces on a line and around the whole go. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

const fileName = (n: MessageStructureObject): string | undefined => n.dispositionParameters?.filename ?? n.parameters?.name

const isAttachment = (n: MessageStructureObject): boolean => !n.type.startsWith('multipart/') && (n.disposition === 'attachment' || fileName(n) !== undefined)

/** Every node of a message's structure, not looking inside an attached message. */
function nodes(root: MessageStructureObject): MessageStructureObject[] {
  const out: MessageStructureObject[] = []
  const walk = (n: MessageStructureObject): void => {
    out.push(n)
    if (n.type === 'message/rfc822') return
    for (const c of n.childNodes ?? []) walk(c)
  }
  walk(root)
  return out
}

export type Attachment = { name: string; type: string; size: number }

/** The attachments listed (never downloaded): at most 20 described, and whether there were any. */
export function attachmentsOf(root: MessageStructureObject | undefined): { hasAttachments: boolean; attachments: Attachment[] } {
  const found = root ? nodes(root).filter(isAttachment) : []
  return {
    hasAttachments: found.length > 0,
    attachments: found.slice(0, MAX_ATTACHMENTS).map(n => ({
      name: cut(fileName(n) ?? 'attachment', 200),
      type: cut(n.type, 100),
      size: Number.isInteger(n.size) && (n.size as number) >= 0 ? (n.size as number) : 0,
    })),
  }
}

/** The part to read as the text: the first plain-text part that is not an attachment, else the first HTML one. */
export function textPart(root: MessageStructureObject | undefined): { part: string; html: boolean } | undefined {
  if (!root) return undefined
  const all = nodes(root).filter(n => !isAttachment(n))
  const plain = all.find(n => n.type === 'text/plain')
  if (plain) return { part: plain.part ?? '1', html: false }
  const html = all.find(n => n.type === 'text/html')
  if (html) return { part: html.part ?? '1', html: true }
  return undefined
}

const HTML_OPTIONS = { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }

/** A message's text, by peek (never sets \Seen), at most TEXT_BYTES of it fetched. Empty when it has no text part. */
export async function messageText(client: ImapFlow, uid: number, root: MessageStructureObject | undefined): Promise<string> {
  const tp = textPart(root)
  if (!tp) return ''
  const { content } = await client.download(String(uid), tp.part, { uid: true, maxBytes: TEXT_BYTES })
  if (!content) return ''
  const chunks: Buffer[] = []
  for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  // A cut at the byte limit can end inside a character; its broken remains go.
  const raw = Buffer.concat(chunks).toString('utf8').replace(/�+$/, '')
  return tidy(tp.html ? convert(raw, HTML_OPTIONS) : raw)
}

export const firstSender = (env: MessageEnvelopeObject | undefined): MessageAddressObject | undefined => env?.from?.[0] ?? env?.sender?.[0]

/** "Asha Example <asha@example.com>", or the address alone. */
export const addressLine = (a: MessageAddressObject | undefined): string => {
  if (!a) return ''
  if (a.name && a.address) return `${a.name} <${a.address}>`
  return a.name || a.address || ''
}

export const addresses = (list: MessageAddressObject[] | undefined, max: number): string[] =>
  (list ?? [])
    .map(a => a.address)
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .slice(0, max)
    .map(a => cut(a, 254))

export const dateOf = (internal: Date | string | undefined, env: MessageEnvelopeObject | undefined, now: number): number => {
  for (const d of [internal, env?.date]) {
    const t = d instanceof Date ? d.getTime() : typeof d === 'string' ? Date.parse(d) : NaN
    if (Number.isFinite(t) && t >= 0) return t
  }
  return now
}

/** A folder by its special use, else the first of these names that exists. */
export async function findFolder(client: ImapFlow, use: string, names: string[] = []): Promise<string | undefined> {
  const list = await client.list()
  const special = list.find(f => f.specialUse === use)
  if (special) return special.path
  for (const n of names) {
    const f = list.find(x => x.path === n)
    if (f) return f.path
  }
  return undefined
}

// One watched mail account (docs/06 > mail > How it works). Watched only while its Reading mail switch is on: IMAP IDLE
// on the inbox (or a STATUS every 60 s where the server has no IDLE) and a full check every 15 minutes. Mail is
// collected from the moment watching starts; nothing older is fetched.

import type { FetchMessageObject, ImapFlow } from 'imapflow'
import { MAX_BODY, MAX_TITLE, MAX_WHO } from '@minihub/protocol'
import type { Ctx } from '../types.ts'
import { addresses, attachmentsOf, classify, cut, dateOf, firstSender, imapClient, messageText } from './imap.ts'
import type { MailInfo } from './providers.ts'

export type MailBody = 'subjects' | 'extract' | 'full'

export const NOTES = {
  off: 'Not watching: Reading mail is not collected.',
  unreachable: 'Cannot reach the mail server. Trying again.',
  tls: "The mail server's certificate could not be checked. Trying again.",
  refused: "The mail server refused the password. Enter it again on this account's page.",
} as const

const RETRY_MS = [5_000, 15_000, 60_000]
const RETRY_LATER_MS = 5 * 60_000
const POLL_MS = 60_000
const CHECK_MS = 15 * 60_000
/** At most this many new mails are read in one round; a longer catch-up takes several rounds. */
const ROUND = 200
const BODY_CHARS: Record<MailBody, number> = { subjects: 0, extract: 2_000, full: MAX_BODY }

export const passwordName = (deviceId: string): string => `${deviceId}.password`

type Saved = { uidValidity?: string; lastUid?: number }

/** The account's place in its inbox, from the connector's settings. */
export const savedOf = (ctx: Ctx, deviceId: string): Saved => {
  const accounts = ctx.settings.get().accounts as Record<string, Saved> | undefined
  return accounts?.[deviceId] ?? {}
}

/** The connection was lost while reading: what was not read yet is read after reconnecting. */
class Lost extends Error {}

export class Account {
  readonly id: string
  #ctx: Ctx
  #info: MailInfo
  #mailBody: () => MailBody
  #client: ImapFlow | null = null
  #stopped = false
  #failures = 0
  #retry: NodeJS.Timeout | null = null
  #poll: NodeJS.Timeout | null = null
  #check: NodeJS.Timeout | null = null
  #queue: Promise<unknown> = Promise.resolve()
  #uidValidity = ''
  #uidNext = 0
  /** The account's trouble, if any: a note shown on its page and counted in the connector's health. */
  note: string | undefined

  constructor(id: string, info: MailInfo, ctx: Ctx, mailBody: () => MailBody) {
    this.id = id
    this.#info = info
    this.#ctx = ctx
    this.#mailBody = mailBody
  }

  get connected(): boolean {
    return this.#client?.usable === true && !this.#stopped
  }

  start(): void {
    void this.#connect()
  }

  /** Closes the connection at once and stops every timer. */
  async stop(): Promise<void> {
    this.#stopped = true
    this.#clearTimers()
    if (this.#retry) clearTimeout(this.#retry)
    this.#retry = null
    const c = this.#client
    this.#client = null
    if (c) c.close()
  }

  /** A catch-up now: how many new mails were read. */
  check(): Promise<number> {
    return this.#round()
  }

  #state(patch: Record<string, unknown>): void {
    if (!this.#stopped) this.#ctx.devices.setState(this.id, patch)
  }

  #clearTimers(): void {
    if (this.#poll) clearInterval(this.#poll)
    if (this.#check) clearInterval(this.#check)
    this.#poll = this.#check = null
  }

  async #connect(): Promise<void> {
    this.#retry = null
    if (this.#stopped) return
    const pass = this.#ctx.secrets.get(passwordName(this.id))
    if (!pass) return this.#refused()
    const client = imapClient(this.#info, pass)
    this.#client = client
    // Only a connection that was watching reconnects on close; a failed attempt is handled where it failed.
    let ready = false
    client.on('close', () => {
      if (ready) this.#lost(client)
    })
    client.on('exists', (e: { path?: string }) => {
      if (e.path === undefined || e.path === 'INBOX') this.#soon()
    })
    try {
      await client.connect()
      const box = await client.mailboxOpen('INBOX', { readOnly: true })
      if (this.#stopped || this.#client !== client) return void client.close()
      ready = true
      this.#uidValidity = String(box.uidValidity)
      this.#uidNext = box.uidNext
      this.note = undefined
      this.#state({ online: true, watching: true, note: undefined })
      const saved = savedOf(this.#ctx, this.id)
      if (saved.uidValidity !== this.#uidValidity || saved.lastUid === undefined) {
        // From now on: nothing that is already in the inbox is fetched.
        this.#save(Math.max(0, box.uidNext - 1))
      } else {
        this.#soon()
      }
      if (!client.capabilities.has('IDLE')) {
        this.#poll = setInterval(() => void this.#pollStatus(client), POLL_MS)
        this.#poll.unref()
      }
      this.#check = setInterval(() => this.#soon(), CHECK_MS)
      this.#check.unref()
    } catch (error) {
      if (this.#client !== client) return
      this.#client = null
      client.close()
      if (classify(error) === 'auth') return this.#refused()
      this.#later(classify(error) === 'tls' ? NOTES.tls : NOTES.unreachable)
    }
  }

  #refused(): void {
    this.#client = null
    this.#clearTimers()
    this.note = NOTES.refused
    this.#ctx.log.warn({ connector: 'mail', device: this.id }, 'the mail server refused the password')
    this.#state({ online: false, watching: false, note: NOTES.refused })
  }

  /** The watching connection closed: try again after 5 s, 15 s, 60 s, then every 5 minutes. */
  #lost(client: ImapFlow): void {
    if (this.#stopped || this.#client !== client) return
    this.#client = null
    this.#later()
  }

  #later(note: string = NOTES.unreachable): void {
    this.#clearTimers()
    if (this.#stopped || this.#retry) return
    this.note = note
    this.#state({ online: false, watching: false, note })
    const wait = RETRY_MS[this.#failures] ?? RETRY_LATER_MS
    this.#failures += 1
    this.#retry = setTimeout(() => void this.#connect(), wait)
    this.#retry.unref()
  }

  async #pollStatus(client: ImapFlow): Promise<void> {
    if (this.#client !== client || !client.usable) return
    try {
      const s = await client.status('INBOX', { uidNext: true })
      if (s && typeof s.uidNext === 'number' && s.uidNext > this.#uidNext) {
        this.#uidNext = s.uidNext
        this.#soon()
      }
    } catch {
      // A failed STATUS is the connection's trouble; its close event starts the reconnect.
    }
  }

  /** Never after stop: a round still under way when Reading mail was turned off must not move the place on. */
  #save(lastUid: number): void {
    if (this.#stopped) return
    this.#ctx.settings.set({ accounts: { [this.id]: { uidValidity: this.#uidValidity, lastUid } } })
  }

  /** A round started by the server or a timer. One that fails on a live connection is logged, as a word only. */
  #soon(): void {
    const client = this.#client
    this.#round().catch(error => {
      if (client?.usable && this.#client === client) this.#ctx.log.warn({ connector: 'mail', device: this.id, reason: classify(error) }, 'a mail check did not work')
    })
  }

  /** One fetch at a time per account: every round waits for the one before it. */
  #round(): Promise<number> {
    const next = this.#queue.then(() => this.#fetchNew())
    this.#queue = next.catch(() => 0)
    return next
  }

  async #fetchNew(): Promise<number> {
    const client = this.#client
    if (!client || !client.usable || this.#stopped || !this.#uidValidity) return 0
    // Off means nothing: a switch turned off a moment ago stops the round before anything is fetched.
    if (!this.#ctx.grants.collecting(this.id, 'mail.read')) return 0
    const last = savedOf(this.#ctx, this.id).lastUid
    // No place in the inbox: it starts from now, never from the first mail.
    if (last === undefined) return (this.#save(Math.max(0, this.#uidNext - 1)), 0)
    const uids = await client.search({ uid: `${last + 1}:*` }, { uid: true })
    const fresh = (Array.isArray(uids) ? uids : []).filter(u => u > last).sort((a, b) => a - b)
    const take = fresh.slice(0, ROUND)
    let read = 0
    let odd = 0
    if (take.length > 0) {
      // Everything about these mails first; nothing else may be sent to the server while a FETCH streams in.
      const found = new Map<number, FetchMessageObject>()
      for await (const m of client.fetch(take.join(','), { uid: true, envelope: true, bodyStructure: true, internalDate: true, flags: true }, { uid: true })) {
        found.set(m.uid, m)
      }
      for (const uid of take) {
        if (this.#stopped || this.#client !== client) break
        const m = found.get(uid)
        // A mail missing from a FETCH cut short by a dropped line is read after reconnecting, not skipped.
        if (!m && !client.usable) break
        try {
          if (m) {
            this.#ctx.emit(await this.#event(client, m))
            read += 1
          }
        } catch (error) {
          if (error instanceof Lost) break
          // An odd mail is skipped, never retried for ever: the account's place still moves past it.
          odd += 1
        }
        this.#save(uid)
      }
      if (odd > 0) this.#ctx.log.warn({ connector: 'mail', device: this.id, count: odd }, 'some mail could not be read')
    }
    // A completed round is what proves the connection works: only then does the reconnect wait start again at 5 s.
    this.#failures = 0
    this.#state({ lastCheckAt: Date.now() })
    if (fresh.length > ROUND && this.#client === client) this.#soon()
    return read
  }

  async #event(client: ImapFlow, m: FetchMessageObject) {
    const env = m.envelope
    const from = firstSender(env)
    const max = BODY_CHARS[this.#mailBody()] ?? BODY_CHARS.extract
    let body = ''
    if (max > 0) {
      try {
        body = await messageText(client, m.uid, m.bodyStructure)
      } catch {
        if (!client.usable) throw new Lost()
        // The text could not be read; the mail is still recorded, without it.
      }
    }
    const { hasAttachments, attachments } = attachmentsOf(m.bodyStructure)
    const device = this.#ctx.devices.get(this.id)
    const messageId = env?.messageId && env.messageId.length <= 300 ? env.messageId : undefined
    const to = addresses(env?.to, 10)
    const cc = addresses(env?.cc, 10)
    return {
      deviceId: this.id,
      type: 'mail' as const,
      occurredAt: dateOf(m.internalDate, env, Date.now()),
      ...(from?.name || from?.address ? { who: cut((from.name || from.address) as string, MAX_WHO) } : {}),
      ...(from?.address ? { whoKey: cut(from.address.toLowerCase(), MAX_WHO) } : {}),
      app: cut(device?.name ?? this.#info.address, 200),
      title: cut(env?.subject || '(no subject)', MAX_TITLE),
      ...(body ? { body: cut(body, max) } : {}),
      data: {
        account: this.id,
        folder: 'INBOX',
        uid: m.uid,
        uidValidity: this.#uidValidity,
        ...(messageId ? { messageId } : {}),
        hasAttachments,
        attachments,
        unread: !(m.flags?.has('\\Seen') ?? false),
        ...(to.length ? { to } : {}),
        ...(cc.length ? { cc } : {}),
      },
    }
  }
}

// The owner's mail accounts (docs/06 > mail): IMAP for reading, SMTP for sending, with the owner's own address and app
// password. Watching an account needs its Reading mail switch; every action asks the hub's usual rules first, and
// sending or deleting asks the owner every time, with the exact text.

import { maskCodes, type MailData } from '@minihub/protocol'
import type { FetchMessageObject, ImapFlow, SearchObject } from 'imapflow'
import type { EventRow } from '../../events.ts'
import { ApiFailure } from '../../rules/policy.ts'
import type { Connector, Ctx, Device, RunContext } from '../types.ts'
import { Account, NOTES, passwordName, savedOf, type MailBody } from './account.ts'
import {
  ACTION_MS,
  addressLine,
  attachmentsOf,
  classify,
  closeClient,
  cut,
  dateOf,
  findFolder,
  firstSender,
  imapClient,
  messageText,
  MOVED,
} from './imap.ts'
import { mailInfo, savesSentItself, type MailInfo } from './providers.ts'
import { ARGS, SEARCH_LIMIT, type Compose, type MarkArgs, type Place, type Ref, type SearchArgs } from './refs.ts'
import { buildMessage, newMessageId, sendFailure, sendMessage, type Outgoing } from './send.ts'
import { mailSetup } from './setup.ts'

type Deps = { lookup: (eventId: number) => EventRow | undefined; mailBody: () => MailBody }

/** At most this many short connections at once per account, besides the one that watches. */
const SLOTS = 2
const READ_CHARS = 100_000
const BROKEN = "This account's details are missing. Remove it and add it again."

const DRAFTS = ['Drafts', '[Gmail]/Drafts', 'INBOX.Drafts']
const SENT = ['Sent', 'Sent Items', 'Sent Messages', '[Gmail]/Sent Mail', 'INBOX.Sent']

type Target = Place & { event?: EventRow }

const plain = (error: unknown): ApiFailure => {
  if (error instanceof ApiFailure) return error
  switch (classify(error)) {
    case 'auth':
      return new ApiFailure(503, 'unavailable', NOTES.refused)
    case 'tls':
      return new ApiFailure(503, 'unavailable', "The mail server's certificate could not be checked, so Mini Hub did not connect.")
    case 'timeout':
      return new ApiFailure(504, 'timeout', 'The mail server took too long to answer. Try again.')
    case 'network':
      return new ApiFailure(503, 'unavailable', 'Mini Hub could not reach the mail server. Try again later.')
    default:
      return new ApiFailure(502, 'unavailable', 'The mail server did not do that. Try again later.')
  }
}

/** Other people's words as one plain line of at most 200 characters, for an approval. */
const oneLine = (s: string): string => cut(s.replace(/[\p{Cc}\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069]+/gu, ' ').trim(), 200)

/** A Message-ID fit for In-Reply-To and References; anything else gives no threading headers. */
const MESSAGE_ID = /^<[^<>\s]{1,298}>$/

/** What Mini is given of a mail: its one-time codes masked (the owner, in Mini Hub, sees it whole). */
const forCaller = <T extends Array<string | undefined>>(how: RunContext | undefined, ...texts: T): T => (how?.origin === 'person' ? texts : maskCodes(...texts))

const accountName = (device?: Device): string => (typeof device?.info.address === 'string' ? device.info.address : 'your mail account')

export function mailConnector(d: Deps): Connector {
  let ctx: Ctx | null = null
  let unsubscribe: (() => void) | null = null
  const accounts = new Map<string, Account>()
  const slots = new Map<string, { busy: number; waiting: Array<() => void> }>()

  const own = (): Device[] => (ctx ? ctx.devices.list().filter(x => x.connectorId === 'mail') : [])

  /** Watches exactly the accounts whose Reading mail switch is on; the rest hold no connection and store nothing. */
  const reconcile = (): void => {
    const c = ctx
    if (!c) return
    const list = own()
    const ids = new Set(list.map(x => x.id))
    for (const [id, a] of accounts) {
      if (ids.has(id)) continue
      void a.stop()
      accounts.delete(id)
    }
    for (const dev of list) {
      const want = c.grants.collecting(dev.id, 'mail.read')
      const watching = accounts.get(dev.id)
      if (want) {
        if (watching) continue
        const info = mailInfo(dev.info)
        if (!info) {
          if (dev.state.note !== BROKEN) c.devices.setState(dev.id, { online: false, watching: false, note: BROKEN })
          continue
        }
        const a = new Account(dev.id, info, c, d.mailBody)
        accounts.set(dev.id, a)
        a.start()
        continue
      }
      if (watching) {
        void watching.stop()
        accounts.delete(dev.id)
      }
      // Turned off: when it is turned on again, mail is read from then, not from where it stopped.
      const saved = savedOf(c, dev.id)
      if (saved.lastUid !== undefined) c.settings.set({ accounts: { [dev.id]: saved.uidValidity ? { uidValidity: saved.uidValidity } : {} } })
      if (dev.state.watching !== false || dev.state.online !== false || dev.state.note !== NOTES.off) c.devices.setState(dev.id, { online: false, watching: false, note: NOTES.off })
    }
  }

  const restart = (id: string): void => {
    const a = accounts.get(id)
    if (a) {
      void a.stop()
      accounts.delete(id)
    }
    reconcile()
  }

  const setup = mailSetup({ saved: restart })

  const need = (device?: Device): { device: Device; info: MailInfo; pass: string } => {
    if (!ctx || !device || device.connectorId !== 'mail') throw new ApiFailure(400, 'bad-request', 'Add a mail account first.')
    const info = mailInfo(device.info)
    if (!info) throw new ApiFailure(409, 'unavailable', BROKEN)
    const pass = ctx.secrets.get(passwordName(device.id))
    if (!pass) throw new ApiFailure(409, 'unavailable', "This account has no password. Enter it again on this account's page.")
    return { device, info, pass }
  }

  const acquire = async (id: string): Promise<void> => {
    const s = slots.get(id) ?? { busy: 0, waiting: [] }
    slots.set(id, s)
    if (s.busy >= SLOTS) await new Promise<void>(resolve => s.waiting.push(resolve))
    s.busy += 1
  }
  const release = (id: string): void => {
    const s = slots.get(id)
    if (!s) return
    s.busy -= 1
    const next = s.waiting.shift()
    if (next) next()
    else if (s.busy === 0) slots.delete(id)
  }

  /** A short connection of its own for one action (never the watching one), closed when done, at most 60 s. */
  const withImap = async <T>(id: string, info: MailInfo, pass: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> => {
    await acquire(id)
    const client = imapClient(info, pass)
    let timer: NodeJS.Timeout | undefined
    try {
      const work = client.connect().then(() => fn(client))
      work.catch(() => {})
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ACTION_TIMEOUT' })), ACTION_MS)
      })
      return await Promise.race([work, late])
    } catch (error) {
      throw plain(error)
    } finally {
      clearTimeout(timer)
      await closeClient(client)
      release(id)
    }
  }

  /** The mail a ref names, checked to be this account's. */
  const target = (ref: Ref, device: Device): Target => {
    if (!('event' in ref)) return ref
    const row = d.lookup(ref.event)
    const data = (row?.data ?? {}) as Partial<MailData>
    if (!row || row.type !== 'mail' || row.deviceId !== device.id || data.account !== device.id) throw new ApiFailure(400, 'bad-request', 'That is not a mail from this account.')
    if (typeof data.folder !== 'string' || typeof data.uid !== 'number' || typeof data.uidValidity !== 'string') throw new ApiFailure(400, 'bad-request', 'That is not a mail from this account.')
    return { folder: data.folder, uid: data.uid, uidValidity: data.uidValidity, event: row }
  }

  /** Opens the mail's folder and checks the mailbox is the one the ref was made in. */
  const open = async (c: ImapFlow, t: Place, readOnly: boolean): Promise<void> => {
    let box
    try {
      box = await c.mailboxOpen(t.folder, { readOnly })
    } catch (error) {
      if (c.usable && classify(error) === 'other') throw new ApiFailure(404, 'not-found', MOVED)
      throw error
    }
    if (String(box.uidValidity) !== t.uidValidity) throw new ApiFailure(404, 'not-found', MOVED)
  }

  const fetchOne = async (c: ImapFlow, t: Place, query: Parameters<ImapFlow['fetchOne']>[1]): Promise<FetchMessageObject> => {
    const m = await c.fetchOne(String(t.uid), { ...query, uid: true }, { uid: true })
    if (!m) throw new ApiFailure(404, 'not-found', MOVED)
    return m
  }

  /**
   * How an approval names the mail: by its sender and subject when the hub has it, else by where it is. The sender and
   * subject are someone else's words: no line breaks, controls or direction overrides, so they cannot add lines.
   */
  const what = (ref: Ref, device?: Device): string => {
    if ('event' in ref) {
      const row = d.lookup(ref.event)
      if (row && row.type === 'mail' && row.deviceId === device?.id) return `the mail from ${oneLine(row.who ?? row.whoKey ?? 'an unknown sender')} "${oneLine(row.title ?? '')}"`
      return `mail ${ref.event}`
    }
    return `message ${ref.uid} in ${ref.folder}`
  }

  const describeMail = (question: string, a: Compose, device?: Device): string => {
    const lines = [`${question} ${accountName(device)}?`, `To: ${a.to.join(', ')}`]
    if (a.cc?.length) lines.push(`Cc: ${a.cc.join(', ')}`)
    if (a.bcc?.length) lines.push(`Bcc: ${a.bcc.join(', ')}`)
    lines.push(`Subject: ${a.subject}`)
    if (a.replyTo) lines.push(`In reply to: ${what(a.replyTo, device).replace(/^the mail from /, '')}`)
    return `${lines.join('\n')}\n\n${a.text}`
  }

  /** The original's Message-ID, for a reply's threading headers. */
  const originalId = async (c: ImapFlow | null, t: Target): Promise<string | undefined> => {
    const known = t.event?.data.messageId
    if (typeof known === 'string') return MESSAGE_ID.test(known) ? known : undefined
    if (!c) return undefined
    await open(c, t, true)
    const m = await fetchOne(c, t, { envelope: true })
    const id = m.envelope?.messageId
    return id && MESSAGE_ID.test(id) ? id : undefined
  }

  const outgoing = (info: MailInfo, a: Compose, inReplyTo?: string): Outgoing => ({
    from: info.address,
    to: a.to,
    ...(a.cc ? { cc: a.cc } : {}),
    ...(a.bcc ? { bcc: a.bcc } : {}),
    subject: a.subject,
    text: a.text,
    ...(inReplyTo ? { inReplyTo } : {}),
  })

  /**
   * Moves a mail to a folder found by `find`; never deletes for good. A server with neither MOVE nor UIDPLUS could only
   * do it with a plain EXPUNGE, which would also remove every other mail marked deleted there, so it is refused.
   */
  const move = async (args: { ref: Ref }, device: Device | undefined, find: (c: ImapFlow, info: MailInfo) => Promise<string | undefined>, none: string, already: string) => {
    const { device: dev, info, pass } = need(device)
    const t = target(args.ref, dev)
    return withImap(dev.id, info, pass, async c => {
      if (!c.capabilities.has('MOVE') && !c.capabilities.has('UIDPLUS'))
        throw new ApiFailure(409, 'unavailable', 'This mail server cannot move one mail safely, so Mini Hub will not archive or delete here. Do it in your mail app.')
      const dest = await find(c, info)
      if (!dest) throw new ApiFailure(404, 'not-found', none)
      if (dest === t.folder) throw new ApiFailure(400, 'bad-request', already)
      await open(c, t, false)
      await fetchOne(c, t, {})
      await c.messageMove(String(t.uid), dest, { uid: true })
      return { moved: true, folder: dest }
    })
  }

  return {
    manifest: {
      id: 'mail',
      name: 'Mail account',
      kind: 'account',
      icon: 'mail',
      scopes: ['mail.read', 'mail.change', 'mail.send'],
      eventTypes: ['mail'],
      widgets: ['mail'],
      multiple: true,
    },

    async start(c) {
      ctx = c
      unsubscribe = c.grants.onChange(reconcile)
      reconcile()
    },

    async stop() {
      unsubscribe?.()
      unsubscribe = null
      await Promise.all([...accounts.values()].map(a => a.stop()))
      accounts.clear()
    },

    health() {
      const list = own()
      if (list.length === 0) return { state: 'off', note: 'No mail account is added.' }
      const collected = list.filter(x => ctx?.grants.collecting(x.id, 'mail.read'))
      const failing = collected.filter(x => {
        const a = accounts.get(x.id)
        return !a || a.note !== undefined
      })
      if (failing.length === 0) return { state: 'ok' }
      const note = failing.length === 1 ? (accounts.get(failing[0].id)?.note ?? BROKEN) : `${failing.length} mail accounts have a problem.`
      return { state: failing.length === collected.length ? 'down' : 'degraded', note }
    },

    setup,

    async remove(id) {
      const a = accounts.get(id)
      accounts.delete(id)
      if (a) await a.stop()
      if (!ctx) return
      ctx.secrets.delete(passwordName(id))
      ctx.settings.set({ accounts: { [id]: undefined } })
    },

    actions: {
      search: {
        title: 'Search mail',
        scope: 'mail.read',
        risk: 'read',
        args: ARGS.search,
        run: async (raw, device, how) => {
          const a = raw as SearchArgs
          const { device: dev, info, pass } = need(device)
          return withImap(dev.id, info, pass, async c => {
            let folder = 'INBOX'
            if (a.folder === 'all') folder = (await findFolder(c, '\\All')) ?? 'INBOX'
            if (a.folder === 'sent') {
              const sent = await findFolder(c, '\\Sent', SENT)
              if (!sent) throw new ApiFailure(404, 'not-found', 'This account has no Sent folder.')
              folder = sent
            }
            const box = await c.mailboxOpen(folder, { readOnly: true })
            const q: SearchObject = {}
            if (a.text !== undefined) q.text = a.text
            if (a.from !== undefined) q.from = a.from
            if (a.since !== undefined) q.since = a.since
            if (a.before !== undefined) q.before = a.before
            const uids = await c.search(q, { uid: true })
            const top = (Array.isArray(uids) ? uids : []).sort((x, y) => y - x).slice(0, a.limit ?? SEARCH_LIMIT)
            if (top.length === 0) return { items: [] }
            const found = new Map<number, FetchMessageObject>()
            for await (const m of c.fetch(top.join(','), { uid: true, envelope: true, bodyStructure: true, internalDate: true, flags: true }, { uid: true })) found.set(m.uid, m)
            const uidValidity = String(box.uidValidity)
            return {
              items: top.flatMap(uid => {
                const m = found.get(uid)
                if (!m) return []
                const [subject] = forCaller(how, cut(m.envelope?.subject ?? '', 300))
                return [
                  {
                    ref: { folder, uid, uidValidity },
                    from: addressLine(firstSender(m.envelope)),
                    subject,
                    date: new Date(dateOf(m.internalDate, m.envelope, Date.now())).toISOString(),
                    unread: !(m.flags?.has('\\Seen') ?? false),
                    hasAttachments: attachmentsOf(m.bodyStructure).hasAttachments,
                  },
                ]
              }),
            }
          })
        },
      },

      read: {
        title: 'Read a mail',
        scope: 'mail.read',
        risk: 'read',
        args: ARGS.read,
        run: async (raw, device, how) => {
          const { ref } = raw as { ref: Ref }
          const { device: dev, info, pass } = need(device)
          const t = target(ref, dev)
          return withImap(dev.id, info, pass, async c => {
            await open(c, t, true)
            const m = await fetchOne(c, t, { envelope: true, bodyStructure: true, internalDate: true, flags: true })
            const env = m.envelope
            const [subject, text] = forCaller(how, env?.subject ?? '', cut(await messageText(c, m.uid, m.bodyStructure), READ_CHARS))
            return {
              from: addressLine(firstSender(env)),
              to: (env?.to ?? []).slice(0, 50).map(addressLine),
              cc: (env?.cc ?? []).slice(0, 50).map(addressLine),
              date: new Date(dateOf(m.internalDate, env, Date.now())).toISOString(),
              subject,
              text,
              attachments: attachmentsOf(m.bodyStructure).attachments,
            }
          })
        },
      },

      mark: {
        title: 'Mark a mail',
        scope: 'mail.change',
        risk: 'act',
        args: ARGS.mark,
        describe: (raw, device) => {
          const a = raw as MarkArgs
          const how = [
            ...(a.read === undefined ? [] : [a.read ? 'as read' : 'as unread']),
            ...(a.flagged === undefined ? [] : [a.flagged ? 'flagged' : 'not flagged']),
          ].join(' and ')
          return `In ${accountName(device)}: mark ${what(a.ref, device)} ${how}`
        },
        run: async (raw, device) => {
          const a = raw as MarkArgs
          const { device: dev, info, pass } = need(device)
          const t = target(a.ref, dev)
          return withImap(dev.id, info, pass, async c => {
            await open(c, t, false)
            await fetchOne(c, t, {})
            const uid = String(t.uid)
            if (a.read === true) await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
            if (a.read === false) await c.messageFlagsRemove(uid, ['\\Seen'], { uid: true })
            if (a.flagged === true) await c.messageFlagsAdd(uid, ['\\Flagged'], { uid: true })
            if (a.flagged === false) await c.messageFlagsRemove(uid, ['\\Flagged'], { uid: true })
            return { marked: true }
          })
        },
      },

      draft: {
        title: 'Save a draft',
        scope: 'mail.change',
        risk: 'act',
        args: ARGS.draft,
        describe: (raw, device) => describeMail('Save this draft in', raw as Compose, device),
        run: async (raw, device) => {
          const a = raw as Compose
          const { device: dev, info, pass } = need(device)
          const t = a.replyTo ? target(a.replyTo, dev) : undefined
          return withImap(dev.id, info, pass, async c => {
            const drafts = await findFolder(c, '\\Drafts', DRAFTS)
            if (!drafts) throw new ApiFailure(404, 'not-found', 'This account has no Drafts folder.')
            const inReplyTo = t ? await originalId(c, t) : undefined
            const bytes = await buildMessage(outgoing(info, a, inReplyTo), newMessageId(info.address), new Date())
            await c.append(drafts, bytes, ['\\Draft', '\\Seen'])
            return { saved: true, folder: drafts }
          })
        },
      },

      archive: {
        title: 'Archive a mail',
        scope: 'mail.change',
        risk: 'act',
        args: ARGS.archive,
        describe: (raw, device) => `In ${accountName(device)}: archive ${what((raw as { ref: Ref }).ref, device)}`,
        run: (raw, device) =>
          move(
            raw as { ref: Ref },
            device,
            // Gmail archives by taking the inbox label off: a move to All Mail.
            (c, info) => findFolder(c, info.provider === 'gmail' ? '\\All' : '\\Archive'),
            'This account has no archive folder.',
            'That mail is already archived.',
          ).then(r => ({ archived: true, folder: r.folder })),
      },

      delete: {
        title: 'Move a mail to the bin',
        scope: 'mail.change',
        risk: 'important',
        args: ARGS.delete,
        describe: (raw, device) => `In ${accountName(device)}: move ${what((raw as { ref: Ref }).ref, device)} to the bin`,
        run: (raw, device) =>
          move(raw as { ref: Ref }, device, c => findFolder(c, '\\Trash'), 'This account has no bin folder.', 'That mail is already in the bin.').then(r => ({
            deleted: true,
            folder: r.folder,
          })),
      },

      send: {
        title: 'Send a mail',
        scope: 'mail.send',
        risk: 'important',
        args: ARGS.send,
        describe: (raw, device) => describeMail('Send this mail from', raw as Compose, device),
        run: async (raw, device) => {
          const a = raw as Compose
          const { device: dev, info, pass } = need(device)
          const t = a.replyTo ? target(a.replyTo, dev) : undefined
          // The original is found before anything is sent: a reply to a mail that moved is not sent at all.
          const inReplyTo = t ? ((await originalId(null, t)) ?? (await withImap(dev.id, info, pass, c => originalId(c, t)))) : undefined
          const m = outgoing(info, a, inReplyTo)
          const messageId = newMessageId(info.address)
          const date = new Date()
          try {
            await sendMessage(info, pass, m, messageId, date)
          } catch (error) {
            throw new ApiFailure(502, 'unavailable', sendFailure(error))
          }
          if (savesSentItself(info.provider)) return { sent: true, messageId }
          // Another provider: the same message is kept in Sent, read.
          try {
            const bytes = await buildMessage(m, messageId, date)
            await withImap(dev.id, info, pass, async c => {
              const sent = await findFolder(c, '\\Sent', SENT)
              if (!sent) throw new Error('no sent folder')
              await c.append(sent, bytes, ['\\Seen'], date)
            })
            return { sent: true, messageId }
          } catch {
            ctx?.log.warn({ connector: 'mail', device: dev.id }, 'a sent mail could not be copied to Sent')
            return { sent: true, messageId, note: 'Sent, but the copy could not be saved in Sent.' }
          }
        },
      },

      check: {
        title: 'Check for new mail',
        scope: 'mail.read',
        risk: 'read',
        args: ARGS.check,
        personOnly: true,
        run: async (_raw, device) => {
          if (!ctx || !device || device.connectorId !== 'mail') throw new ApiFailure(400, 'bad-request', 'Add a mail account first.')
          const dev = device
          if (!ctx.grants.collecting(dev.id, 'mail.read'))
            throw new ApiFailure(409, 'not-allowed', 'Reading mail is not collected, so nothing is checked. Turn it on in Permissions.', 'mail.read')
          const a = accounts.get(dev.id)
          if (!a?.connected) throw new ApiFailure(503, 'unavailable', a?.note ?? NOTES.unreachable)
          try {
            return { new: await a.check() }
          } catch (error) {
            throw plain(error)
          }
        },
      },
    },
  }
}


// Sending over SMTP and building a message (docs/06 > mail > Drafts and Sent). The message is exactly what the approval
// showed: the account's address as From with no display name, the recipients, subject and text as given, and only the
// threading headers added for a reply. Nothing is appended (no signature, no quoted original).

import { randomUUID } from 'node:crypto'
import { createTransport } from 'nodemailer'
import { CONNECT_MS, classify } from './imap.ts'
import type { MailInfo } from './providers.ts'

/** One SMTP exchange takes at most this long. */
export const SMTP_MS = 30_000

export type Outgoing = { from: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; inReplyTo?: string }

/** A new Message-ID on the account's own domain. */
export const newMessageId = (from: string): string => `<${randomUUID()}@${from.slice(from.lastIndexOf('@') + 1)}>`

const fields = (m: Outgoing, messageId: string, date: Date) => ({
  from: m.from,
  to: m.to,
  ...(m.cc?.length ? { cc: m.cc } : {}),
  ...(m.bcc?.length ? { bcc: m.bcc } : {}),
  subject: m.subject,
  text: m.text,
  messageId,
  date,
  ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.inReplyTo } : {}),
  // Text only: nothing in a message can make the hub read a file or fetch a URL.
  disableFileAccess: true,
  disableUrlAccess: true,
})

/** The message as RFC 822 bytes, for a draft or the copy in Sent. Bcc is kept, as mail programs keep it there. */
export async function buildMessage(m: Outgoing, messageId: string, date: Date): Promise<Buffer> {
  const t = createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
  const info = await t.sendMail(fields(m, messageId, date))
  return info.message as Buffer
}

const smtpTransport = (info: MailInfo, pass: string) => {
  const { host, port, security } = info.smtp
  return createTransport({
    host,
    port,
    secure: security === 'tls',
    requireTLS: security === 'starttls',
    auth: { user: info.username, pass },
    logger: false,
    tls: { rejectUnauthorized: true },
    connectionTimeout: CONNECT_MS,
    greetingTimeout: CONNECT_MS,
    socketTimeout: SMTP_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ACTION_TIMEOUT' })), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/** Sends over SMTP. Bcc goes in the envelope only, never in the headers the recipients see. */
export async function sendMessage(info: MailInfo, pass: string, m: Outgoing, messageId: string, date: Date): Promise<void> {
  const t = smtpTransport(info, pass)
  try {
    await withTimeout(t.sendMail(fields(m, messageId, date)), SMTP_MS)
  } finally {
    t.close()
  }
}

/** Signs in to the SMTP server and says nothing more (the setup's check). */
export async function verifySmtp(info: MailInfo, pass: string): Promise<void> {
  const t = smtpTransport(info, pass)
  try {
    await withTimeout(t.verify(), SMTP_MS)
  } finally {
    t.close()
  }
}

/** Why SMTP did not send, in plain words; never the server's own answer. */
export function sendFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const why =
    code === 'EENVELOPE'
      ? 'it refused the sender or a recipient'
      : code === 'EMESSAGE'
        ? 'it refused the message'
        : {
            auth: 'it refused the password',
            tls: 'its certificate could not be checked',
            timeout: 'it did not answer in time, so the mail may not have gone',
            network: 'Mini Hub could not reach it',
            other: 'it refused, for a reason Mini Hub does not know',
          }[classify(error)]
  return `The mail server did not send it: ${why}.`
}

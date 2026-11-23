// The mail providers the setup knows (docs/06 > mail). Gmail and Outlook fill in their servers; "other" asks for them.

export type Security = 'tls' | 'starttls'
export type Server = { host: string; port: number; security: Security }
export type ProviderId = 'gmail' | 'outlook' | 'other'

/** What a mail device keeps in its `info`. Never a password: that lives only in the encrypted secrets table. */
export type MailInfo = { address: string; provider: ProviderId; username: string; imap: Server; smtp: Server }

export const PROVIDER_IDS = ['gmail', 'outlook', 'other'] as const

/** The servers of the providers that have fixed ones. Both save sent mail themselves. */
export const KNOWN: Record<'gmail' | 'outlook', { imap: Server; smtp: Server }> = {
  gmail: { imap: { host: 'imap.gmail.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' } },
  outlook: { imap: { host: 'outlook.office365.com', port: 993, security: 'tls' }, smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' } },
}

/** What the "servers" form starts with for another provider. */
export const OTHER_DEFAULTS: { imap: Server; smtp: Server } = {
  imap: { host: '', port: 993, security: 'tls' },
  smtp: { host: '', port: 465, security: 'tls' },
}

/** Gmail and Outlook keep a copy of what is sent over SMTP; for any other provider the hub appends it to Sent. */
export const savesSentItself = (p: ProviderId): boolean => p !== 'other'

const isServer = (v: unknown): v is Server => {
  const s = v as Server
  return typeof s === 'object' && s !== null && typeof s.host === 'string' && Number.isInteger(s.port) && (s.security === 'tls' || s.security === 'starttls')
}

/** A device's info as a mail account's, or undefined when it is not one (a device made by hand, or an old one). */
export const mailInfo = (info: Record<string, unknown>): MailInfo | undefined => {
  const i = info as Partial<MailInfo>
  if (typeof i.address !== 'string' || typeof i.username !== 'string') return undefined
  if (!PROVIDER_IDS.includes(i.provider as ProviderId) || !isServer(i.imap) || !isServer(i.smtp)) return undefined
  return i as MailInfo
}

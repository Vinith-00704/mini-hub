// The "Add a mail account" wizard (docs/06 > mail > Setup). What is typed is held in this run only; the password is
// checked against the servers and then kept only in the encrypted secrets table. Cancelling, running out of time or
// failing drops it. Nothing typed here is logged.

import { randomBytes } from 'node:crypto'
import type { Ctx, Field, SetupStep } from '../types.ts'
import { NOTES, passwordName } from './account.ts'
import { classify, closeClient, imapClient } from './imap.ts'
import { KNOWN, mailInfo, OTHER_DEFAULTS, PROVIDER_IDS, type MailInfo, type ProviderId, type Security, type Server } from './providers.ts'
import { isAddress } from './refs.ts'
import { verifySmtp } from './send.ts'

type Run = {
  /** Set when the run changes the password of an account already added. */
  deviceId?: string
  provider: ProviderId
  address: string
  name: string
  username?: string
  imap?: Server
  smtp?: Server
  password?: string
}

const HOST = /^[A-Za-z0-9.-]{1,253}$/
const MAX_NAME = 60

const PASSWORD_TEXT: Record<ProviderId, string> = {
  gmail:
    'Gmail needs an app password: 16 letters made for Mini Hub. Turn on 2-Step Verification in your Google account, open myaccount.google.com/apppasswords, make one called Mini Hub and paste it here. Mini Hub keeps it in its encrypted database and never shows it again.',
  outlook:
    "Use an app password from your Microsoft account's security page (Advanced security options > App passwords). Microsoft no longer accepts app passwords for some accounts; if the check below fails at sign-in, this version of Mini Hub cannot connect that account. Mini Hub keeps the password in its encrypted database and never shows it again.",
  other: 'Use the app password, or the mail password, your provider gives for IMAP and SMTP. Mini Hub keeps it in its encrypted database and never shows it again.',
}

const SECURITY_CHOICES = [
  { value: 'tls', label: 'TLS' },
  { value: 'starttls', label: 'STARTTLS' },
]

const fieldsOf = (input: unknown): Record<string, unknown> => (typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const port = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : /^\d{1,5}$/.test(str(v).trim()) ? Number(str(v).trim()) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined
}

const accountForm = (v: { provider?: string; address?: string; name?: string } = {}, error?: string): SetupStep => ({
  kind: 'form',
  id: 'account',
  title: 'Add a mail account',
  text: 'Mini Hub reads this account over IMAP and sends over SMTP, using an app password. Nothing goes anywhere else.',
  fields: [
    {
      name: 'provider',
      label: 'Provider',
      kind: 'choice',
      required: true,
      ...(v.provider ? { value: v.provider } : {}),
      choices: [
        { value: 'gmail', label: 'Gmail' },
        { value: 'outlook', label: 'Outlook.com or Microsoft 365' },
        { value: 'other', label: 'Another provider' },
      ],
    },
    { name: 'address', label: 'Address', kind: 'email', required: true, ...(v.address ? { value: v.address } : {}) },
    {
      name: 'name',
      label: 'Name in Mini Hub',
      kind: 'text',
      required: false,
      hint: 'For example Work mail. The address is used if this is empty.',
      ...(v.name ? { value: v.name } : {}),
    },
  ],
  ...(error ? { error } : {}),
})

type ServerValues = { imapHost: string; imapPort: string | number; imapSecurity: string; smtpHost: string; smtpPort: string | number; smtpSecurity: string; username: string }

const serversForm = (v: ServerValues, error?: string): SetupStep => {
  const f = (name: keyof ServerValues, label: string, kind: Field['kind'], extra: Partial<Field> = {}): Field => ({
    name,
    label,
    kind,
    required: true,
    ...(v[name] !== '' ? { value: v[name] } : {}),
    ...extra,
  })
  return {
    kind: 'form',
    id: 'servers',
    title: 'Mail servers',
    text: "Your provider's IMAP server (for reading) and SMTP server (for sending). Mini Hub only uses encrypted connections.",
    fields: [
      f('imapHost', 'IMAP server', 'text', { hint: 'For example imap.example.com' }),
      f('imapPort', 'IMAP port', 'number'),
      f('imapSecurity', 'IMAP security', 'choice', { choices: SECURITY_CHOICES }),
      f('smtpHost', 'SMTP server', 'text'),
      f('smtpPort', 'SMTP port', 'number'),
      f('smtpSecurity', 'SMTP security', 'choice', { choices: SECURITY_CHOICES }),
      f('username', 'User name', 'text', { hint: 'Usually the address.' }),
    ],
    ...(error ? { error } : {}),
  }
}

const passwordForm = (provider: ProviderId, error?: string): SetupStep => ({
  kind: 'form',
  id: 'password',
  title: 'App password',
  text: PASSWORD_TEXT[provider],
  fields: [{ name: 'password', label: 'App password', kind: 'password', required: true }],
  ...(error ? { error } : {}),
})

const WORDS = {
  auth: 'The mail server did not accept that address and password.',
  network: (host: string) => `Mini Hub could not reach ${host}. Check the server name and that this PC is online.`,
  tls: "The server's certificate could not be checked, so Mini Hub did not send the password.",
  smtp: 'Reading works, but sending did not: the SMTP server refused. Check its settings.',
  other: 'The check did not work. Try again.',
}

/** Signs in over IMAP (the inbox opened read-only, the folders listed), then over SMTP. A plain error, or undefined. */
async function check(info: MailInfo, pass: string): Promise<string | undefined> {
  const client = imapClient(info, pass)
  try {
    await client.connect()
    await client.mailboxOpen('INBOX', { readOnly: true })
    await client.list()
  } catch (error) {
    const f = classify(error)
    return f === 'auth' ? WORDS.auth : f === 'network' || f === 'timeout' ? WORDS.network(info.imap.host) : f === 'tls' ? WORDS.tls : WORDS.other
  } finally {
    await closeClient(client)
  }
  try {
    await verifySmtp(info, pass)
  } catch (error) {
    const f = classify(error)
    return f === 'network' || f === 'timeout' ? WORDS.network(info.smtp.host) : f === 'tls' ? WORDS.tls : WORDS.smtp
  }
  return undefined
}

export type SetupDeps = {
  /** The account's password changed or it was just added: start (again) watching it if its switch is on. */
  saved: (deviceId: string) => void
}

export function mailSetup(deps: SetupDeps) {
  const runs = new Map<string, Run>()

  const sameAddress = (ctx: Ctx, address: string, except?: string): boolean =>
    ctx.devices
      .list()
      .some(d => d.connectorId === 'mail' && d.id !== except && typeof d.info.address === 'string' && d.info.address.toLowerCase() === address.toLowerCase())

  const infoOf = (r: Run): MailInfo | undefined =>
    r.username && r.imap && r.smtp ? { address: r.address, provider: r.provider, username: r.username, imap: r.imap, smtp: r.smtp } : undefined

  const startAgain: SetupStep = { kind: 'error', text: 'This setup took too long. Start again.' }

  return async function setup(ctx: Ctx, session: string, step: string | null, input: unknown): Promise<SetupStep> {
    const v = fieldsOf(input)

    if (step === 'cancel') {
      // Whatever was typed goes, the password first. A second cancel finds nothing.
      runs.delete(session)
      return { kind: 'error', text: 'Cancelled.' }
    }

    if (step === null) {
      runs.delete(session)
      const device = typeof v.device === 'string' ? ctx.devices.get(v.device) : undefined
      const info = device?.connectorId === 'mail' ? mailInfo(device.info) : undefined
      if (device && info) {
        runs.set(session, { deviceId: device.id, ...info, name: device.name })
        return passwordForm(info.provider)
      }
      runs.set(session, { provider: 'gmail', address: '', name: '' })
      return accountForm()
    }

    const run = runs.get(session)
    if (!run) return startAgain

    if (step === 'account' && run.deviceId === undefined) {
      const provider = str(v.provider)
      const address = str(v.address).trim()
      const name = str(v.name).trim()
      const typed = { provider, address, name }
      if (!PROVIDER_IDS.includes(provider as ProviderId)) return accountForm(typed, 'Choose a provider.')
      if (!isAddress(address)) return accountForm(typed, 'That does not look like a mail address.')
      if (name.length > MAX_NAME) return accountForm(typed, `Keep the name to ${MAX_NAME} characters or fewer.`)
      if (sameAddress(ctx, address)) return accountForm(typed, 'This account is already added.')
      const p = provider as ProviderId
      Object.assign(run, { provider: p, address, name, username: address, password: undefined })
      if (p === 'other') {
        Object.assign(run, { imap: undefined, smtp: undefined })
        const d = OTHER_DEFAULTS
        return serversForm({ imapHost: '', imapPort: d.imap.port, imapSecurity: d.imap.security, smtpHost: '', smtpPort: d.smtp.port, smtpSecurity: d.smtp.security, username: address })
      }
      Object.assign(run, { imap: KNOWN[p].imap, smtp: KNOWN[p].smtp })
      return passwordForm(p)
    }

    if (step === 'servers' && run.deviceId === undefined && run.provider === 'other' && run.address) {
      const typed: ServerValues = {
        imapHost: str(v.imapHost).trim(),
        imapPort: str(v.imapPort).trim(),
        imapSecurity: str(v.imapSecurity),
        smtpHost: str(v.smtpHost).trim(),
        smtpPort: str(v.smtpPort).trim(),
        smtpSecurity: str(v.smtpSecurity),
        username: str(v.username).trim() || run.address,
      }
      if (!HOST.test(typed.imapHost) || !HOST.test(typed.smtpHost)) return serversForm(typed, 'Check the server names: letters, digits, dots and hyphens only.')
      const imapPort = port(v.imapPort)
      const smtpPort = port(v.smtpPort)
      if (imapPort === undefined || smtpPort === undefined) return serversForm(typed, 'A port is a whole number from 1 to 65535.')
      const security = (s: string): s is Security => s === 'tls' || s === 'starttls'
      if (!security(typed.imapSecurity) || !security(typed.smtpSecurity)) return serversForm(typed, 'Choose TLS or STARTTLS for each server.')
      if (typed.username.length > 254 || /[\x00-\x1f\x7f]/.test(typed.username)) return serversForm(typed, 'Check the user name.')
      Object.assign(run, {
        username: typed.username,
        imap: { host: typed.imapHost, port: imapPort, security: typed.imapSecurity },
        smtp: { host: typed.smtpHost, port: smtpPort, security: typed.smtpSecurity },
        password: undefined,
      })
      return passwordForm('other')
    }

    const info = infoOf(run)
    if (step === 'password' && info) {
      const typed = str(v.password)
      const pass = run.provider === 'gmail' ? typed.replace(/\s+/g, '') : typed
      if (!pass) return passwordForm(run.provider, 'Enter the app password.')
      if (pass.length > 512) return passwordForm(run.provider, WORDS.auth)
      run.password = pass
      const problem = await check(info, pass)
      // A failed check keeps nothing: the form asks for the password again.
      if (problem) {
        run.password = undefined
        return passwordForm(run.provider, problem)
      }
      // Cancelled, or out of time, while the servers were being asked: nothing is saved.
      if (runs.get(session) !== run) return startAgain
      runs.delete(session)
      if (run.deviceId !== undefined && !ctx.devices.get(run.deviceId)) return { kind: 'error', text: 'This account was removed. Add it again.' }
      if (run.deviceId === undefined && sameAddress(ctx, info.address)) return { kind: 'error', text: 'This account is already added.' }
      const id = run.deviceId ?? `mail-${randomBytes(6).toString('hex')}`
      ctx.secrets.set(passwordName(id), pass)
      run.password = undefined
      ctx.devices.upsert({
        id,
        connectorId: 'mail',
        kind: 'mail-account',
        name: run.name || info.address,
        info,
        ...(run.deviceId === undefined ? { state: { online: false, watching: false, note: NOTES.off } } : {}),
      })
      // Its place in the inbox starts again: mail is read from the moment watching starts.
      ctx.settings.set({ accounts: { [id]: {} } })
      deps.saved(id)
      return { kind: 'done', devices: [id] }
    }

    return { kind: 'error', text: 'That step is not part of this setup. Start again.' }
  }
}

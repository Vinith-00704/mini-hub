// One mail account's page (docs/07 > Devices): whether it is being watched, what it shares, what Mini may do with it, a
// manual check, its recent mail, and Remove. Its password is never shown, only that it is set; changing it runs the
// setup again.

import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useEvents, useGrants, useSettings, type Device, type GrantRow } from '../../app/queries.ts'
import { runAction } from '../../app/tickets.ts'
import { ago, Dot, Masked, Time } from '../../components/ui/bits.tsx'
import { Button, Munch, Row } from '../../components/look/index.ts'
import { Tile } from '../../components/ui/Tile.tsx'
import { GrantRowItem } from '../permissions/Permissions.tsx'
import { visible } from '../../components/look/plainText.tsx'
import { Remove } from './Remove.tsx'
import { SetupWizard } from './SetupWizard.tsx'

const PROVIDERS: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook.com or Microsoft 365', other: 'Another provider' }
const SECURITY: Record<string, string> = { tls: 'TLS', starttls: 'STARTTLS' }

/** "imap.example.com:993 · TLS", or nothing when the account has no such server recorded. */
const server = (v: unknown): string | undefined => {
  const s = v as { host?: unknown; port?: unknown; security?: unknown } | undefined
  if (typeof s?.host !== 'string' || typeof s.port !== 'number') return undefined
  return `${s.host}:${s.port} · ${SECURITY[String(s.security)] ?? String(s.security).toUpperCase()}`
}

function Fact({ name, value }: { name: string; value?: string | undefined }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-micro text-ink-3">{name}</dt>
      <dd className="tabular text-body break-words">{value}</dd>
    </div>
  )
}

/** Asks the account to look for new mail now, and says how many came or why not. */
function CheckMail({ id }: { id: string }) {
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setText('')
    try {
      const t = await runAction({ connector: 'mail', device: id, name: 'check' })
      setFailed(!(t.done && t.ok))
      setText(!t.done ? 'The mail server did not answer.' : t.ok ? `${typeof t.data?.new === 'number' ? t.data.new : 0} new` : (t.error ?? 'The check did not work.'))
    } catch (e) {
      setFailed(true)
      setText((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="sm" onClick={() => void run()} disabled={busy}>
        Check now
      </Button>
      {busy && <Munch width={180} label="Checking with the mail server" />}
      {text && (
        <span role="status" className={`text-small ${failed ? 'text-danger' : 'text-ink-2'}`}>
          {text}
        </span>
      )}
    </div>
  )
}

/** The last 8 mails from this account, with a way into the Inbox for the rest. */
function RecentMail({ id }: { id: string }) {
  const events = useEvents({ device: id, type: 'mail', limit: '8' })
  const privacy = useSettings().data?.privacy === true
  const items = events.data?.items ?? []
  return (
    <Tile
      title="Recent mail"
      state={events.isPending ? 'loading' : events.isError ? 'error' : items.length ? 'ready' : 'empty'}
      emptyText="No mail from this account yet. Mail is collected from the moment Reading mail is turned on."
      {...(events.error ? { error: events.error.message } : {})}
      onRetry={() => void events.refetch()}
      action={
        <a href={`#/inbox?kind=mail&device=${encodeURIComponent(id)}`} className="lk-label text-[11px] text-ink-2 hover:text-ink">
          All in Inbox →
        </a>
      }
    >
      <ul className="flex flex-col">
        {items.map(e => (
          <Row
            key={e.id}
            icon={<Mail aria-hidden size={14} />}
            accent={!e.seenAt}
            title={visible(e.who ?? 'Unknown')}
            detail={
              <span className={privacy ? 'privacy-blur block' : 'block'} dir="auto">
                <Masked text={visible(e.title ?? '(no subject)')} />
              </span>
            }
            time={<Time at={e.occurredAt} />}
            onClick={() => (window.location.hash = `#/inbox?kind=mail&item=${e.id}&device=${encodeURIComponent(id)}`)}
          />
        ))}
      </ul>
    </Tile>
  )
}

export function MailAccountPage({ device: d, isNew = false }: { device: Device; isNew?: boolean }) {
  const grants = useGrants()
  const [note, setNote] = useState('')
  const [changing, setChanging] = useState(false)
  const rows = (grants.data?.items ?? []).filter((r: GrantRow) => r.target === d.id)
  const row = (scope: string) => rows.find(r => r.scope === scope)
  const reading = row('mail.read')
  const watching = d.state.watching === true
  const problem = typeof d.state.note === 'string' ? d.state.note : ''
  const info = d.info ?? {}
  const address = typeof info.address === 'string' ? info.address : undefined
  const provider = typeof info.provider === 'string' ? (PROVIDERS[info.provider] ?? info.provider) : undefined
  const checked = typeof d.state.lastCheckAt === 'number' ? d.state.lastCheckAt : undefined

  if (changing)
    return (
      <div className="flex max-w-4xl flex-col gap-3">
        <h2 className="text-[28px] font-black break-words uppercase">{d.name}</h2>
        <SetupWizard connector="mail" device={d.id} onClose={() => setChanging(false)} />
      </div>
    )

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <h2 className="text-[28px] font-black break-words uppercase">{d.name}</h2>
      {isNew && (
        <p className="lk-drop border-2 border-accent bg-card px-3 py-2 text-body">
          Added. <span className="font-semibold">What should this account share?</span> Everything starts off; turn on only what you want.
        </p>
      )}

      <Tile title="Status">
        <Dot tone={watching ? 'ok' : reading?.collect ? 'warn' : 'muted'} label={watching ? 'Watching for new mail' : problem || 'Not watching'} />
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          <Fact name="Address" value={address} />
          <Fact name="Provider" value={provider} />
          <Fact name="Reading (IMAP)" value={server(info.imap)} />
          <Fact name="Sending (SMTP)" value={server(info.smtp)} />
          <Fact name="Last check" value={checked ? (ago(checked) === 'now' ? 'Just now' : `${ago(checked)} ago`) : 'Not yet'} />
          <Fact name="App password" value="Set" />
        </dl>
        <div className="mt-4">
          <Button size="sm" onClick={() => setChanging(true)}>
            Change the app password
          </Button>
        </div>
      </Tile>

      {note && (
        <p role="status" className="rounded-control border border-line bg-surface px-3 py-2 text-small">
          {note}
        </p>
      )}
      <Tile
        title="What it shares"
        state={grants.isPending ? 'loading' : grants.isError ? 'error' : reading ? 'ready' : 'empty'}
        emptyText="Nothing to share is listed for this account."
        {...(grants.error ? { error: grants.error.message } : {})}
        onRetry={() => void grants.refetch()}
        action={<span className="w-20 text-center text-micro text-ink-3">Collect</span>}
      >
        {reading && (
          <ul>
            <GrantRowItem row={reading} onNote={setNote} part="collect" />
          </ul>
        )}
        <p className="text-small text-ink-3">Mail is collected from the moment this is turned on. Older mail stays on the mail server, and Mini can look it up there when you allow it.</p>
      </Tile>

      <Tile
        title="What Mini may do"
        state={grants.isPending ? 'loading' : grants.isError ? 'error' : rows.length ? 'ready' : 'empty'}
        emptyText="Nothing is listed for this account."
        {...(grants.error ? { error: grants.error.message } : {})}
        onRetry={() => void grants.refetch()}
        action={<span className="w-[118px] text-center text-micro text-ink-3">Mini may use</span>}
      >
        <ul>
          {['mail.read', 'mail.change', 'mail.send'].flatMap(scope => {
            const r = row(scope)
            return r ? [<GrantRowItem key={scope} row={r} onNote={setNote} part="mini" />] : []
          })}
        </ul>
        <p className="text-small text-ink-3">Sending always asks first, with the whole mail shown, every time.</p>
      </Tile>

      <Tile title="Check now">
        <CheckMail id={d.id} />
      </Tile>

      <RecentMail id={d.id} />

      <Tile title="Remove">
        <Remove
          id={d.id}
          name={d.name}
          button="Remove this account"
          message="Remove {name}? Mini Hub stops reading it and forgets its password."
          tick="Also delete its mail from Mini Hub"
        />
      </Tile>
    </div>
  )
}

// One phone's page (docs/07 > Devices): its status, what it shares and what Mini may do with it, the phone's own two
// lists as it last reported them (set on the phone, never here), a manual status check, and Remove.

import { useState } from 'react'
import { Bell, MessageSquare, Phone } from 'lucide-react'
import { useDevice, useEvents, useGrants, useSettings, type EventRow, type GrantRow } from '../../app/queries.ts'
import { ago, Dot, Masked, Time } from '../../components/ui/bits.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { GrantRowItem } from '../permissions/Permissions.tsx'
import { battery, isOnline, network, presence } from './facts.ts'
import { CheckNow } from './CheckNow.tsx'
import { MailAccountPage } from './MailAccountPage.tsx'
import { Remove } from './Remove.tsx'
import { Gauge, Row, Tag } from '../../components/look/index.ts'
import { chatWho, notificationText } from '../../widgets/list.tsx'

function Fact({ name, value }: { name: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex flex-col">
      <dt className="text-micro text-ink-3">{name}</dt>
      <dd className="tabular text-body">{value}</dd>
    </div>
  )
}

/** Whether Mini on this phone is awake, from the phone's last state frame: nothing when it has not said. */
export const miniOnPhone = (state: Record<string, unknown>, online: boolean): string | undefined => {
  // An offline phone may have woken or slept since: say nothing of "awake", and mark the rest as its last report.
  if (!online && state.stopped !== true && state.brain === 'ok') return undefined
  const line = miniOnPhoneNow(state)
  return line && !online ? `${line} This is from its last report.` : line
}

const miniOnPhoneNow = (state: Record<string, unknown>): string | undefined => {
  if (state.stopped === true) return 'Mini is stopped on this phone. It is started again on the phone.'
  if (state.brain === 'ok') return 'Mini on this phone is awake.'
  if (state.brain === 'asleep') return 'Mini on this phone is asleep.'
  if (state.brain === 'broken') return 'Claude Code on this phone is not working. The phone keeps recording.'
  return undefined
}

const RECENT_TYPES = ['call', 'sms', 'chat', 'notification']

const recentIcon = (type: string) => (type === 'call' ? <Phone aria-hidden size={14} /> : type === 'notification' ? <Bell aria-hidden size={14} /> : <MessageSquare aria-hidden size={14} />)

/** One line of what this phone sent: who (or which app), and what. */
const recentLine = (e: EventRow): { who: string; text: string } => {
  if (e.type === 'notification') return { who: e.app ?? 'Notification', text: notificationText(e) }
  if (e.type === 'call') return { who: e.who ?? 'Unknown', text: e.title ?? (e.data.direction === 'missed' ? 'Missed call' : 'Call') }
  return { who: chatWho(e), text: e.body ?? e.title ?? '' }
}

/** The last few calls, messages and notifications from this phone, with a way into the Inbox for the rest. */
function RecentFromPhone({ id }: { id: string }) {
  const events = useEvents({ device: id, type: RECENT_TYPES, limit: '8' })
  const privacy = useSettings().data?.privacy === true
  const items = events.data?.items ?? []
  return (
    <Tile
      title="Recent from this phone"
      state={events.isPending ? 'loading' : events.isError ? 'error' : items.length ? 'ready' : 'empty'}
      emptyText="Nothing from this phone yet."
      {...(events.error ? { error: events.error.message } : {})}
      onRetry={() => void events.refetch()}
      action={
        <a href={`#/inbox?device=${encodeURIComponent(id)}`} className="lk-label text-[11px] text-ink-2 hover:text-ink">
          All in Inbox →
        </a>
      }
    >
      <ul className="flex flex-col">
        {items.map(e => {
          const l = recentLine(e)
          return (
            <Row
              key={e.id}
              icon={recentIcon(e.type)}
              accent={!e.seenAt}
              title={l.who}
              detail={
                <span className={privacy ? 'privacy-blur block' : 'block'}>
                  <Masked text={l.text} />
                </span>
              }
              time={<Time at={e.occurredAt} />}
            />
          )
        })}
      </ul>
    </Tile>
  )
}

export function DevicePage({ id, isNew = false }: { id: string; isNew?: boolean }) {
  const device = useDevice(id)
  const grants = useGrants()
  const [note, setNote] = useState('')
  const d = device.data
  if (device.isPending) return <Tile title="Phone" state="loading" />
  if (device.isError || !d) return <Tile title="Phone" state="error" error={device.error?.message ?? 'There is no such device.'} onRetry={() => void device.refetch()} />
  if (d.kind === 'mail-account') return <MailAccountPage device={d} isNew={isNew} />
  const rows = (grants.data?.items ?? []).filter((r: GrantRow) => r.target === id)
  const reported = rows.some(r => r.phone)
  const miniLine = miniOnPhone(d.state, isOnline(d))
  const version = typeof d.state.appVersion === 'string' ? d.state.appVersion : typeof d.info?.appVersion === 'string' ? d.info.appVersion : undefined

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <h2 className="text-[28px] font-black break-words uppercase">{d.name}</h2>
      {isNew && (
        <p className="lk-drop border-2 border-accent bg-card px-3 py-2 text-body">
          Paired. <span className="font-semibold">What should this phone share?</span> Everything starts off; turn on only what you want.
        </p>
      )}

      <Tile title="Status" tag={<Tag tone={isOnline(d) ? 'ok' : 'muted'} pill>{isOnline(d) ? '● Linked' : presence(d)}</Tag>}>
        <div className="flex flex-wrap items-center gap-6">
        <Gauge value={typeof d.state.battery === 'number' ? d.state.battery : null} label="Battery" {...(d.state.charging === true ? { tag: 'Charging' } : {})} />
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col">
            <dt className="text-micro text-ink-3">Link</dt>
            <dd>
              <Dot tone={isOnline(d) ? 'ok' : 'muted'} label={presence(d)} />
            </dd>
          </div>
          <Fact name="Network" value={network(d)} />
          <Fact name="Last sync" value={d.lastSeenAt ? `${ago(d.lastSeenAt)} ago` : undefined} />
          <Fact name="App version" value={version} />
        </dl>
        </div>
        {miniLine && <p className="mt-3 text-body">{miniLine}</p>}
        {!isOnline(d) && <p className="mt-3 text-small text-ink-3">The phone links when it is on your home Wi-Fi. What it records meanwhile arrives then.</p>}
        <div className="mt-4">
          <CheckNow id={id} />
        </div>
      </Tile>

      {note && (
        <p role="status" className="rounded-control border border-line bg-surface px-3 py-2 text-small">
          {note}
        </p>
      )}
      <Tile
        title="What it shares, and what Mini may do with it"
        state={grants.isPending ? 'loading' : 'ready'}
        action={
          <span className="flex gap-4 text-micro text-ink-3">
            <span className="w-20 text-center">Collect</span>
            <span className="w-[118px] text-center">Mini may use</span>
          </span>
        }
      >
        <ul>
          {rows.map(r => (
            <GrantRowItem key={r.scope} row={r} onNote={setNote} />
          ))}
        </ul>
      </Tile>

      <RecentFromPhone id={id} />

      <Tile title="Set on the phone" action={<span className="text-micro text-ink-3">as the phone last reported</span>}>
        {reported ? (
          <ul>
            {rows.map(r => (
              <li key={r.scope} className="flex min-h-[var(--row)] flex-wrap items-center gap-x-4 border-b border-line/60 py-1.5 last:border-0">
                <span className="min-w-0 flex-1 text-body">{r.label}</span>
                <span className="text-small text-ink-2">Mini on this phone: {r.phone?.mini ?? 'off'}</span>
                <span className="text-small text-ink-2">From my PC: {r.phone?.pc ?? 'off'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-ink-3">Not reported yet. These show once the phone links.</p>
        )}
        <p className="mt-2 text-small text-ink-3">The phone's own switches always win. Change them in the Mini app, under Permissions.</p>
      </Tile>

      <Tile title="Remove">
        <Remove id={id} name={d.name} button="Remove this phone" message="Remove {name}? It stops syncing at once. To use it again you pair it again." tick="Also delete what it sent" />
      </Tile>
    </div>
  )
}

// The shared shape of the list tiles: a few recent events, one line each, newest first. A kind that nothing sends yet
// says so ("Not connected yet") rather than showing an empty box.

import type { ReactNode } from 'react'
import { useDevices, useEvents, useGrants, useSettings, type EventRow, type Device } from '../app/queries.ts'
import { Line, Masked, Time } from '../components/ui/bits.tsx'
import { Button, Row, Tag, Window, type PartState } from '../components/look/index.ts'
import { needLine } from '../features/permissions/Permissions.tsx'

export const NOTHING_YET = 'Nothing yet. Turn on what to collect in Permissions.'

/** The sender, and for a chat in a group or a named conversation, where: "Asha Example · Family". */
export const chatWho = (e: EventRow): string => {
  const sender = e.who ?? 'Unknown'
  const conversation = typeof e.data.conversation === 'string' ? e.data.conversation : ''
  return conversation && conversation !== sender ? `${sender} · ${conversation}` : sender
}

/** A notification's words: "title: body" when it has both and they differ, else whichever it has. */
export const notificationText = (e: EventRow): string =>
  e.title && e.body && e.title !== e.body ? `${e.title}: ${e.body}` : (e.body ?? e.title ?? '')

/** The app a message came from, as the Messages tile and its settings name it: "SMS" for a text message. */
export const messageApp = (e: EventRow): string => (e.type === 'sms' ? 'SMS' : (e.app ?? 'Chat'))

/** The app a notification came from, as the Notifications tile and its settings name it. */
export const notificationApp = (e: EventRow): string => e.app ?? 'Notification'

/** Fetched, then filtered by `keep`: this many are looked through to find the ones that stay. */
const LOOK_THROUGH = 50

export function EventList({
  title,
  types,
  limit = 6,
  device,
  unseenOnly = false,
  keep,
  inbox,
  scope,
  label,
  notConnected,
  icon,
  line,
}: {
  title: string
  types: string[]
  limit?: number
  /** Only this device's (or mail account's) events. */
  device?: string
  /** Only what has not been seen. */
  unseenOnly?: boolean
  /** Which of the fetched events stay (applied to up to 50 of the newest, then cut to `limit`). */
  keep?: (e: EventRow) => boolean
  /** The Inbox filter this tile opens. */
  inbox: string
  /** The permission that lets this kind be collected (docs/03 > Scopes), and its words: "Call history". */
  scope: string
  label: string
  /** When nothing of this kind has come in: why, and what it needs. */
  notConnected?: string
  icon: ReactNode
  line: (e: EventRow) => { who: string; text: string; tone?: 'warn' | 'muted'; tag?: ReactNode }
}) {
  const events = useEvents({ type: types, limit: String(keep ? LOOK_THROUGH : limit), ...(device ? { device } : {}), ...(unseenOnly ? { unseen: 'true' } : {}) })
  const privacy = useSettings().data?.privacy === true
  const grants = useGrants()
  const devices = useDevices()
  const fetched = events.data?.items ?? []
  const items = (keep ? fetched.filter(keep) : fetched).slice(0, limit)

  // What to say when nothing has come in: from the switches (Permissions) and what each phone says it still needs.
  let state: PartState = events.isPending ? 'loading' : events.isError ? 'error' : 'ready'
  let emptyText = unseenOnly ? 'Nothing unseen.' : 'Nothing yet.'
  if (state === 'ready' && items.length === 0 && fetched.length > 0) {
    // Things came in, but this tile's settings leave them all out.
    state = 'empty'
    emptyText = "Nothing matches this tile's settings."
  } else if (state === 'ready' && items.length === 0) {
    const rows = (grants.data?.items ?? []).filter(g => g.scope === scope)
    if (grants.isPending) state = 'loading'
    else if (grants.isError) state = notConnected ? 'not-connected' : 'empty'
    else if (rows.length === 0) state = notConnected ? 'not-connected' : 'empty'
    else if (rows.every(r => !r.collect)) {
      state = 'not-allowed'
      emptyText = `${label} is not collected. Turn it on in Permissions.`
    } else {
      state = 'empty'
      const phones: Device[] = rows.filter(r => r.collect).flatMap(r => devices.data?.items.find(d => d.id === r.target) ?? [])
      emptyText = phones.map(d => needLine(d, scope)).find(Boolean) ?? emptyText
    }
  }
  return (
    <Window
      title={title}
      state={state}
      emptyText={emptyText}
      {...(state === 'not-allowed'
        ? {
            emptyAction: (
              <a href="#/permissions">
                <Button size="sm">Open Permissions</Button>
              </a>
            ),
          }
        : {})}
      {...(notConnected ? { notConnected } : {})}
      tag={items.length ? <Tag>{items.length >= limit ? `${limit}+` : items.length} latest</Tag> : undefined}
      action={
        <a href={`#/inbox?kind=${inbox}`} className="lk-label text-[11px] text-ink-2 hover:text-ink">
          All →
        </a>
      }
      {...(events.error ? { error: events.error.message } : {})}
      onRetry={() => void events.refetch()}
    >
      <ul className="flex flex-col">
        {items.map(e => {
          const l = line(e)
          return (
            <Row
              key={e.id}
              icon={icon}
              accent={!e.seenAt}
              title={<Line text={l.who} className={l.tone === 'warn' ? 'text-warn' : ''} />}
              detail={
                <span className={privacy ? 'privacy-blur block' : 'block'}>
                  <Masked text={l.text} />
                </span>
              }
              time={<Time at={e.occurredAt} />}
              trailing={l.tag}
              onClick={() => (window.location.hash = `#/inbox?kind=${inbox}&item=${e.id}`)}
            />
          )
        })}
      </ul>
    </Window>
  )
}

// The shared shape of the list tiles: a few recent events, one line each, newest first.

import type { ReactNode } from 'react'
import { useEvents, useSettings, type EventRow } from '../app/queries.ts'
import { Line, Masked, Time } from '../components/ui/bits.tsx'
import { Tile } from '../components/ui/Tile.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Link } from './link.tsx'

export const NOTHING_YET = 'Nothing yet. Turn on what to collect in Permissions.'

export function EventList({
  title,
  types,
  limit = 6,
  line,
}: {
  title: string
  types: string[]
  limit?: number
  line: (e: EventRow) => { who: string; text: string; tone?: 'warn' | 'muted'; tag?: ReactNode }
}) {
  const events = useEvents({ type: types, limit: String(limit) })
  const privacy = useSettings().data?.privacy === true
  const items = events.data?.items ?? []
  const state = events.isPending ? 'loading' : events.isError ? 'error' : items.length ? 'ready' : 'empty'
  return (
    <Tile
      title={title}
      state={state}
      emptyText={NOTHING_YET}
      emptyAction={
        <Link to="/permissions">
          <Button size="sm">Open Permissions</Button>
        </Link>
      }
      {...(events.error ? { error: events.error.message } : {})}
      onRetry={() => void events.refetch()}
    >
      <ul className="flex flex-col">
        {items.map(e => {
          const l = line(e)
          return (
            <li key={e.id} className="flex h-[var(--row)] min-w-0 items-center gap-3 border-b border-line/60 last:border-0">
              <span className={`w-28 shrink-0 ${l.tone === 'warn' ? 'text-warn' : 'text-ink'}`}>
                <Line text={l.who} className="text-body font-medium" />
              </span>
              <span className={`min-w-0 flex-1 text-small text-ink-2 ${privacy ? 'privacy-blur' : ''}`}>
                <Masked text={l.text} />
              </span>
              {l.tag}
              <Time at={e.occurredAt} />
            </li>
          )
        })}
      </ul>
    </Tile>
  )
}

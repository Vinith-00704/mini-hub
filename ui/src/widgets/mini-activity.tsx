// What Mini did lately, everywhere, with how each ended.

import { useEvents } from '../app/queries.ts'
import { Chip, Line, Time } from '../components/ui/bits.tsx'
import { Tile } from '../components/ui/Tile.tsx'

export function MiniActivityTile() {
  const events = useEvents({ type: 'mini_action', limit: '6' })
  const items = events.data?.items ?? []
  return (
    <Tile
      title="What Mini did"
      state={events.isPending ? 'loading' : events.isError ? 'error' : items.length ? 'ready' : 'empty'}
      emptyText="Mini has not done anything yet."
      {...(events.error ? { error: events.error.message } : {})}
      onRetry={() => void events.refetch()}
    >
      <ul className="flex flex-col">
        {items.map(e => {
          const refused = e.data.outcome === 'refused'
          return (
            <li key={e.id} className="flex h-[var(--row)] min-w-0 items-center gap-3 border-b border-line/60 last:border-0">
              <Time at={e.occurredAt} />
              <Line text={e.title ?? ''} className="flex-1 text-small" />
              <Chip tone={refused ? 'muted' : 'ok'}>{refused ? 'not allowed' : 'done'}</Chip>
            </li>
          )
        })}
      </ul>
    </Tile>
  )
}

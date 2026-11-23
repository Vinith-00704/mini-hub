// Counts since midnight: what came in, what Mini did, and what is waiting for the owner. The tile's settings choose which.

import { Fragment } from 'react'
import { useHubState, useStats } from '../app/queries.ts'
import { Tile } from '../components/ui/Tile.tsx'
import { todayCounts, type TileProps } from './settings.ts'

function Count({ n, label, tone }: { n: number; label: string; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <div className={`tabular text-display font-semibold ${tone === 'warn' && n > 0 ? 'text-warn' : 'text-ink'}`}>{n}</div>
      <div className="truncate text-small text-ink-2">{label}</div>
    </div>
  )
}

export function TodayTile({ settings = {} }: TileProps) {
  const state = useHubState()
  const shown = todayCounts(settings)
  const stats = useStats(7, shown.includes('mini'))
  const t = state.data?.today ?? {}
  const numbers = {
    calls: <Count n={t.call ?? 0} label="calls" />,
    messages: <Count n={(t.sms ?? 0) + (t.chat ?? 0)} label="messages" />,
    mail: <Count n={t.mail ?? 0} label="mails" />,
    waiting: <Count n={state.data?.approvalsWaiting ?? 0} label="need you" tone="warn" />,
    mini: <Count n={stats.data?.today.miniDid ?? 0} label="Mini did" />,
  }
  // Mini's number comes from its own fetch; it is waited for only when the tile shows it.
  const wanted = shown.includes('mini') ? [state, stats] : [state]
  const pending = wanted.some(q => q.isPending)
  const failed = wanted.find(q => q.isError)
  return (
    <Tile
      title="Today"
      state={pending ? 'loading' : failed ? 'error' : 'ready'}
      {...(failed?.error ? { error: failed.error.message } : {})}
      onRetry={() => wanted.forEach(q => void q.refetch())}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-4">
        {shown.map(id => (
          <Fragment key={id}>{numbers[id]}</Fragment>
        ))}
      </div>
    </Tile>
  )
}

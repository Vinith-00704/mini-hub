// Counts since midnight: what came in, and what is waiting for the owner.

import { useHubState } from '../app/queries.ts'
import { Tile } from '../components/ui/Tile.tsx'

function Count({ n, label, tone }: { n: number; label: string; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <div className={`tabular text-display font-semibold ${tone === 'warn' && n > 0 ? 'text-warn' : 'text-ink'}`}>{n}</div>
      <div className="truncate text-small text-ink-2">{label}</div>
    </div>
  )
}

export function TodayTile() {
  const state = useHubState()
  const t = state.data?.today ?? {}
  return (
    <Tile title="Today" state={state.isPending ? 'loading' : state.isError ? 'error' : 'ready'} {...(state.error ? { error: state.error.message } : {})} onRetry={() => void state.refetch()}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Count n={t.call ?? 0} label="calls" />
        <Count n={(t.sms ?? 0) + (t.chat ?? 0)} label="messages" />
        <Count n={t.mail ?? 0} label="mails" />
        <Count n={state.data?.approvalsWaiting ?? 0} label="need you" tone="warn" />
      </div>
    </Tile>
  )
}

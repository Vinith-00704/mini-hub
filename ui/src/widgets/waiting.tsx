// What is waiting for the owner's yes or no, on the board too (the cards at the bottom right show the same).

import { useApprovals } from '../app/queries.ts'
import { Tag, Window } from '../components/look/index.ts'
import { ApprovalCard } from '../features/frame/ApprovalCards.tsx'

export function WaitingTile() {
  const approvals = useApprovals()
  const waiting = (approvals.data?.approvals ?? []).filter(a => a.state === 'waiting' && a.expiresAt > Date.now())
  return (
    <Window
      title="Waiting for you"
      tag={<Tag tone={waiting.length ? 'warn' : 'muted'}>{waiting.length}</Tag>}
      state={approvals.isPending ? 'loading' : approvals.isError ? 'error' : waiting.length ? 'ready' : 'empty'}
      emptyText="Nothing is waiting for you."
      {...(approvals.error ? { error: approvals.error.message } : {})}
      onRetry={() => void approvals.refetch()}
    >
      <div className="flex flex-col gap-4">
        {waiting.slice(0, 2).map(a => (
          <ApprovalCard key={a.id} a={a} compact />
        ))}
        {waiting.length > 2 && <p className="text-micro text-ink-3">{waiting.length - 2} more at the bottom right.</p>}
      </div>
    </Window>
  )
}

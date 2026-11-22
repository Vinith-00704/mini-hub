// When Mini needs a yes, a card waits at the bottom right of every screen with exactly what will happen.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { post } from '../../app/api.ts'
import { useApprovals, type Approval } from '../../app/queries.ts'
import { Button } from '../../components/ui/Button.tsx'

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.round((until - now) / 1000))
  return <span className="tabular text-micro text-ink-3">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

function Card({ a }: { a: Approval }) {
  const client = useQueryClient()
  const answer = useMutation({
    mutationFn: (decision: 'yes' | 'no') => post(`/v1/approvals/${a.id}`, { decision }),
    onSettled: () => client.invalidateQueries({ queryKey: ['approvals'] }),
  })
  return (
    <div role="alertdialog" aria-label="Mini asks" className="rise w-80 rounded-panel border border-line-strong bg-surface p-4 shadow-2xl">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-micro text-ink-3">Mini asks</span>
        <Countdown until={a.expiresAt} />
      </div>
      <p className="mb-1 text-body font-medium break-words">{a.summary}</p>
      {a.risk === 'important' && <p className="mb-3 text-micro text-warn">This kind of thing always asks first.</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => answer.mutate('no')} disabled={answer.isPending}>
          No
        </Button>
        <Button variant="primary" onClick={() => answer.mutate('yes')} disabled={answer.isPending}>
          Yes
        </Button>
      </div>
      {answer.error && <p className="mt-2 text-micro text-danger">{answer.error.message}</p>}
    </div>
  )
}

export function ApprovalCards() {
  const { data } = useApprovals()
  const waiting = (data?.approvals ?? []).filter(a => a.state === 'waiting' && a.expiresAt > Date.now())
  if (!waiting.length) return null
  return (
    <div aria-live="assertive" className="fixed right-5 bottom-5 z-50 flex flex-col gap-3">
      {waiting.map(a => (
        <Card key={a.id} a={a} />
      ))}
    </div>
  )
}

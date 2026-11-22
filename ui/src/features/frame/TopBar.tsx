// The bar above every screen: its title, a box to ask Mini, what is waiting, the devices, and Stop.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Octagon, Search } from 'lucide-react'
import { useState } from 'react'
import { post } from '../../app/api.ts'
import { useHubState } from '../../app/queries.ts'
import { Button } from '../../components/ui/Button.tsx'

export function TopBar({ title }: { title: string }) {
  const client = useQueryClient()
  const state = useHubState()
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const stop = useMutation({ mutationFn: () => post('/v1/stop'), onSettled: () => client.invalidateQueries({ queryKey: ['state'] }) })
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setText(''), setNote('Sent to Mini'), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote(e.message),
  })
  const waiting = state.data?.approvalsWaiting ?? 0
  const devices = state.data?.devices ?? []

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-5">
      <h1 className="min-w-0 truncate text-title font-semibold">{title}</h1>
      <form
        className="ml-auto flex h-8 w-full max-w-md items-center gap-2 rounded-control border border-line bg-surface-2 px-2.5 focus-within:border-line-strong"
        onSubmit={e => {
          e.preventDefault()
          if (text.trim()) ask.mutate(text.trim())
        }}
      >
        <Search aria-hidden size={15} className="shrink-0 text-ink-3" />
        <input
          value={text}
          onChange={e => (setText(e.target.value), setNote(''))}
          placeholder="Ask Mini"
          aria-label="Ask Mini"
          className="min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-3 focus:outline-none"
        />
        {note && <span className="shrink-0 text-micro text-ink-3">{note}</span>}
      </form>
      <span className="flex shrink-0 items-center gap-3 text-small text-ink-2">
        <span title={waiting ? `${waiting} waiting for your answer` : 'Nothing waiting'} className={waiting ? 'text-warn' : ''}>
          {waiting ? `${waiting} waiting` : ''}
        </span>
        <span className="flex items-center gap-1" aria-label={`${devices.length} devices`}>
          {devices.map(d => (
            <span key={d.id} title={`${d.name}: ${d.state.online ? 'online' : 'away'}`} className={`h-2 w-2 rounded-full ${d.state.online ? 'bg-ok' : 'bg-ink-3'}`} />
          ))}
        </span>
      </span>
      <Button variant="danger" aria-label="Stop Mini" onClick={() => stop.mutate()} disabled={stop.isPending}>
        <Octagon aria-hidden size={15} />
        Stop
      </Button>
    </header>
  )
}

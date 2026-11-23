// The right side of the top bar: the command box (ask Mini or search), what is waiting, dark or light, and Stop (always visible).

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Moon, Square, Sun } from 'lucide-react'
import { useState } from 'react'
import { ApiFailure, patch, post } from '../../app/api.ts'
import { useApprovals, useHubState, useSettings } from '../../app/queries.ts'
import { Button } from '../../components/look/index.ts'
import { CommandBox } from './CommandBox.tsx'
import { applyLook } from './look.ts'

const iconBtn = 'relative flex h-[34px] w-[34px] items-center justify-center border-2 border-ink bg-card shadow-[3px_3px_0_var(--shadow)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_var(--shadow)]'

/** Whether the page shows dark right now (the setting may be "follow Windows"). */
const showingDark = () => document.documentElement.dataset.theme !== 'light'

export function TopBar({ onBell }: { title?: string; onBell?: () => void }) {
  const client = useQueryClient()
  const state = useHubState()
  const settings = useSettings().data
  const approvals = useApprovals().data
  const [note, setNote] = useState<{ text: string; offerStart?: boolean } | null>(null)
  const stop = useMutation({
    mutationFn: () => post('/v1/stop'),
    onSettled: () => client.invalidateQueries({ queryKey: ['state'] }),
    onError: (e: Error) => setNote({ text: `Stop did not reach the hub: ${e.message}` }),
  })
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setNote({ text: 'Sent to Mini. The reply is on the Mini screen.' }), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote({ text: e.message, offerStart: e instanceof ApiFailure && e.status === 503 }),
  })
  const start = useMutation({
    mutationFn: () => post('/v1/mini/start'),
    onSuccess: () => (setNote({ text: 'Starting Mini…' }), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote({ text: e.message }),
  })
  const theme = useMutation({
    mutationFn: (next: 'dark' | 'light') => patch('/v1/settings', { theme: next }),
    onMutate: next => applyLook({ ...(settings ?? {}), theme: next }),
    onError: (e: Error) => (applyLook(settings ?? {}), setNote({ text: `The look was not saved: ${e.message}` })),
    onSettled: () => client.invalidateQueries({ queryKey: ['settings'] }),
  })
  const waiting = (approvals?.approvals ?? []).filter(a => a.state === 'waiting' && a.expiresAt > Date.now()).length || state.data?.approvalsWaiting || 0
  const dark = typeof document !== 'undefined' ? showingDark() : true

  return (
    <div className="flex min-w-[340px] flex-[1_1_340px] items-center gap-3">
      <div className="relative flex min-w-40 flex-1">
        <CommandBox onAsk={t => ask.mutateAsync(t)} sending={ask.isPending} onEdit={() => setNote(null)} />
        {note && (
          <div role="status" className="lk-drop absolute top-[40px] right-0 left-0 z-40 flex items-center gap-3 border-2 border-ink bg-card px-3 py-2 text-small shadow-[4px_4px_0_var(--shadow)]">
            <span className="flex-1">{note.text}</span>
            {note.offerStart && (
              <Button size="sm" variant="primary" busy={start.isPending} onClick={() => start.mutate()}>
                Start Mini
              </Button>
            )}
            <button type="button" className="text-ink-3 hover:text-ink" aria-label="Close" onClick={() => setNote(null)}>
              ✕
            </button>
          </div>
        )}
      </div>
      <button type="button" className={iconBtn} aria-label={waiting ? `${waiting} waiting for your answer` : 'Nothing waiting'} title={waiting ? `${waiting} waiting for your answer` : 'Nothing waiting'} onClick={() => (waiting ? onBell?.() : setNote({ text: 'Nothing is waiting for you.' }))}>
        <Bell aria-hidden size={17} />
        {waiting > 0 && <span className="absolute -top-2 -right-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-[1.6px] border-ink bg-accent px-1 text-[10px] font-black text-on-accent">{waiting}</span>}
      </button>
      <button type="button" className={iconBtn} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'} onClick={() => theme.mutate(dark ? 'light' : 'dark')}>
        {dark ? <Sun aria-hidden size={17} /> : <Moon aria-hidden size={17} />}
      </button>
      <Button variant="stop" aria-label="Stop Mini" onClick={() => stop.mutate()} disabled={stop.isPending || state.data?.stopped}>
        <Square aria-hidden size={11} fill="currentColor" />
        Stop
      </Button>
    </div>
  )
}

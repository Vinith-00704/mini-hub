// Asks a phone for its status now (the android connector's `status` action) and shows what it said, or why not.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, post } from '../../app/api.ts'
import { Button, Munch } from '../../components/look/index.ts'

type Ticket = { done: boolean; ok?: boolean; data?: Record<string, unknown>; error?: string; waitingFor?: string }

export function CheckNow({ id, stretch = false }: { id: string; stretch?: boolean }) {
  const client = useQueryClient()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const run = async () => {
    setBusy(true)
    setText('')
    setAsking(false)
    try {
      const { ticket } = await post<{ ticket: string }>('/v1/actions', { connector: 'android', device: id, name: 'status', args: {} })
      let t: Ticket = { done: false }
      for (let i = 0; i < 80 && !t.done; i++) {
        t = await api<Ticket>(`/v1/tickets/${ticket}?wait=2000`)
        if (!t.done && t.waitingFor === 'phone') setAsking(true)
      }
      if (!t.done) setText('The phone did not answer.')
      else if (t.ok) {
        const d = t.data ?? {}
        setText(typeof d.battery === 'number' ? `The phone says ${d.battery}%${d.charging ? ', charging' : ''}${d.network ? `, ${d.network === 'wifi' ? 'Wi-Fi' : d.network}` : ''}.` : 'The phone answered.')
        void client.invalidateQueries({ queryKey: ['devices'] })
      } else setText(t.error ?? 'The phone did not answer.')
    } catch (e) {
      setText((e as Error).message)
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }
  return (
    <div className={`flex flex-col gap-2 ${stretch ? 'items-stretch' : 'items-start'}`}>
      <Button size="sm" onClick={() => void run()} disabled={busy}>
        Check status now
      </Button>
      {busy && <Munch width={180} label={asking ? 'Waiting for you to allow it on the phone' : 'Asking the phone'} />}
      {busy && asking && <span className="text-micro text-warn">Allow it on the phone, or it ends in 2 minutes.</span>}
      {text && (
        <span role="status" className="text-small text-ink-2">
          {text}
        </span>
      )}
    </div>
  )
}

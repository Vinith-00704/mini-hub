// One phone's page (docs/07 > Devices): its status, what it shares and what Mini may do with it, the phone's own two
// lists as it last reported them (set on the phone, never here), a manual status check, and Remove.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, del, post } from '../../app/api.ts'
import { useDevice, useGrants, type GrantRow } from '../../app/queries.ts'
import { ago, Dot } from '../../components/ui/bits.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { GrantRowItem } from '../permissions/Permissions.tsx'
import { battery, isOnline, network, presence } from './facts.ts'

type Ticket = { done: boolean; ok?: boolean; data?: Record<string, unknown>; error?: string }

function Fact({ name, value }: { name: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex flex-col">
      <dt className="text-micro text-ink-3">{name}</dt>
      <dd className="tabular text-body">{value}</dd>
    </div>
  )
}

function CheckNow({ id }: { id: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setText('Asking the phone…')
    try {
      const { ticket } = await post<{ ticket: string }>('/v1/actions', { connector: 'android', device: id, name: 'status', args: {} })
      let t: Ticket = { done: false }
      for (let i = 0; i < 80 && !t.done; i++) t = await api<Ticket>(`/v1/tickets/${ticket}?wait=2000`)
      if (!t.done) setText('The phone did not answer.')
      else if (t.ok) {
        const d = t.data ?? {}
        setText(typeof d.battery === 'number' ? `The phone says ${d.battery}%${d.charging ? ', charging' : ''}.` : 'The phone answered.')
      } else setText(t.error ?? 'The phone did not answer.')
    } catch (e) {
      setText((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void run()} disabled={busy}>
        Check status now
      </Button>
      {text && (
        <span role="status" className="text-small text-ink-2">
          {text}
        </span>
      )}
    </div>
  )
}

function Remove({ id, name }: { id: string; name: string }) {
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [alsoEvents, setAlsoEvents] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    try {
      await del(`/v1/devices/${encodeURIComponent(id)}`, { deleteEvents: alsoEvents })
      await client.invalidateQueries({ queryKey: ['devices'] })
      window.location.hash = '#/devices'
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (!asking)
    return (
      <Button variant="danger" onClick={() => setAsking(true)}>
        Remove this phone
      </Button>
    )
  return (
    <div className="flex flex-col items-start gap-3 rounded-control border border-danger/50 p-3">
      <p className="text-body">Remove {name}? It stops syncing at once. To use it again you pair it again.</p>
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" checked={alsoEvents} onChange={e => setAlsoEvents(e.target.checked)} />
        Also delete what it sent
      </label>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="danger" onClick={() => void remove()}>
          Remove
        </Button>
        <Button onClick={() => setAsking(false)}>Keep it</Button>
      </div>
    </div>
  )
}

export function DevicePage({ id, isNew = false }: { id: string; isNew?: boolean }) {
  const device = useDevice(id)
  const grants = useGrants()
  const [note, setNote] = useState('')
  const d = device.data
  if (device.isPending) return <Tile title="Phone" state="loading" />
  if (device.isError || !d) return <Tile title="Phone" state="error" error={device.error?.message ?? 'There is no such device.'} onRetry={() => void device.refetch()} />
  const rows = (grants.data?.items ?? []).filter((r: GrantRow) => r.target === id)
  const reported = rows.some(r => r.phone)
  const version = typeof d.state.appVersion === 'string' ? d.state.appVersion : typeof d.info?.appVersion === 'string' ? d.info.appVersion : undefined

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <h2 className="text-title font-semibold">{d.name}</h2>
      {isNew && (
        <p className="rounded-control border border-accent/50 bg-surface px-3 py-2 text-body">
          Paired. <span className="font-semibold">What should this phone share?</span> Everything starts off; turn on only what you want.
        </p>
      )}

      <Tile title="Status">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col">
            <dt className="text-micro text-ink-3">Link</dt>
            <dd>
              <Dot tone={isOnline(d) ? 'ok' : 'muted'} label={presence(d)} />
            </dd>
          </div>
          <Fact name="Battery" value={battery(d)} />
          <Fact name="Network" value={network(d)} />
          <Fact name="Last sync" value={d.lastSeenAt ? `${ago(d.lastSeenAt)} ago` : undefined} />
          <Fact name="App version" value={version} />
        </dl>
        {!isOnline(d) && <p className="mt-3 text-small text-ink-3">The phone links when it is on your home Wi-Fi. What it records meanwhile arrives then.</p>}
        <div className="mt-4">
          <CheckNow id={id} />
        </div>
      </Tile>

      {note && (
        <p role="status" className="rounded-control border border-line bg-surface px-3 py-2 text-small">
          {note}
        </p>
      )}
      <Tile
        title="What it shares, and what Mini may do with it"
        state={grants.isPending ? 'loading' : 'ready'}
        action={
          <span className="flex gap-4 text-micro text-ink-3">
            <span className="w-20 text-center">Collect</span>
            <span className="w-[118px] text-center">Mini may use</span>
          </span>
        }
      >
        <ul>
          {rows.map(r => (
            <GrantRowItem key={r.scope} row={r} onNote={setNote} />
          ))}
        </ul>
      </Tile>

      <Tile title="Set on the phone" action={<span className="text-micro text-ink-3">as the phone last reported</span>}>
        {reported ? (
          <ul>
            {rows.map(r => (
              <li key={r.scope} className="flex min-h-[var(--row)] flex-wrap items-center gap-x-4 border-b border-line/60 py-1.5 last:border-0">
                <span className="min-w-0 flex-1 text-body">{r.label}</span>
                <span className="text-small text-ink-2">Mini on this phone: {r.phone?.mini ?? 'off'}</span>
                <span className="text-small text-ink-2">From my PC: {r.phone?.pc ?? 'off'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-ink-3">Not reported yet. These show once the phone links.</p>
        )}
        <p className="mt-2 text-small text-ink-3">The phone's own switches always win. Change them in the Mini app, under Permissions.</p>
      </Tile>

      <Tile title="Remove">
        <Remove id={id} name={d.name} />
      </Tile>
    </div>
  )
}

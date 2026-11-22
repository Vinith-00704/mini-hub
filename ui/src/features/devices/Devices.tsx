// Every device the hub knows (docs/07 > Devices): Add device first, then one card each.

import { Mail, Monitor, Plus, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { useDevices, type Device } from '../../app/queries.ts'
import { ago, Dot } from '../../components/ui/bits.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { AddPhone } from './AddPhone.tsx'
import { battery, isOnline, presence } from './facts.ts'

const card = 'flex min-h-32 flex-col gap-2 rounded-tile border border-line bg-surface p-[var(--pad-tile)] shadow-[var(--shadow-tile)]'

function DeviceCard({ d }: { d: Device }) {
  const Icon = d.kind === 'phone' ? Smartphone : d.kind === 'mail-account' ? Mail : Monitor
  const b = battery(d)
  const body = (
    <>
      <span className="flex items-center gap-2">
        <Icon aria-hidden size={18} className="text-ink-2" />
        <span className="truncate text-head font-semibold">{d.name}</span>
      </span>
      <Dot tone={isOnline(d) ? 'ok' : 'muted'} label={presence(d)} />
      {b && <span className="tabular text-small text-ink-2">{b}</span>}
      {!isOnline(d) && d.lastSeenAt && <span className="text-small text-ink-3">Last seen {ago(d.lastSeenAt)} ago</span>}
    </>
  )
  // Only phones have a page of their own for now; this PC's settings are in Settings and Permissions.
  return d.kind === 'phone' ? (
    <a href={`#/devices/${d.id}`} className={`${card} hover:border-line-strong`}>
      {body}
    </a>
  ) : (
    <div className={card}>{body}</div>
  )
}

export function Devices() {
  const devices = useDevices()
  const [adding, setAdding] = useState(false)
  if (adding) return <AddPhone onClose={() => setAdding(false)} />
  return (
    <div className="flex flex-col gap-3">
      {devices.isError && <Tile title="Devices" state="error" error={devices.error.message} onRetry={() => void devices.refetch()} />}
      <ul className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-4">
        <li>
          <button type="button" onClick={() => setAdding(true)} className={`${card} w-full items-start justify-center border-dashed text-left hover:border-line-strong`}>
            <Plus aria-hidden size={18} className="text-accent" />
            <span className="text-head font-semibold">Add device</span>
            <span className="text-small text-ink-3">Pair your phone with this PC.</span>
          </button>
        </li>
        {(devices.data?.items ?? []).map(d => (
          <li key={d.id}>
            <DeviceCard d={d} />
          </li>
        ))}
      </ul>
    </div>
  )
}

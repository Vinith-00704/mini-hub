// Every device the hub knows (docs/07 > Devices): Add device first, then one card each.

import { Mail, Monitor, Plus, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDevices, type Device } from '../../app/queries.ts'
import { ago, Dot } from '../../components/ui/bits.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { AddDevice, addKindOf, type AddKind } from './AddDevice.tsx'
import { battery, isOnline, presence } from './facts.ts'

const card = 'flex min-h-32 flex-col gap-2 border-2 border-ink bg-card p-[var(--pad-tile)] shadow-[4px_4px_0_var(--shadow)]'

function DeviceCard({ d }: { d: Device }) {
  const Icon = d.kind === 'phone' ? Smartphone : d.kind === 'mail-account' ? Mail : Monitor
  const b = battery(d)
  const mail = d.kind === 'mail-account'
  const body = (
    <>
      <span className="flex items-center gap-2">
        <Icon aria-hidden size={18} className="text-ink-2" />
        <span className="truncate text-[14px] font-extrabold uppercase">{d.name}</span>
      </span>
      {mail ? (
        <Dot tone={d.state.watching === true ? 'ok' : 'muted'} label={d.state.watching === true ? 'Watching' : typeof d.state.note === 'string' && d.state.note ? d.state.note : 'Not watching'} />
      ) : (
        <Dot tone={isOnline(d) ? 'ok' : 'muted'} label={presence(d)} />
      )}
      {b && <span className="tabular text-small text-ink-2">{b}</span>}
      {!mail && !isOnline(d) && d.lastSeenAt && <span className="text-small text-ink-3">Last seen {ago(d.lastSeenAt)} ago</span>}
    </>
  )
  // Phones and mail accounts have a page of their own; this PC's settings are in Settings and Permissions.
  return d.kind === 'phone' || mail ? (
    <a href={`#/devices/${d.id}`} className={`${card} hover:bg-card-bar`}>
      {body}
    </a>
  ) : (
    <div className={card}>{body}</div>
  )
}

export function Devices() {
  const devices = useDevices()
  // "#/devices?add=1" (Home's Add device) opens the choice; "add=phone" and "add=mail" open that kind's steps.
  const [adding, setAdding] = useState<AddKind | null>(() => addKindOf(window.location.hash))
  // A link followed while this screen is already open (the command box's) opens it too.
  useEffect(() => {
    const open = () => {
      const kind = addKindOf(window.location.hash)
      if (kind) setAdding(kind)
    }
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])
  if (adding)
    return (
      <AddDevice
        key={adding}
        initial={adding}
        onClose={() => {
          setAdding(null)
          if (addKindOf(window.location.hash)) window.location.hash = '#/devices'
        }}
      />
    )
  return (
    <div className="flex flex-col gap-3">
      {devices.isError && <Tile title="Devices" state="error" error={devices.error.message} onRetry={() => void devices.refetch()} />}
      <ul className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-4">
        <li>
          <button type="button" onClick={() => setAdding('choose')} className={`${card} w-full items-start justify-center border-dashed text-left hover:bg-card-bar`}>
            <Plus aria-hidden size={18} className="text-accent" />
            <span className="text-[14px] font-extrabold uppercase">Add device</span>
            <span className="text-small text-ink-3">Pair a phone or add a mail account.</span>
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

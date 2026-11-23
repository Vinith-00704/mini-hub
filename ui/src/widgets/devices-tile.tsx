// The devices on the board: a small card each, and Add device.

import { Mail, Monitor, Smartphone } from 'lucide-react'
import { useDevices } from '../app/queries.ts'
import { Tag, Window } from '../components/look/index.ts'
import { battery, isOnline } from '../features/devices/facts.ts'

export function DevicesTile() {
  const devices = useDevices()
  const items = devices.data?.items ?? []
  return (
    <Window
      title="Devices"
      tag={<Tag>{items.length}</Tag>}
      state={devices.isPending ? 'loading' : devices.isError ? 'error' : 'ready'}
      {...(devices.error ? { error: devices.error.message } : {})}
      onRetry={() => void devices.refetch()}
    >
      <div className="grid grid-cols-2 gap-2">
        {items.slice(0, 4).map(d => {
          const Icon = d.kind === 'phone' ? Smartphone : d.kind === 'mail-account' ? Mail : Monitor
          const mail = d.kind === 'mail-account'
          const up = mail ? d.state.watching === true : isOnline(d)
          const inner = (
            <>
              <Icon aria-hidden size={18} />
              <span className="mt-1 block truncate text-[12px] font-extrabold uppercase">{d.name}</span>
              <span className={`block text-[11px] font-bold ${up ? 'text-ok' : 'text-ink-3'}`}>● {mail ? (up ? 'Watching' : 'Not watching') : up ? (battery(d) ?? 'Online') : 'Away'}</span>
            </>
          )
          return d.kind === 'phone' || mail ? (
            <a key={d.id} href={`#/devices/${d.id}`} className="min-w-0 border-2 border-ink p-2 hover:bg-card-bar">
              {inner}
            </a>
          ) : (
            <div key={d.id} className="min-w-0 border-2 border-ink p-2">
              {inner}
            </div>
          )
        })}
        <a href="#/devices?add=1" className="lk-dash col-span-2 h-10 text-[12px] font-extrabold tracking-[0.06em] hover:border-ink hover:text-ink">
          + ADD DEVICE
        </a>
      </div>
    </Window>
  )
}

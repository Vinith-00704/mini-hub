// One device at a glance: the first phone, or this PC when no phone is paired yet.

import { useHubState, type Device } from '../app/queries.ts'
import { ago, Dot, Line } from '../components/ui/bits.tsx'
import { Tile } from '../components/ui/Tile.tsx'
import { battery, isOnline, presence } from '../features/devices/facts.ts'

const facts = (d: Device): string[] => {
  const s = d.state as Record<string, number | boolean | undefined>
  const out: string[] = []
  const b = battery(d)
  if (b) out.push(b)
  if (typeof s.memoryFreeMb === 'number') out.push(`${(s.memoryFreeMb / 1024).toFixed(1)} GB memory free`)
  if (typeof s.diskFreeGb === 'number') out.push(`${s.diskFreeGb} GB disk free`)
  if (!isOnline(d) && d.lastSeenAt) out.push(`Last seen ${ago(d.lastSeenAt)} ago`)
  return out
}

export function DeviceStatusTile() {
  const state = useHubState()
  const devices = state.data?.devices ?? []
  const d = devices.find(x => x.kind === 'phone') ?? devices.find(x => x.kind === 'pc')
  return (
    <Tile
      title={d?.name ?? 'Devices'}
      state={state.isPending ? 'loading' : d ? 'ready' : 'empty'}
      emptyText="No devices yet."
      action={
        d?.kind === 'phone' ? (
          <a href={`#/devices/${d.id}`} className="text-small text-ink-2 hover:text-ink">
            Open
          </a>
        ) : undefined
      }
    >
      {d && (
        <div className="flex flex-col gap-2">
          <Dot tone={isOnline(d) ? 'ok' : 'muted'} label={presence(d)} />
          {facts(d).map(f => (
            <Line key={f} text={f} className="tabular text-small text-ink-2" />
          ))}
        </div>
      )}
    </Tile>
  )
}

// One device at a glance: the first phone, or this PC when no phone is paired yet.

import { useHubState, type Device } from '../app/queries.ts'
import { Dot, Line } from '../components/ui/bits.tsx'
import { Tile } from '../components/ui/Tile.tsx'

const facts = (d: Device): string[] => {
  const s = d.state as Record<string, number | boolean | undefined>
  const out: string[] = []
  if (typeof s.battery === 'number') out.push(`${s.battery}%${s.charging ? ', charging' : ''}`)
  if (typeof s.memoryFreeMb === 'number') out.push(`${(s.memoryFreeMb / 1024).toFixed(1)} GB memory free`)
  if (typeof s.diskFreeGb === 'number') out.push(`${s.diskFreeGb} GB disk free`)
  return out
}

export function DeviceStatusTile() {
  const state = useHubState()
  const devices = state.data?.devices ?? []
  const d = devices.find(x => x.kind === 'phone') ?? devices.find(x => x.kind === 'pc')
  return (
    <Tile title={d?.name ?? 'Devices'} state={state.isPending ? 'loading' : d ? 'ready' : 'empty'} emptyText="No devices yet.">
      {d && (
        <div className="flex flex-col gap-2">
          <Dot tone={d.state.online ? 'ok' : 'muted'} label={d.state.online ? 'Online' : 'Away'} />
          {facts(d).map(f => (
            <Line key={f} text={f} className="tabular text-small text-ink-2" />
          ))}
        </div>
      )}
    </Tile>
  )
}

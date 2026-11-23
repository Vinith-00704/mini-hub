// The phone at a glance: battery as a gauge, the link, the network and last sync, and Check status now.
// With no phone paired, the way to pair one. The tile can show this PC instead (its `device` setting).

import { useHubState, type Device } from '../app/queries.ts'
import { ago } from '../components/ui/bits.tsx'
import { Button, Gauge, Tag, Window } from '../components/look/index.ts'
import { CheckNow } from '../features/devices/CheckNow.tsx'
import { battery, isOnline, network, presence } from '../features/devices/facts.ts'
import { text, type TileProps } from './settings.ts'

/** The device a tile shows: the one chosen, if it is still there, else the first phone, else this PC. */
export const pickDevice = (devices: Device[], chosen: string): Device | undefined =>
  devices.find(x => x.id === chosen && (x.kind === 'phone' || x.kind === 'pc')) ?? devices.find(x => x.kind === 'phone') ?? devices.find(x => x.kind === 'pc')

const MB = (n: unknown): string | undefined => (typeof n === 'number' ? (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`) : undefined)

export function DeviceStatusTile({ settings = {} }: TileProps) {
  const state = useHubState()
  const devices = state.data?.devices ?? []
  const d = pickDevice(devices, text(settings, 'device'))
  const phone = d?.kind === 'phone'
  const level = typeof d?.state.battery === 'number' ? d.state.battery : null
  return (
    <Window
      title={d?.name ?? 'Phone'}
      tag={d ? <Tag tone={isOnline(d) ? 'ok' : 'muted'} pill>{isOnline(d) ? '● Linked' : presence(d)}</Tag> : undefined}
      action={
        d ? (
          <a href={`#/devices/${d.id}`} className="lk-label text-[11px] text-ink-2 hover:text-ink">
            Open →
          </a>
        ) : undefined
      }
      state={state.isPending ? 'loading' : state.isError ? 'error' : d ? 'ready' : 'empty'}
      emptyText="No phone paired yet."
      emptyAction={
        <a href="#/devices?add=phone">
          <Button size="sm" variant="primary">
            Pair your phone
          </Button>
        </a>
      }
      {...(state.error ? { error: state.error.message } : {})}
      onRetry={() => void state.refetch()}
    >
      {d && (
        <>
          {(phone || level !== null) && (
            <div className="flex justify-center">
              <Gauge value={level} label="Battery" {...(d.state.charging === true ? { tag: 'Charging' } : {})} />
            </div>
          )}
          <dl className="tabular flex flex-col gap-1 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-ink-3">LINK</dt>
              <dd>{presence(d).toUpperCase()}</dd>
            </div>
            {!phone && MB(d.state.memoryFreeMb) && (
              <div className="flex justify-between">
                <dt className="text-ink-3">MEMORY FREE</dt>
                <dd>{MB(d.state.memoryFreeMb)}</dd>
              </div>
            )}
            {!phone && typeof d.state.diskFreeGb === 'number' && (
              <div className="flex justify-between">
                <dt className="text-ink-3">DISK FREE</dt>
                <dd>{`${d.state.diskFreeGb} GB`}</dd>
              </div>
            )}
            {battery(d) && (
              <div className="flex justify-between">
                <dt className="text-ink-3">BATTERY</dt>
                <dd>{battery(d)}</dd>
              </div>
            )}
            {network(d) && (
              <div className="flex justify-between">
                <dt className="text-ink-3">NETWORK</dt>
                <dd>{network(d)!.toUpperCase()}</dd>
              </div>
            )}
            {!isOnline(d) && d.lastSeenAt && (
              <div className="flex justify-between">
                <dt className="text-ink-3">SEEN</dt>
                <dd>{`Last seen ${ago(d.lastSeenAt)} ago`}</dd>
              </div>
            )}
          </dl>
          {phone && level === null && <p className="text-micro text-ink-3">Battery is shared once "Battery and app use" is collected on the phone.</p>}
          {phone && <CheckNow id={d.id} stretch />}
        </>
      )}
    </Window>
  )
}

// Settings > Network: how phones reach this PC (the device link), which phones are paired, and the hub's fingerprint.

import { useQuery } from '@tanstack/react-query'
import { api } from '../../app/api.ts'
import type { NetworkInfo } from '../../app/queries.ts'
import { Tile } from '../../components/ui/Tile.tsx'
import { Field } from './Field.tsx'

/** The first 16 hex characters of the fingerprint, in groups of four (the whole of it is the title). */
export const shortFingerprint = (fp: string): string =>
  (
    fp
      .replace(/[^0-9a-f]/gi, '')
      .slice(0, 16)
      .toLowerCase()
      .match(/.{1,4}/g) ?? []
  ).join(' ')

const where = (address: string, port: number): string => (address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`)

// The key starts with the live topic that renews it: a phone paired or removed changes the count.
export const useNetwork = () => useQuery({ queryKey: ['devices', 'link'], queryFn: () => api<NetworkInfo>('/v1/network') })

export function Network() {
  const net = useNetwork()
  const n = net.data
  if (!n) return <Tile title="Network" state={net.isError ? 'error' : 'loading'} {...(net.error ? { error: net.error.message } : {})} onRetry={() => void net.refetch()} />

  return (
    <Tile title="Network">
      <Field label="Device link" hint="How your phone reaches this PC, on your home network only.">
        <span className="flex flex-col items-end text-small text-ink-2">
          {n.open ? (
            n.addresses.length > 0 ? (
              n.addresses.map(a => (
                <span key={a} className="tabular">
                  Open on {where(a, n.port)}
                </span>
              ))
            ) : (
              <span>Open on port {n.port}</span>
            )
          ) : (
            <>
              <span>Closed. It opens when a phone is paired.</span>
              <span className="tabular text-ink-3">Port {n.port}</span>
            </>
          )}
        </span>
      </Field>
      <Field label="Paired phones">
        <span className="tabular text-small text-ink-2">{n.phones}</span>
      </Field>
      <Field label="This hub's fingerprint" hint="A phone checks this when it pairs.">
        <span className="tabular text-small text-ink-2" title={n.fingerprint}>
          {shortFingerprint(n.fingerprint)}
        </span>
      </Field>
      <Field label="Alexa route">
        <span className="max-w-full text-small text-ink-2">{n.alexa.note}</span>
      </Field>
    </Tile>
  )
}

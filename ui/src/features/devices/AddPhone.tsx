// Pairing a phone (docs/04 > Pairing a device, docs/07 > Devices): the code to scan, then the four words to compare.
// The owner presses Pair only when the words match; that is what stops another device stepping in.

import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, post } from '../../app/api.ts'
import type { PairingStart, PairingView } from '../../app/queries.ts'
import { Button } from '../../components/ui/Button.tsx'
import { Munch } from '../../components/look/index.ts'
import { Tile } from '../../components/ui/Tile.tsx'

export function AddPhone({ onClose, pollMs = 1000 }: { onClose?: () => void; pollMs?: number }) {
  const [start, setStart] = useState<PairingStart | null>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const begun = useRef(false)

  const begin = useCallback(async () => {
    setError('')
    try {
      const s = await post<PairingStart>('/v1/pairing')
      setStart(s)
      setSvg(await QRCode.toString(s.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (begun.current) return
    begun.current = true
    void begin()
  }, [begin])

  const view = useQuery({
    queryKey: ['devices', 'pairing'],
    queryFn: () => api<PairingView>('/v1/pairing'),
    enabled: start !== null,
    refetchInterval: q => (q.state.data && !['waiting', 'check'].includes(q.state.data.state) ? false : pollMs),
  }).data

  const cancel = async () => {
    await post('/v1/pairing/cancel').catch(() => {})
    onClose?.()
  }

  const pair = async () => {
    setBusy(true)
    try {
      const { deviceId } = await post<{ deviceId: string }>('/v1/pairing/confirm')
      window.location.hash = `#/devices/${deviceId}?new=1`
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fresh = async () => {
    setStart(null)
    setSvg('')
    await begin()
  }

  const state = view?.state ?? 'waiting'

  return (
    <Tile title="Add a phone" className="max-w-xl">
      {error && (
        <p role="alert" className="mb-3 text-body text-danger">
          {error}
        </p>
      )}

      {start && state === 'waiting' && (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-2">In the Mini app on your phone, open ⋮ → Your PC → Scan the code, and scan this.</p>
          <div role="img" aria-label="Pairing code" className="w-56 self-start border-2 border-ink bg-white p-2 shadow-[4px_4px_0_var(--shadow)]" dangerouslySetInnerHTML={{ __html: svg }} />
          <Munch width={224} label="Waiting for your phone" />
          <p className="text-small text-ink-2">
            Or type it: <span className="tabular font-medium text-ink">{start.address}</span> and the code{' '}
            <span className="tabular font-medium text-ink break-all">{start.code}</span>
          </p>
          <p className="text-small text-ink-3">Valid for 5 minutes. Your phone must be on the same Wi-Fi as this PC.</p>
          <p className="text-small text-ink-3">Windows may ask whether Mini Hub can use private networks. Choose Allow.</p>
        </div>
      )}

      {state === 'check' && view?.words && (
        <div className="flex flex-col gap-3">
          <p className="text-body">
            <span className="font-medium">{view.deviceName}</span> wants to pair.
          </p>
          <p className="text-[16px] font-extrabold uppercase">Do these match the words on your phone?</p>
          <ol className="flex flex-wrap gap-2">
            {view.words.map(w => (
              <li key={w} className="lk-drop border-2 border-ink bg-accent px-3 py-2 text-[22px] font-black tracking-wide text-on-accent uppercase shadow-[3px_3px_0_var(--shadow)]">
                {w}
              </li>
            ))}
          </ol>
          <p className="text-small text-ink-3">If they do not match, press Cancel: another device may be trying to pair.</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void pair()} disabled={busy}>
              Pair
            </Button>
            <Button onClick={() => void cancel()}>Cancel</Button>
          </div>
        </div>
      )}

      {(state === 'expired' || state === 'cancelled') && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body">{state === 'expired' ? 'This code has expired.' : 'The pairing ended: the phone went away or it was cancelled.'}</p>
          <Button variant="primary" onClick={() => void fresh()}>
            Make a new code
          </Button>
        </div>
      )}

      {state !== 'check' && state !== 'done' && (
        <div className="mt-4">
          <Button variant="ghost" onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      )}
    </Tile>
  )
}

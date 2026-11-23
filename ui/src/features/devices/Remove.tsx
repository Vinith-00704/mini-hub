// Removing a device (docs/07 > Devices): asks first, and can delete what the device sent too.

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { del } from '../../app/api.ts'
import { Button } from '../../components/ui/Button.tsx'

export function Remove({ id, name, button, message, tick }: { id: string; name: string; button: string; message: string; tick: string }) {
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
        {button}
      </Button>
    )
  return (
    <div className="flex flex-col items-start gap-3 rounded-control border border-danger/50 p-3">
      <p className="text-body">{message.replace('{name}', () => name)}</p>
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" checked={alsoEvents} onChange={e => setAlsoEvents(e.target.checked)} />
        {tick}
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

// One WebSocket to the core: it says what changed, and the screens showing it fetch again.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { readKeys } from './keys.ts'

const RETRY_MS = 2000

export function useLive(): void {
  const client = useQueryClient()
  useEffect(() => {
    let socket: WebSocket | null = null
    let closed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const open = (): void => {
      const keys = readKeys()
      if (!keys || closed) return
      socket = new WebSocket(`ws://127.0.0.1:${keys.api}/v1/live`)
      socket.onopen = () => socket?.send(JSON.stringify({ key: keys.key }))
      socket.onmessage = m => {
        const { topic } = JSON.parse(String(m.data)) as { topic: string }
        void client.invalidateQueries({ queryKey: [topic] })
        if (topic === 'approvals' || topic === 'state' || topic === 'events' || topic === 'devices') void client.invalidateQueries({ queryKey: ['state'] })
        // A phone's state carries its own two lists, which the grants view shows.
        if (topic === 'devices') void client.invalidateQueries({ queryKey: ['grants'] })
      }
      socket.onclose = () => {
        if (!closed) timer = setTimeout(open, RETRY_MS)
      }
    }
    open()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [client])
}

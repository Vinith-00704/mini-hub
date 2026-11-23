// One WebSocket to the core: it says what changed, and the screens showing it fetch again.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { readKeys } from './keys.ts'

const RETRY_MS = 2000

// A topic can be held for a while: its news then waits, and the screen fetches once when the last hold ends. A board
// holds `boards` while a tile is dragged and while a change is being saved, so a change made in another place is
// applied after the drop, and an answer to an older save never overwrites a newer one on the screen.
const holds = new Map<string, number>()
const waiting = new Set<string>()
let fetchAgain: ((topic: string) => void) | null = null

/** Holds a topic's news until the returned function is called (calling it twice does nothing). */
export function holdTopic(topic: string): () => void {
  holds.set(topic, (holds.get(topic) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (holds.get(topic) ?? 1) - 1
    if (left > 0) return void holds.set(topic, left)
    holds.delete(topic)
    if (waiting.delete(topic)) fetchAgain?.(topic)
  }
}

export function useLive(): void {
  const client = useQueryClient()
  useEffect(() => {
    fetchAgain = topic => void client.invalidateQueries({ queryKey: [topic] })
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
        if (holds.has(topic)) waiting.add(topic)
        else void client.invalidateQueries({ queryKey: [topic] })
        if (topic === 'approvals' || topic === 'state' || topic === 'events' || topic === 'devices') void client.invalidateQueries({ queryKey: ['state'] })
        // A phone's state carries its own two lists, which the grants view shows.
        if (topic === 'devices') void client.invalidateQueries({ queryKey: ['grants'] })
        // The board's numbers count waiting approvals and what Mini did (the audit), as well as events.
        if (topic === 'approvals' || topic === 'audit') void client.invalidateQueries({ queryKey: ['events', 'stats'] })
      }
      socket.onclose = () => {
        if (!closed) timer = setTimeout(open, RETRY_MS)
      }
    }
    open()
    return () => {
      closed = true
      fetchAgain = null
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [client])
}

// A pretend phone for the hub's link tests. It trusts any certificate: the phone's pinning is tested on the phone.

import WebSocket from 'ws'
import type { LinkFrame } from '@minihub/protocol/link'
import { until } from './helpers.ts'

export type TestPhone = Awaited<ReturnType<typeof testPhone>>

export const testPhone = async (port: number, opts: { answerPings?: boolean } = {}) => {
  const ws = new WebSocket(`wss://127.0.0.1:${port}/v1/link`, { rejectUnauthorized: false })
  const frames: LinkFrame[] = []
  let closed = false
  ws.on('message', d => {
    const f = JSON.parse(String(d)) as LinkFrame
    frames.push(f)
    if (opts.answerPings !== false && f.t === 'ping') ws.send(JSON.stringify({ t: 'pong', time: f.time }))
  })
  ws.on('close', () => void (closed = true))
  await new Promise<void>((ok, fail) => (ws.once('open', () => ok()), ws.once('error', fail)))
  return {
    ws,
    frames,
    get closed() {
      return closed
    },
    send: (f: object) => ws.send(JSON.stringify(f)),
    until: (check: () => boolean, ms?: number) => until(check, ms),
    /** The latest frame of a kind, once it has come. */
    next: async <T extends LinkFrame['t']>(t: T, after = 0): Promise<Extract<LinkFrame, { t: T }>> => {
      await until(() => frames.slice(after).some(f => f.t === t))
      return frames.slice(after).find(f => f.t === t) as Extract<LinkFrame, { t: T }>
    },
    close: () => ws.close(),
  }
}

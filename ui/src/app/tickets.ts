// Runs an action as the owner and follows its ticket until it ends (docs/05 > Actions). Used where a button waits for
// the answer: "Check now" on a mail account and "Show the whole mail" in the Inbox.

import { api, post } from './api.ts'

export type Ticket = { done: boolean; ok?: boolean; data?: Record<string, unknown>; error?: string; code?: string; waitingFor?: string }

const WAIT_MS = 2000

/** Asks for the action, then asks after its ticket (two seconds at a time) for at most `seconds`. Not done when time ran out. */
export async function runAction(action: { connector: string; device?: string; name: string; args?: unknown }, seconds = 60): Promise<Ticket> {
  const { ticket } = await post<{ ticket: string }>('/v1/actions', action)
  let t: Ticket = { done: false }
  for (let i = 0; i < Math.ceil((seconds * 1000) / WAIT_MS) && !t.done; i++) t = await api<Ticket>(`/v1/tickets/${ticket}?wait=${WAIT_MS}`)
  return t
}

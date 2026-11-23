// The owner's own buttons: each sends a prompt to Mini, or runs one hub action that needs no arguments. An action goes
// through the hub's normal action route as the owner's own call, which the hub runs at once (docs/03: the owner's own
// press is the yes). So for an important action (this PC's sleep, restart, shut down) the "Are you sure?" here is the
// only question: Yes runs it, No does not. Yes waits a moment and ignores a double click, so a second click on the
// button that was just pressed cannot answer it.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiFailure, post } from '../app/api.ts'
import { useActions, type ActionInfo } from '../app/queries.ts'
import { runAction } from '../app/tickets.ts'
import { Button, Window } from '../components/look/index.ts'
import { visible } from '../components/look/plainText.tsx'
import { quickButtons, type QuickButton, type TileProps } from './settings.ts'

export const NOT_AVAILABLE = 'This action is not available now.'
const WAIT_SECONDS = 30
/** Yes cannot be pressed until the question has been on the screen this long. */
const YES_AFTER_MS = 600

/** The action a button runs, if the hub still offers it (and, for a device, still has that device). */
export const actionFor = (b: QuickButton, actions: ActionInfo[]): ActionInfo | undefined => {
  if (b.kind !== 'action') return undefined
  const a = actions.find(x => x.connector === b.connector && x.name === b.name)
  if (!a) return undefined
  if (a.devices && !b.device) return a.devices.length === 1 ? a : undefined
  if (b.device && !a.devices?.some(d => d.id === b.device)) return undefined
  return a
}

type Said = { text: string; offerStart?: boolean }

export function QuickActionsTile({ settings = {} }: TileProps) {
  const client = useQueryClient()
  const buttons = quickButtons(settings)
  const hasAction = buttons.some(b => b.kind === 'action')
  const actions = useActions(hasAction)
  const [busy, setBusy] = useState<number | null>(null)
  const [asking, setAsking] = useState<number | null>(null)
  const [said, setSaid] = useState<Said | null>(null)
  const [armed, setArmed] = useState(false)
  const no = useRef<HTMLButtonElement>(null)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (asking === null) return
    no.current?.focus()
    setArmed(false)
    const timer = setTimeout(() => setArmed(true), YES_AFTER_MS)
    return () => clearTimeout(timer)
  }, [asking])

  /** Gives focus back to a button once it is on the screen and enabled again. */
  const focusButton = (i: number) => requestAnimationFrame(() => row.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus())

  const sendPrompt = async (i: number, b: QuickButton & { kind: 'prompt' }) => {
    setBusy(i)
    setSaid(null)
    try {
      await post('/v1/mini/prompt', { text: b.text })
      setSaid({ text: 'Sent to Mini. The reply is on the Mini screen.' })
      void client.invalidateQueries({ queryKey: ['mini'] })
    } catch (e) {
      setSaid({ text: (e as Error).message, offerStart: e instanceof ApiFailure && e.status === 503 })
    }
    setBusy(null)
    focusButton(i)
  }

  const run = async (i: number, b: QuickButton & { kind: 'action' }, a: ActionInfo) => {
    setAsking(null)
    setBusy(i)
    setSaid(null)
    try {
      const device = b.device ?? (a.devices?.length === 1 ? a.devices[0]?.id : undefined)
      const t = await runAction({ connector: b.connector, name: b.name, ...(device ? { device } : {}), args: {} }, WAIT_SECONDS)
      if (!t.done) setSaid({ text: `Not finished after ${WAIT_SECONDS} seconds.` })
      else setSaid({ text: t.ok ? 'Done.' : (t.error ?? 'That did not work.') })
      void client.invalidateQueries({ queryKey: ['devices'] })
      void client.invalidateQueries({ queryKey: ['state'] })
    } catch (e) {
      setSaid({ text: (e as Error).message })
    }
    setBusy(null)
    focusButton(i)
  }

  const start = async () => {
    setSaid({ text: 'Starting Mini…' })
    try {
      await post('/v1/mini/start')
      void client.invalidateQueries({ queryKey: ['mini'] })
    } catch (e) {
      setSaid({ text: (e as Error).message })
    }
  }

  const press = (i: number, b: QuickButton) => {
    if (b.kind === 'prompt') return void sendPrompt(i, b)
    const a = actionFor(b, actions.data?.items ?? [])
    if (!a) return
    // An important action asks here first: this is the only question, the hub runs the owner's press at once.
    if (a.risk === 'important') {
      setSaid(null)
      return setAsking(i)
    }
    void run(i, b, a)
  }

  // The tile can be one row high, so its empty, loading and error states are one line each.
  if (buttons.length === 0)
    return (
      <Window title="Quick actions" bare bodyClassName="justify-center">
        <p className="text-small text-ink-2">No buttons yet. Add them in this tile's settings.</p>
      </Window>
    )
  if (hasAction && actions.isPending)
    return (
      <Window title="Quick actions" bare bodyClassName="justify-center">
        <div aria-busy="true" aria-label="Loading" className="lk-skel h-6 w-2/3" />
      </Window>
    )
  if (hasAction && actions.isError)
    return (
      <Window title="Quick actions" bare bodyClassName="justify-center">
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="min-w-0 text-small text-danger">
            {actions.error.message}
          </p>
          <Button size="sm" onClick={() => void actions.refetch()}>
            Retry
          </Button>
        </div>
      </Window>
    )

  const asked = asking === null ? undefined : buttons[asking]
  const askedAction = asked?.kind === 'action' ? actionFor(asked, actions.data?.items ?? []) : undefined

  return (
    <Window title="Quick actions" bare bodyClassName="justify-center">
      {asked?.kind === 'action' && askedAction ? (
        <div role="group" aria-label="Are you sure?" className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 text-small font-bold">Are you sure? {askedAction.title}</span>
          <Button
            size="sm"
            variant="danger"
            disabled={!armed}
            onClick={e => {
              // The second click of a double click is not an answer.
              if (e.detail > 1 || asking === null) return
              void run(asking, asked, askedAction)
            }}
          >
            Yes
          </Button>
          <button
            ref={no}
            type="button"
            className="lk-btn sm"
            onClick={() => {
              if (asking !== null) focusButton(asking)
              setAsking(null)
            }}
          >
            No
          </button>
        </div>
      ) : (
        <div ref={row} className="flex flex-wrap items-center gap-2">
          {buttons.map((b, i) => {
            const gone = b.kind === 'action' && !actionFor(b, actions.data?.items ?? [])
            const empty = b.kind === 'prompt' && !b.text.trim()
            return (
              <Button
                key={i}
                data-i={i}
                size="sm"
                busy={busy === i}
                disabled={gone || empty || busy !== null}
                // What a prompt button sends is there to be read, not only its label.
                title={gone ? NOT_AVAILABLE : b.kind === 'prompt' ? visible(b.text.slice(0, 400)) : undefined}
                onClick={() => press(i, b)}
              >
                {visible(b.label)}
              </Button>
            )
          })}
          <span role="status" className={said ? 'flex min-w-0 items-center gap-2 text-small text-ink-2' : 'sr-only'}>
            {said?.text}
            {said?.offerStart && (
              <Button size="sm" variant="primary" onClick={() => void start()}>
                Start Mini
              </Button>
            )}
          </span>
        </div>
      )}
    </Window>
  )
}

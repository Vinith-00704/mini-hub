// The guided setup of a connector's device (docs/06 > The interface, docs/07 > Devices): the hub says what to ask next
// (a form, a note to read, a question) and this shows it. Used for "Add a mail account" and for changing an account's
// app password. What is typed is held here only until it is sent; the password is cleared from the form the moment it
// leaves, is never put in the address or in the browser's storage, and is never shown again.

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { post } from '../../app/api.ts'
import type { SetupField, SetupStep } from '../../app/queries.ts'
import { Button, Choice, Munch } from '../../components/look/index.ts'
import { Tile } from '../../components/ui/Tile.tsx'

type Reply = { session: string; step: SetupStep }
type Values = Record<string, string>

/** Tells the hub to forget a run, and whatever was typed in it. */
const drop = (path: string, id: string | null): void => {
  if (id) void post(path, { session: id, step: 'cancel' }).catch(() => {})
}

/** What a form starts with: the values the hub gave back (never a password), as text. */
const initial = (step: SetupStep): Values =>
  step.kind === 'form' ? Object.fromEntries(step.fields.map(f => [f.name, f.kind === 'password' || f.value === undefined ? '' : String(f.value)])) : {}

function FieldInput({ field, value, onChange }: { field: SetupField; value: string; onChange: (v: string) => void }) {
  const id = useId()
  const hint = field.hint ? `${id}-hint` : undefined
  const name = field.required ? field.label : `${field.label} (optional)`
  if (field.kind === 'choice')
    return (
      <div data-field className="flex flex-col gap-1">
        <span className="lk-label text-[11px] text-ink-2">{name}</span>
        <Choice label={field.label} value={value} onChange={onChange} options={(field.choices ?? []).map(c => ({ value: c.value, label: c.label }))} />
        {field.hint && <p className="text-micro text-ink-3">{field.hint}</p>}
      </div>
    )
  const secret = field.kind === 'password'
  return (
    <div data-field className="flex flex-col gap-1">
      <label htmlFor={id} className="lk-label text-[11px] text-ink-2">
        {name}
      </label>
      <span className="lk-field">
        <b aria-hidden>&gt;</b>
        <input
          id={id}
          {...(secret ? {} : { name: field.name })}
          type={secret ? 'password' : field.kind === 'email' ? 'email' : 'text'}
          {...(field.kind === 'number' ? { inputMode: 'numeric' as const } : {})}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          {...(hint ? { 'aria-describedby': hint } : {})}
        />
      </span>
      {field.hint && (
        <p id={hint} className="text-micro text-ink-3">
          {field.hint}
        </p>
      )}
    </div>
  )
}

export function SetupWizard({ connector, device, onClose }: { connector: string; device?: string; onClose: () => void }) {
  const client = useQueryClient()
  const path = `/v1/connectors/${encodeURIComponent(connector)}/setup`
  const [step, setStep] = useState<SetupStep | null>(null)
  const [values, setValues] = useState<Values>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const root = useRef<HTMLDivElement>(null)
  // The run the hub holds for this wizard, while one is open; and whether this screen is still on show.
  const session = useRef<string | null>(null)
  const alive = useRef(true)
  const begun = useRef(false)

  const apply = useCallback(
    (reply: Reply) => {
      if (!alive.current) return drop(path, reply.session)
      const next = reply.step
      session.current = next.kind === 'form' || next.kind === 'show' || next.kind === 'confirm' ? reply.session : null
      if (next.kind === 'done') {
        void client.invalidateQueries({ queryKey: ['devices'] })
        const id = next.devices[0]
        // Changing a password stays on the account's page; a new account opens its page with the question.
        if (device || !id) return onClose()
        window.location.hash = `#/devices/${encodeURIComponent(id)}?new=1`
        return
      }
      setStep(next)
      setValues(initial(next))
    },
    [client, device, onClose, path],
  )

  const begin = useCallback(async () => {
    const old = session.current
    setBusy(true)
    setFailure('')
    setStep(null)
    try {
      apply(await post<Reply>(path, { ...(old ? { session: old } : {}), step: null, ...(device ? { input: { device } } : {}) }))
    } catch (e) {
      setFailure((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [apply, device, path])

  useEffect(() => {
    alive.current = true
    if (!begun.current) {
      begun.current = true
      void begin()
    }
    return () => {
      alive.current = false
      // Closing the screen ends the run, so nothing typed waits on the hub.
      drop(path, session.current)
      session.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus goes to the first field of each step (or its button when it has none).
  useEffect(() => {
    if (!step) return
    const box = root.current
    const field = box?.querySelector('[data-field]')
    const first =
      field?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? field?.querySelector<HTMLElement>('input, [role="radio"]') ?? box?.querySelector<HTMLElement>('[data-primary]')
    first?.focus()
  }, [step])

  const cancel = () => {
    const id = session.current
    session.current = null
    setValues({})
    onClose()
    drop(path, id)
  }

  const send = async (current: SetupStep & { id: string }) => {
    const input = current.kind === 'form' ? Object.fromEntries(current.fields.map(f => [f.name, values[f.name] ?? ''])) : undefined
    // The password leaves the form as soon as it is sent.
    if (current.kind === 'form') setValues(v => ({ ...v, ...Object.fromEntries(current.fields.filter(f => f.kind === 'password').map(f => [f.name, ''])) }))
    setBusy(true)
    setFailure('')
    // The fields are disabled while the hub answers: focus stays inside the wizard so Esc still reaches it.
    root.current?.focus()
    try {
      apply(await post<Reply>(path, { session: session.current ?? '', step: current.id, ...(input ? { input } : {}) }))
    } catch (e) {
      if (alive.current) {
        session.current = null
        setStep(null)
        setFailure((e as Error).message)
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  let body: ReactNode
  if (failure) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-body text-danger">
          {failure}
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void begin()} data-primary>
            Start again
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    )
  } else if (step?.kind === 'error') {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-body text-danger">
          {step.text}
        </p>
        <Button variant="primary" onClick={onClose} data-primary>
          Close
        </Button>
      </div>
    )
  } else if (step && step.kind !== 'done') {
    const checking = step.kind === 'form' && step.id === 'password'
    const form = step.kind === 'form' ? step : null
    body = (
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={e => {
          e.preventDefault()
          if (!busy) void send(step)
        }}
      >
        <p className="text-body text-ink-2">{step.text}</p>
        {form?.error && (
          <p role="alert" className="text-body text-danger">
            {form.error}
          </p>
        )}
        {form && (
          <fieldset disabled={busy} className="flex flex-col gap-3 border-0 p-0">
            {form.fields.map(f => (
              <FieldInput key={f.name} field={f} value={values[f.name] ?? ''} onChange={v => setValues(old => ({ ...old, [f.name]: v }))} />
            ))}
          </fieldset>
        )}
        {busy && checking && <Munch width={224} label="Checking with the mail server" />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy} busy={busy && !checking} data-primary>
            {checking ? 'Check and add' : 'Next'}
          </Button>
          <Button onClick={cancel}>Cancel</Button>
        </div>
      </form>
    )
  }

  const title = step && step.kind !== 'done' && step.kind !== 'error' ? step.title : device ? 'Change the app password' : 'Add a mail account'
  return (
    <div
      ref={root}
      tabIndex={-1}
      className="max-w-xl outline-none"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          cancel()
        }
      }}
    >
      <p role="status" className="sr-only">
        {step && step.kind !== 'done' && step.kind !== 'error' ? step.title : ''}
      </p>
      <Tile title={title} state={!body ? 'loading' : 'ready'}>
        {body}
      </Tile>
    </div>
  )
}

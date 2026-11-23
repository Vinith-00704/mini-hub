// A tile's settings, in a dialog (docs/07 > Widgets). Each change is saved with the board as it is made; text is saved
// a moment after typing stops, when the box is left and when the dialog closes, so one sentence is one change to undo.

import type { Widget } from '@minihub/protocol'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useActions, useDevices, useEvents, useHubState, type ActionInfo, type EventRow } from '../../app/queries.ts'
import { Button, Choice, Switch } from '../../components/look/index.ts'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { messageApp, notificationApp } from '../../widgets/list.tsx'
import { clockOf } from '../../widgets/clock.tsx'
import { pickDevice } from '../../widgets/device-status.tsx'
import {
  DEFAULT_MINI_COUNT,
  HOURS,
  HOURS_LABEL,
  MAX_BUTTONS,
  MAX_LABEL,
  MAX_NOTE,
  MAX_PROMPT,
  MINI_COUNTS,
  needsNoArguments,
  oneOf,
  quickButtons,
  strings,
  text,
  TODAY_COUNTS,
  flag,
  type Hours,
  clip,
  type QuickButton,
  type Settings,
} from '../../widgets/settings.ts'

export const NO_SETTINGS = 'This tile has no settings.'

const control = 'w-full border-2 border-ink bg-card px-2 text-small text-ink focus-visible:border-accent'
const field = `${control} h-[34px] font-mono`
const area = `${control} min-h-[120px] resize-y py-1.5 font-mono leading-snug`

/** A value kept while it is typed, and saved a moment after the typing stops, on leaving the box and when this unmounts. */
function useTyped<T>(value: T, save: (v: T) => void, wait = 700) {
  const [typed, setTyped] = useState(value)
  const latest = useRef({ typed, save, dirty: false })
  latest.current.save = save
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flush = () => {
    clearTimeout(timer.current)
    if (!latest.current.dirty) return
    latest.current.dirty = false
    latest.current.save(latest.current.typed)
  }
  useEffect(() => flush, [])
  return {
    typed,
    type: (v: T) => {
      latest.current.typed = v
      latest.current.dirty = true
      setTyped(v)
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, wait)
    },
    /** Saves now, with this value (a change that is not typing). */
    now: (v: T) => {
      clearTimeout(timer.current)
      latest.current.typed = v
      latest.current.dirty = false
      setTyped(v)
      latest.current.save(v)
    },
    flush,
  }
}

function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="lk-label text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-micro text-ink-3">{hint}</p>}
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-7 cursor-pointer items-center gap-2 text-small">
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-small font-bold">{label}</span>
      {children}
    </div>
  )
}

type Form = { value: Settings; change: (next: Settings) => void }

// --- One form for each kind of tile ---

function DeviceForm({ value, change }: Form) {
  const id = useId()
  const state = useHubState()
  const devices = (state.data?.devices ?? []).filter(d => d.kind === 'phone' || d.kind === 'pc')
  // What the tile shows now, so the choice never names a device that has gone.
  const shown = pickDevice(devices, text(value, 'device'))?.id ?? ''
  return (
    <Field label="Device" id={id} hint="A phone, or this PC.">
      <select id={id} className={field} value={shown} onChange={e => change({ ...value, device: e.target.value })} disabled={devices.length === 0}>
        {devices.length === 0 && <option value="">No phone paired yet</option>}
        {devices.map(d => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Field>
  )
}

function CallsForm({ value, change }: Form) {
  return <Check label="Missed calls only" checked={flag(value, 'missedOnly', false)} onChange={on => change({ ...value, missedOnly: on })} />
}

/** The apps seen in the last 200 events of these kinds, plus any already ticked. None ticked means all. */
function AppsForm({ value, change, types, nameOf, kind }: Form & { types: string[]; nameOf: (e: EventRow) => string; kind: string }) {
  const events = useEvents({ type: types, limit: '200' })
  const ticked = strings(value, 'apps')
  const seen = useMemo(() => [...new Set((events.data?.items ?? []).map(nameOf))], [events.data, nameOf])
  const all = [...new Set([...seen, ...ticked])].sort((a, b) => a.localeCompare(b))
  const toggle = (app: string, on: boolean) => change({ ...value, apps: on ? [...ticked, app] : ticked.filter(a => a !== app) })
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="lk-label mb-1 text-ink-2">Apps</legend>
      {events.isPending && <p className="text-small text-ink-2">Looking at your latest {kind}…</p>}
      {events.isError && <p role="alert" className="text-small text-danger">{events.error.message}</p>}
      {!events.isPending && !events.isError && all.length === 0 && <p className="text-small text-ink-2">No apps yet. They show here once {kind} arrive.</p>}
      {all.map(app => (
        <Check key={app} label={app} checked={ticked.includes(app)} onChange={on => toggle(app, on)} />
      ))}
      <p className="text-micro text-ink-3">None ticked shows all of them.</p>
    </fieldset>
  )
}

function MailForm({ value, change }: Form) {
  const id = useId()
  const devices = useDevices()
  const accounts = (devices.data?.items ?? []).filter(d => d.kind === 'mail-account')
  const chosen = accounts.find(d => d.id === text(value, 'account'))?.id ?? ''
  return (
    <>
      <Field label="Account" id={id}>
        <select id={id} className={field} value={chosen} onChange={e => change({ ...value, account: e.target.value })}>
          <option value="">All accounts</option>
          {accounts.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Line label="Unseen only">
        <Switch label="Unseen only" checked={flag(value, 'unseenOnly', false)} onChange={on => change({ ...value, unseenOnly: on })} />
      </Line>
    </>
  )
}

function MiniActivityForm({ value, change }: Form) {
  const count = oneOf(value, 'count', MINI_COUNTS, DEFAULT_MINI_COUNT)
  return (
    <Line label="How many to show">
      <Choice label="How many" value={String(count)} options={MINI_COUNTS.map(n => ({ value: String(n), label: String(n) }))} onChange={v => change({ ...value, count: Number(v) })} />
    </Line>
  )
}

function TodayForm({ value, change }: Form) {
  const ticked = strings(value, 'counts')
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="lk-label mb-1 text-ink-2">Counts</legend>
      {TODAY_COUNTS.map(c => (
        <Check key={c.id} label={c.label} checked={ticked.length === 0 || ticked.includes(c.id)} onChange={on => change({ ...value, counts: nextCounts(ticked, c.id, on) })} />
      ))}
      <p className="text-micro text-ink-3">At least one stays ticked.</p>
    </fieldset>
  )
}

/** The counts after one is ticked or unticked; "all" is kept as an empty list, and the last one cannot be unticked. */
const nextCounts = (ticked: string[], id: string, on: boolean): string[] => {
  const now = ticked.length === 0 ? TODAY_COUNTS.map(c => c.id as string) : ticked
  const next = on ? TODAY_COUNTS.map(c => c.id as string).filter(x => x === id || now.includes(x)) : now.filter(x => x !== id)
  if (next.length === 0) return now
  return next.length === TODAY_COUNTS.length ? [] : next
}

function ClockForm({ value, change }: Form) {
  const now = clockOf(value)
  return (
    <>
      <Line label="Hours">
        <Choice<Hours> label="Hours" value={now.hours} options={HOURS.map(h => ({ value: h, label: HOURS_LABEL[h] }))} onChange={h => change({ ...value, hours: h })} />
      </Line>
      <Line label="Seconds">
        <Switch label="Seconds" checked={now.seconds} onChange={on => change({ ...value, seconds: on })} />
      </Line>
      <Line label="Date">
        <Switch label="Date" checked={now.date} onChange={on => change({ ...value, date: on })} />
      </Line>
    </>
  )
}

function NoteForm({ value, change }: Form) {
  const id = useId()
  const note = useTyped(text(value, 'text'), v => change({ ...value, text: v }))
  return (
    <Field label="Text" id={id}>
      <textarea id={id} data-autofocus dir="auto" className={area} maxLength={MAX_NOTE} value={note.typed} onChange={e => note.type(e.target.value)} onBlur={note.flush} aria-describedby={`${id}-n`} />
      <p id={`${id}-n`} className="tabular self-end text-micro text-ink-3">
        {note.typed.length.toLocaleString()} / {MAX_NOTE.toLocaleString()}
      </p>
    </Field>
  )
}

// --- Quick actions: a list of buttons ---

type Row = { key: number; b: Draft }
/** A button while it is being made: its label and text may still be empty. */
type Draft = { kind: 'prompt' | 'action'; label: string; text: string; connector: string; name: string; device: string }

const toDraft = (b: QuickButton): Draft =>
  b.kind === 'prompt' ? { kind: 'prompt', label: b.label, text: b.text, connector: '', name: '', device: '' } : { kind: 'action', label: b.label, text: '', connector: b.connector, name: b.name, device: b.device ?? '' }

/** What is stored: only buttons that are complete (a label, and a text or an action). */
const toStored = (rows: Row[], actions: ActionInfo[]): QuickButton[] =>
  rows.flatMap(({ b }): QuickButton[] => {
    const label = clip(b.label.trim(), MAX_LABEL)
    if (!label) return []
    if (b.kind === 'prompt') return b.text.trim() ? [{ kind: 'prompt', label, text: b.text }] : []
    if (!b.connector || !b.name) return []
    // An action that runs on a device needs one of its devices, as the line under the button says.
    const devices = actions.find(a => a.connector === b.connector && a.name === b.name)?.devices
    if (devices && devices.length > 0 && !devices.some(d => d.id === b.device)) return []
    return [{ kind: 'action', label, connector: b.connector, name: b.name, ...(b.device ? { device: b.device } : {}) }]
  })

/** The actions a button may run: no required arguments, and a device to run on where the connector has devices. */
const offered = (actions: ActionInfo[]): ActionInfo[] => actions.filter(a => needsNoArguments(a.args) && (a.devices === undefined || a.devices.length > 0))

const actionKey = (a: { connector: string; name: string }) => `${a.connector}.${a.name}`

function ButtonRow({
  row,
  index,
  count,
  actions,
  update,
  move,
  remove,
  flush,
}: {
  row: Row
  index: number
  count: number
  actions: ActionInfo[]
  update: (patch: Partial<Draft>, typing?: boolean) => void
  move: (by: -1 | 1) => void
  remove: () => void
  flush: () => void
}) {
  const id = useId()
  const b = row.b
  const chosen = actions.find(a => a.connector === b.connector && a.name === b.name)
  const here = offered(actions)
  // A chosen action that is no longer offered stays in the list so it can be seen and changed.
  const list = chosen && !here.includes(chosen) ? [chosen, ...here] : here
  const gone = b.kind === 'action' && b.connector !== '' && !chosen
  const missing = !b.label.trim() ? 'Give the button a label.' : b.kind === 'prompt' ? (b.text.trim() ? '' : 'Write the prompt.') : b.connector && b.name ? (b.device === '' && chosen?.devices && chosen.devices.length > 0 ? 'Choose a device.' : '') : 'Choose an action.'
  return (
    <li data-row={row.key} className="flex flex-col gap-2 border-2 border-ink p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="lk-label text-ink-2">{`Button ${index + 1}`}</span>
        <span className="flex gap-1">
          <button type="button" data-act="up" className="lk-btn sm" aria-label={`Move up, button ${index + 1}`} disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp aria-hidden size={14} />
            Move up
          </button>
          <button type="button" data-act="down" className="lk-btn sm" aria-label={`Move down, button ${index + 1}`} disabled={index === count - 1} onClick={() => move(1)}>
            <ArrowDown aria-hidden size={14} />
            Move down
          </button>
          <button type="button" className="lk-btn sm danger" aria-label={`Remove, button ${index + 1}`} onClick={remove}>
            <Trash2 aria-hidden size={14} />
            Remove
          </button>
        </span>
      </div>
      <Field label="Label" id={`${id}-l`}>
        <input id={`${id}-l`} className={field} maxLength={MAX_LABEL} value={b.label} onChange={e => update({ label: e.target.value }, true)} onBlur={flush} />
      </Field>
      <Field label="What it does" id={`${id}-k`}>
        <select
          id={`${id}-k`}
          className={field}
          value={b.kind}
          onChange={e => update({ kind: e.target.value === 'action' ? 'action' : 'prompt' })}
        >
          <option value="prompt">A prompt for Mini</option>
          <option value="action">An action</option>
        </select>
      </Field>
      {b.kind === 'prompt' ? (
        <Field label="Prompt" id={`${id}-p`}>
          <textarea id={`${id}-p`} dir="auto" className={`${area} min-h-[72px]`} maxLength={MAX_PROMPT} value={b.text} onChange={e => update({ text: e.target.value }, true)} onBlur={flush} />
          <p className="tabular self-end text-micro text-ink-3">
            {b.text.length.toLocaleString()} / {MAX_PROMPT.toLocaleString()}
          </p>
        </Field>
      ) : (
        <>
          <Field label="Action" id={`${id}-a`} {...(gone ? { hint: 'This action is not available now.' } : {})}>
            <select
              id={`${id}-a`}
              className={field}
              value={b.connector ? actionKey(b) : ''}
              onChange={e => {
                const a = list.find(x => actionKey(x) === e.target.value)
                if (!a) return update({ connector: '', name: '', device: '' })
                update({ connector: a.connector, name: a.name, device: a.devices?.[0]?.id ?? '', ...(b.label.trim() ? {} : { label: clip(a.title, MAX_LABEL) }) })
              }}
            >
              <option value="">Choose an action</option>
              {gone && <option value={actionKey(b)}>{`${b.connector}.${b.name} (not available now)`}</option>}
              {list.map(a => (
                <option key={actionKey(a)} value={actionKey(a)}>
                  {a.title}
                </option>
              ))}
            </select>
          </Field>
          {chosen?.devices && chosen.devices.length > 0 && (
            <Field label="Device" id={`${id}-d`}>
              <select id={`${id}-d`} className={field} value={chosen.devices.some(d => d.id === b.device) ? b.device : ''} onChange={e => update({ device: e.target.value })}>
                {!chosen.devices.some(d => d.id === b.device) && <option value="">Choose a device</option>}
                {chosen.devices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {chosen?.risk === 'important' && <p className="text-micro text-ink-3">This one asks "Are you sure?" before it runs.</p>}
        </>
      )}
      {missing && <p className="text-micro text-warn">{`${missing} The button is not saved until it is complete.`}</p>}
    </li>
  )
}

function QuickActionsForm({ value, change }: Form) {
  const actions = useActions()
  const next = useRef(0)
  const mk = (b: Draft): Row => ({ key: next.current++, b })
  const [rows, setRows] = useState<Row[]>(() => quickButtons(value).map(b => mk(toDraft(b))))
  const [said, setSaid] = useState('')
  const list = useRef<HTMLUListElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const latest = useRef({ rows, value, change, actions: actions.data?.items ?? [] })
  latest.current = { rows, value, change, actions: actions.data?.items ?? [] }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = useRef(false)

  const save = () => {
    clearTimeout(timer.current)
    dirty.current = false
    const { rows, value, change, actions } = latest.current
    change({ ...value, buttons: toStored(rows, actions) })
  }
  useEffect(() => () => (dirty.current ? save() : undefined), [])

  /** `typing`: saved after a pause or on leaving the box; anything else is saved now. */
  const set = (next: Row[], typing = false) => {
    latest.current.rows = next
    setRows(next)
    dirty.current = true
    clearTimeout(timer.current)
    if (typing) timer.current = setTimeout(save, 700)
    else save()
  }

  const focusRow = (key: number, act: 'up' | 'down') =>
    requestAnimationFrame(() => {
      const row = list.current?.querySelector(`[data-row="${key}"]`)
      const want = row?.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)
      ;(want && !want.disabled ? want : row?.querySelector<HTMLButtonElement>('[data-act]:not(:disabled)'))?.focus()
    })

  const add = () => {
    if (rows.length >= MAX_BUTTONS) return
    const row = mk({ kind: 'prompt', label: '', text: '', connector: '', name: '', device: '' })
    set([...rows, row], true)
    setSaid(`Button ${rows.length + 1} added.`)
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>(`[data-row="${row.key}"] input`)?.focus())
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {actions.isError && (
        <p role="alert" className="text-small text-danger">
          The list of actions could not be loaded: {actions.error.message}
        </p>
      )}
      {rows.length === 0 && <p className="text-small text-ink-2">No buttons yet.</p>}
      <ul ref={list} className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <ButtonRow
            key={r.key}
            row={r}
            index={i}
            count={rows.length}
            actions={actions.data?.items ?? []}
            update={(patch, typing) => set(rows.map(o => (o.key === r.key ? { ...o, b: { ...o.b, ...patch } } : o)), typing)}
            move={by => {
              const to = i + by
              const moved = [...rows]
              const [one] = moved.splice(i, 1)
              moved.splice(to, 0, one as Row)
              set(moved)
              setSaid(`Moved ${r.b.label.trim() || `button ${i + 1}`} ${by < 0 ? 'up' : 'down'}. It is now ${to + 1} of ${rows.length}.`)
              focusRow(r.key, by < 0 ? 'up' : 'down')
            }}
            remove={() => {
              const after = rows[i + 1] ?? rows[i - 1]
              set(rows.filter(o => o.key !== r.key))
              setSaid(`Removed ${r.b.label.trim() || `button ${i + 1}`}.`)
              if (after) focusRow(after.key, 'up')
              else requestAnimationFrame(() => addButton.current?.focus())
            }}
            flush={() => dirty.current && save()}
          />
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button ref={addButton} type="button" className="lk-btn" disabled={rows.length >= MAX_BUTTONS} onClick={add}>
          <Plus aria-hidden size={14} />
          Add a button
        </button>
        <span className="text-micro text-ink-3">{rows.length >= MAX_BUTTONS ? `At most ${MAX_BUTTONS} buttons.` : `${rows.length} of ${MAX_BUTTONS}`}</span>
      </div>
    </div>
  )
}

const FORMS: Record<string, (props: Form) => ReactNode> = {
  'device-status': DeviceForm,
  calls: CallsForm,
  messages: p => <AppsForm {...p} types={['sms', 'chat']} nameOf={messageApp} kind="messages" />,
  notifications: p => <AppsForm {...p} types={['notification']} nameOf={notificationApp} kind="notifications" />,
  mail: MailForm,
  'mini-activity': MiniActivityForm,
  today: TodayForm,
  clock: ClockForm,
  note: NoteForm,
  'quick-actions': QuickActionsForm,
}

const formFor = (type: string): ((props: Form) => ReactNode) | undefined => FORMS[type]

export function TileSettings({ tile, title, problem, onChange, onClose }: { tile: Widget; title: string; problem?: string; onChange: (settings: Settings) => void; onClose: () => void }) {
  const Form = formFor(tile.type)
  return (
    <Dialog label={`Settings for ${title}`} onClose={onClose}>
      {Form ? <Form value={tile.settings ?? {}} change={onChange} /> : <p className="text-small text-ink-2">{NO_SETTINGS}</p>}
      {problem && (
        <p role="alert" className="border-2 border-danger px-3 py-2 text-small text-danger">
          {problem}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-micro text-ink-3">{Form ? 'Changes are saved as you make them.' : ''}</span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  )
}

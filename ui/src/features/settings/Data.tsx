// Settings > Data: how long things are kept, a backup to a file the person protects with a passphrase, bringing one
// back, and deleting one kind of thing for good (docs/04 > What is kept, The backup; docs/05).
//
// The passphrase is typed into a field, held here only until it is sent, and cleared the moment it leaves. It is never
// put in a query key, the address, the browser's storage or a log, and never shown again.

import type { EventType } from '@minihub/protocol'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { api, del, patch, post } from '../../app/api.ts'
import { inShell, pickOpen, pickSave } from '../../app/shell.ts'
import { useSettings, type Keep, type Retention, type UiSettings } from '../../app/queries.ts'
import { Button, Choice, Munch } from '../../components/look/index.ts'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Tile } from '../../components/ui/Tile.tsx'
import { Field } from './Field.tsx'

const DEFAULT_RETENTION: Retention = { events: {}, audit: '1y', mailBody: 'extract' }

export const MIN_PASSPHRASE = 10
/** A confirm's button cannot be pressed until the question has been on the screen this long. */
const ARM_MS = 600

/** Each kind the person can set a time for or delete, by the event types it holds. `noun` is how the confirm names it. */
export const KINDS: Array<{ id: string; label: string; noun: string; types: EventType[] }> = [
  { id: 'calls', label: 'Calls', noun: 'call', types: ['call'] },
  { id: 'messages', label: 'Messages', noun: 'message', types: ['sms', 'chat'] },
  { id: 'notifications', label: 'Other notifications', noun: 'notification', types: ['notification'] },
  { id: 'mail', label: 'Mail', noun: 'mail', types: ['mail'] },
  { id: 'mini', label: 'What Mini did', noun: 'Mini action', types: ['mini_action'] },
  { id: 'state', label: 'Phone and PC state', noun: 'phone and PC state', types: ['device_state'] },
  { id: 'notes', label: "Mini Hub's own notes", noun: 'Mini Hub note', types: ['system'] },
]

const KEEP: Array<{ value: Keep; label: string }> = [
  { value: 'forever', label: 'For ever' },
  { value: '1y', label: 'A year' },
  { value: '90d', label: '90 days' },
  { value: '30d', label: '30 days' },
]
const AUDIT: Array<{ value: Retention['audit']; label: string }> = [
  { value: '1y', label: 'A year' },
  { value: '2y', label: 'Two years' },
  { value: 'forever', label: 'For ever' },
]
const MAIL: Array<{ value: Retention['mailBody']; label: string }> = [
  { value: 'subjects', label: 'Subjects only' },
  { value: 'extract', label: 'The first 2,000 characters (default)' },
  { value: 'full', label: 'The full text, up to 20,000 characters' },
]

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const words = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.')

/** One line that screen readers announce when it changes: what happened, or what went wrong. */
function Said({ said }: { said: { text: string; bad: boolean } | null }) {
  return (
    <p role="status" className={`text-small ${said?.bad ? 'text-danger' : 'text-ink-2'}`}>
      {said?.text ?? ''}
    </p>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t-2 border-ink/20 pt-3 first:border-0 first:pt-0">
      <h3 className="lk-label text-[11px] text-ink-2">{title}</h3>
      {children}
    </section>
  )
}

function PassField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <div className="flex min-w-56 flex-1 flex-col gap-1">
      <label htmlFor={id} className="lk-label text-[11px] text-ink-2">
        {label}
      </label>
      <span className="lk-field">
        <b aria-hidden>&gt;</b>
        <input id={id} type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={value} onChange={e => onChange(e.target.value)} />
      </span>
    </div>
  )
}

// --- How long things are kept ---

function Keeping() {
  const client = useQueryClient()
  const settings = useSettings()
  const retention = settings.data?.retention ?? DEFAULT_RETENTION
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null)
  const save = useMutation({
    mutationFn: (retention: { events?: Record<string, Keep>; audit?: Retention['audit']; mailBody?: Retention['mailBody'] }) => patch<UiSettings>('/v1/settings', { retention }),
    onSuccess: next => {
      client.setQueryData(['settings'], (old: UiSettings | undefined) => (old && next.retention ? { ...old, retention: next.retention } : old))
      setSaid({ text: 'Saved.', bad: false })
    },
    onError: e => setSaid({ text: words(e), bad: true }),
  })

  return (
    <>
      <Group title="How long things are kept">
        <div>
          {KINDS.map(k => {
            const kept = k.types.map(t => retention.events[t] ?? 'forever')
            // A kind of two types whose times differ shows none chosen, until one is.
            const value = (kept.every(v => v === kept[0]) ? kept[0] : '') as Keep
            return (
              <Field key={k.id} label={k.label}>
                <Choice
                  label={k.label}
                  value={value}
                  options={KEEP}
                  disabled={save.isPending}
                  onChange={v => save.mutate({ events: Object.fromEntries(k.types.map(t => [t, v])) })}
                />
              </Field>
            )
          })}
          <Field label="Activity log" hint="What Mini and you did in Mini Hub.">
            <Choice label="Activity log" value={retention.audit} options={AUDIT} disabled={save.isPending} onChange={audit => save.mutate({ audit })} />
          </Field>
        </div>
        <p className="text-small text-ink-3">Older items are removed within six hours of a change.</p>
      </Group>
      <Group title="How much of a mail is kept">
        <div className="max-w-full overflow-x-auto pb-1">
          <Choice label="How much of a mail is kept" value={retention.mailBody} options={MAIL} disabled={save.isPending} onChange={mailBody => save.mutate({ mailBody })} />
        </div>
        <p className="text-small text-ink-3">Applies to mail that arrives from now on.</p>
      </Group>
      <Said said={said} />
    </>
  )
}

// --- Export ---

type Counts = { events: number; boards: number; devices: number }

function Export() {
  const desktop = inShell()
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null)
  const pathId = useId()
  const bad = (text: string) => setSaid({ text, bad: true })

  const run = async () => {
    if (pass.length < MIN_PASSPHRASE) return bad(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`)
    if (pass !== again) return bad('The two passphrases are not the same.')
    if (!desktop && !path.trim()) return bad('Type the full path of the file, ending in .minihub.')
    setSaid(null)
    setBusy(true)
    let target: string | null
    try {
      target = desktop ? await pickSave(`mini-hub-backup-${today()}.minihub`) : path.trim()
    } catch {
      setBusy(false)
      return bad('The window for choosing a place could not be opened.')
    }
    // Cancelled: nothing happens, and what was typed stays.
    if (!target) return setBusy(false)
    // The passphrase leaves the fields now, whatever comes of the try.
    const passphrase = pass
    setPass('')
    setAgain('')
    try {
      const done = await post<Counts>('/v1/data/export', { path: target, passphrase })
      setSaid({ text: `Saved: ${count(done.events, 'event', 'events')}, ${count(done.boards, 'board', 'boards')}.`, bad: false })
    } catch (e) {
      bad(words(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Group title="Export a backup">
      <form
        className="flex flex-col gap-3"
        onSubmit={e => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="flex flex-wrap gap-3">
          <PassField label="Passphrase" value={pass} onChange={setPass} />
          <PassField label="Repeat the passphrase" value={again} onChange={setAgain} />
        </div>
        {!desktop && (
          <div className="flex flex-col gap-1">
            <label htmlFor={pathId} className="lk-label text-[11px] text-ink-2">
              Full path of the file
            </label>
            <span className="lk-field">
              <b aria-hidden>&gt;</b>
              <input id={pathId} value={path} onChange={e => setPath(e.target.value)} autoComplete="off" spellCheck={false} placeholder="C:\Backups\mini-hub.minihub" />
            </span>
          </div>
        )}
        <p className="text-small text-ink-3">Keep the passphrase safe: without it the backup cannot be opened. Passwords, pairings and switches are not in the backup.</p>
        <div>
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>
            {desktop ? 'Choose where to save' : 'Save the backup'}
          </Button>
        </div>
      </form>
      <Said said={said} />
    </Group>
  )
}

// --- Import ---

type Restored = { events: { added: number; skipped: number }; boards: number; devices: number; boardsLeftOut: number }

const restoredWords = (r: Restored): string =>
  `Brought back ${count(r.events.added, 'event', 'events')} (${r.events.skipped} ${r.events.skipped === 1 ? 'was' : 'were'} already here) and ${count(r.boards, 'board', 'boards')}. ` +
  'Switches are not in a backup: what is collected and what Mini may use stays as set in Permissions. Pair your phone and add your mail account again.' +
  (r.boardsLeftOut > 0 ? ` ${r.boardsLeftOut} ${r.boardsLeftOut === 1 ? 'board was' : 'boards were'} left out: 20 is the most.` : '')

function Import() {
  const client = useQueryClient()
  const desktop = inShell()
  const [pass, setPass] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null)
  const bad = (text: string) => setSaid({ text, bad: true })

  // The confirm's button waits a moment after the question appears.
  useEffect(() => {
    setArmed(false)
    if (!picked) return
    const t = setTimeout(() => setArmed(true), ARM_MS)
    return () => clearTimeout(t)
  }, [picked])

  const choose = async () => {
    if (!pass) return bad('Type the backup’s passphrase first.')
    setSaid(null)
    try {
      // Cancelled: nothing happens.
      const file = await pickOpen()
      if (file) setPicked(file)
    } catch {
      bad('The window for choosing a backup could not be opened.')
    }
  }

  // Cancel, Esc or a click outside: nothing is brought back, and the passphrase goes with the question.
  const cancel = () => {
    setPicked(null)
    setPass('')
  }

  const bringBack = async () => {
    const file = picked
    if (!file) return
    const passphrase = pass
    setPicked(null)
    setPass('')
    setBusy(true)
    setSaid(null)
    try {
      const done = await post<Restored>('/v1/data/import', { path: file, passphrase })
      setSaid({ text: restoredWords(done), bad: false })
    } catch (e) {
      bad(words(e))
    } finally {
      setBusy(false)
      // What is shown comes from the hub again: events, boards, devices and the settings.
      void client.invalidateQueries()
    }
  }

  if (!desktop)
    return (
      <Group title="Import a backup">
        <p className="text-small text-ink-3">Bringing back a backup needs the desktop app: it opens Windows’ own window to choose the file.</p>
      </Group>
    )

  return (
    <Group title="Import a backup">
      <form
        className="flex flex-col gap-3"
        onSubmit={e => {
          e.preventDefault()
          void choose()
        }}
      >
        <div className="flex flex-wrap gap-3">
          <PassField label="Passphrase of the backup" value={pass} onChange={setPass} />
        </div>
        <div>
          <Button type="submit" busy={busy} disabled={busy}>
            Choose a backup
          </Button>
        </div>
      </form>
      {busy && (
        <div className="flex items-center gap-3">
          <Munch label="Bringing it back" />
          <span className="text-small text-ink-2">Bringing it back</span>
        </div>
      )}
      <Said said={said} />
      {picked && (
        <Dialog label="Bring back a backup" onClose={cancel}>
          <p className="text-body">Bring back the events and boards in this backup? What is here already stays.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={cancel}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!armed}
              onClick={e => {
                // The second click of a double click is not an answer.
                if (e.detail > 1) return
                void bringBack()
              }}
            >
              Bring it back
            </Button>
          </div>
        </Dialog>
      )}
    </Group>
  )
}

// --- Delete ---

/** How many events there are of these types: counted a page at a time, so the question can say exactly. */
async function countOf(types: EventType[], cancelled: () => boolean): Promise<number> {
  let n = 0
  let cursor: string | undefined
  do {
    const q = new URLSearchParams()
    for (const t of types) q.append('type', t)
    q.set('limit', '200')
    if (cursor) q.set('cursor', cursor)
    const page = await api<{ items: unknown[]; cursor?: string }>(`/v1/events?${q}`)
    if (cancelled()) throw new Error('Stopped.')
    n += page.items.length
    cursor = page.cursor
  } while (cursor)
  return n
}

function Remove() {
  const client = useQueryClient()
  const pick = useId()
  const [kind, setKind] = useState('')
  const [asking, setAsking] = useState<(typeof KINDS)[number] | null>(null)
  /** How many would go: null while it is being counted. */
  const [total, setTotal] = useState<number | null>(null)
  const [problem, setProblem] = useState('')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    setTotal(null)
    setProblem('')
    setArmed(false)
    if (!asking) return
    let stop = false
    const t = setTimeout(() => setArmed(true), ARM_MS)
    countOf(asking.types, () => stop).then(
      n => !stop && setTotal(n),
      e => !stop && setProblem(`The items could not be counted. ${words(e)}`),
    )
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [asking])

  const close = () => setAsking(null)

  const remove = async () => {
    if (!asking) return
    const { label, types } = asking
    setBusy(true)
    try {
      const done = await del<{ removed: number }>('/v1/events', { types })
      setSaid({ text: `Deleted ${count(done.removed, 'item', 'items')} (${label}).`, bad: false })
      close()
    } catch (e) {
      setProblem(words(e))
    } finally {
      setBusy(false)
      void client.invalidateQueries()
    }
  }

  const chosen = KINDS.find(k => k.id === kind)

  return (
    <Group title="Delete">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-col gap-1">
          <label htmlFor={pick} className="lk-label text-[11px] text-ink-2">
            What to delete
          </label>
          <select
            id={pick}
            value={kind}
            onChange={e => (setKind(e.target.value), setSaid(null))}
            className="h-[34px] w-full border-2 border-ink bg-card px-2 font-mono text-small text-ink focus-visible:border-accent"
          >
            <option value="">Choose a kind</option>
            {KINDS.map(k => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="danger"
          disabled={!chosen || busy}
          onClick={e => {
            if (e.detail > 1 || !chosen) return
            setSaid(null)
            setAsking(chosen)
          }}
        >
          Delete all of these
        </Button>
      </div>
      <Said said={said} />
      {asking && (
        <Dialog label="Are you sure?" onClose={close}>
          <p className="text-body">Delete every {asking.noun} item from Mini Hub? This cannot be undone. Your phone and your mail account keep their own copies.</p>
          {total === null && !problem && (
            <p role="status" className="text-small text-ink-2">
              Counting…
            </p>
          )}
          {total !== null && (
            <p role="status" className="text-small font-bold">
              {total === 0 ? 'There are none to delete.' : `${count(total, 'item', 'items')} of ${asking.label} will be deleted.`}
            </p>
          )}
          {problem && (
            <p role="alert" className="text-small text-danger">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button data-autofocus onClick={close}>
              Keep them
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={!armed || !total || busy}
              onClick={e => {
                // The second click of a double click is not an answer.
                if (e.detail > 1) return
                void remove()
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </Group>
  )
}

export function Data() {
  return (
    <Tile title="Data">
      <div className="flex flex-col gap-4">
        <Keeping />
        <Export />
        <Import />
        <Remove />
      </div>
    </Tile>
  )
}

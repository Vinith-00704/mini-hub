// The Inbox (docs/07 > Inbox): one timeline of what came in, newest first and grouped by day, with filters and
// search; the selected item on the right with that person's recent items, Mark seen, Delete and Ask Mini.
// The phone's own state changes are not listed here (the device's page shows them).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { Bell, Mail, MessageSquare, Phone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, del, post } from '../../app/api.ts'
import { runAction } from '../../app/tickets.ts'
import { useDevices, useEvents, useGrants, useMini, useSettings, type EventRow } from '../../app/queries.ts'
import { Line, Masked } from '../../components/ui/bits.tsx'
import { PlainText, visible } from '../../components/look/plainText.tsx'
import { chatWho, notificationText } from '../../widgets/list.tsx'
import { Button, Choice, Munch, Row, Switch, Tag, Window } from '../../components/look/index.ts'

const KINDS = {
  all: { label: 'All', types: ['call', 'sms', 'chat', 'notification', 'mail'] },
  calls: { label: 'Calls', types: ['call'] },
  messages: { label: 'Messages', types: ['sms', 'chat'] },
  mail: { label: 'Mail', types: ['mail'] },
  notifications: { label: 'Notifications', types: ['notification'] },
} as const
type Kind = keyof typeof KINDS

/** The permission that decides whether Mini may read this kind of item (docs/03 > Scopes). */
const SCOPE: Record<string, string> = { call: 'phone.calls.read', sms: 'phone.messages.read', chat: 'phone.messages.read', notification: 'phone.notifications.read', mail: 'mail.read' }

const icon = (type: string) => {
  const size = 14
  if (type === 'call') return <Phone aria-hidden size={size} />
  if (type === 'mail') return <Mail aria-hidden size={size} />
  if (type === 'notification') return <Bell aria-hidden size={size} />
  return <MessageSquare aria-hidden size={size} />
}

const kindWord = (e: EventRow) => (e.type === 'sms' ? 'SMS' : e.type === 'chat' ? (e.app ?? 'Chat') : e.type === 'call' ? 'Call' : e.type === 'mail' ? 'Mail' : (e.app ?? 'Notification'))
// A mail's line is its subject; its text is in the pane on the right.
const text = (e: EventRow) => (e.type === 'notification' ? notificationText(e) : e.type === 'mail' ? visible(e.title ?? '(no subject)') : (e.body ?? e.title ?? ''))
/** The name on a line: the app for a notification, sender and conversation for a chat. */
const name = (e: EventRow) => (e.type === 'notification' ? (e.app ?? 'Notification') : e.type === 'chat' ? chatWho(e) : e.type === 'mail' ? visible(e.who ?? kindWord(e)) : (e.who ?? kindWord(e)))
/** What a line of an item shows; the command box's results use the same words and icons. */
export { icon as eventIcon, name as eventWho, text as eventText, kindWord as eventKind }
const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function dayOf(at: number): string {
  const d = new Date(at)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

/** A mail in full: who it is from and to, its subject, the text the hub kept, its attachments (listed, never opened), and a way to read the rest. */
function MailDetail({ e }: { e: EventRow }) {
  const [whole, setWhole] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const to = strings(e.data.to)
  const cc = strings(e.data.cc)
  const attachments = Array.isArray(e.data.attachments) ? (e.data.attachments as Array<{ name?: unknown; type?: unknown; size?: unknown }>) : []
  const from = e.who && e.whoKey && e.who !== e.whoKey ? `${e.who} (${e.whoKey})` : (e.who ?? e.whoKey ?? 'Unknown')

  const fetchWhole = async () => {
    setBusy(true)
    setFailure('')
    try {
      const t = await runAction({ connector: 'mail', device: e.deviceId, name: 'read', args: { ref: { event: e.id } } })
      if (!t.done) setFailure('The mail server did not answer.')
      else if (!t.ok) setFailure(t.error ?? 'The mail could not be read.')
      else setWhole(typeof t.data?.text === 'string' ? t.data.text : '')
    } catch (x) {
      setFailure((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const line = (name: string, value: string) => (
    <div className="flex gap-2">
      <dt className="w-10 shrink-0 text-micro text-ink-3">{name}</dt>
      <dd className="min-w-0 flex-1 text-small break-words [overflow-wrap:anywhere]" dir="auto">
        <PlainText text={value} />
      </dd>
    </div>
  )
  return (
    <>
      <dl className="flex flex-col gap-1">
        {line('From', from)}
        {to.length > 0 && line('To', to.join(', '))}
        {cc.length > 0 && line('Cc', cc.join(', '))}
      </dl>
      <h3 dir="auto" className="text-[15px] font-bold break-words [overflow-wrap:anywhere]">
        <PlainText text={e.title ?? '(no subject)'} />
      </h3>
      {whole !== null ? (
        <>
          <div
            role="region"
            tabIndex={0}
            aria-label="The whole mail"
            dir="auto"
            className="max-h-[50vh] overflow-auto border-2 border-ink bg-surface p-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {whole ? <PlainText text={whole} /> : 'This mail has no text.'}
          </div>
          <p role="status" className="text-micro text-ink-3">
            Fetched from the account just now; not kept in Mini Hub.
          </p>
        </>
      ) : e.body ? (
        <p dir="auto" className="text-[15px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          <PlainText text={e.body} />
        </p>
      ) : (
        <p className="text-small text-ink-3">Only the subject is kept (Settings &gt; Data).</p>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="lk-label text-[11px] text-ink-2">Attachments</span>
          <ul className="flex flex-col gap-0.5 text-small">
            {attachments.map((a, i) => (
              <li key={i} className="break-words [overflow-wrap:anywhere]">
                {typeof a.name === 'string' && a.name ? <PlainText text={a.name} /> : 'Unnamed'}
                {typeof a.size === 'number' && <span className="text-ink-3">{` · ${size(a.size)}`}</span>}
              </li>
            ))}
          </ul>
          <p className="text-micro text-ink-3">Attachments are listed, not downloaded.</p>
        </div>
      )}
      <div className="flex flex-col items-start gap-2">
        <Button size="sm" onClick={() => void fetchWhole()} disabled={busy}>
          Show the whole mail
        </Button>
        {busy && <Munch width={180} label="Fetching the mail" />}
        {failure && (
          <p role="alert" className="text-small text-danger">
            {failure}
          </p>
        )}
      </div>
    </>
  )
}

function Detail({ e, onGone }: { e: EventRow; onGone: () => void }) {
  const client = useQueryClient()
  const grants = useGrants().data?.items ?? []
  const mini = useMini().data
  const sender = e.whoKey ?? e.who
  const person = useEvents({ who: sender ?? '', limit: '10' }, Boolean(sender))
  const [question, setQuestion] = useState('Summarize this and tell me if I need to do anything.')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const refresh = () => void client.invalidateQueries({ queryKey: ['events'] })
  const seen = useMutation({ mutationFn: () => post('/v1/events/seen', { ids: [e.id] }), onSuccess: refresh, onError: (x: Error) => setNote(x.message) })
  const remove = useMutation({ mutationFn: () => del('/v1/events', { ids: [e.id] }), onSuccess: () => (refresh(), onGone()), onError: (x: Error) => setNote(x.message) })
  const ask = useMutation({
    mutationFn: () => post('/v1/mini/prompt', { text: question.trim(), share: [e.id] }),
    onSuccess: () => setNote('Sent to Mini with this item. The reply is on the Mini screen.'),
    onError: (x: Error) => setNote(x.message),
  })
  const scope = SCOPE[e.type]
  const grant = grants.find(g => g.scope === scope && (g.target === e.deviceId || g.target === 'mail'))
  const sharesAnyway = grant?.mini === 'off'
  // Selecting an item counts as seeing it.
  useEffect(() => {
    if (!e.seenAt) seen.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id])

  return (
    <Window title={name(e)} tag={<Tag tone="muted">{kindWord(e)}</Tag>} className="h-full">
      <div className="tabular text-micro text-ink-3">{new Date(e.occurredAt).toLocaleString()}</div>
      {e.type === 'mail' ? (
        <MailDetail e={e} />
      ) : (
        <>
          {e.title && e.body && e.title !== e.body && <p className="text-[15px] font-bold">{e.title}</p>}
          <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{e.body ?? e.title ?? '—'}</p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {e.seenAt ? <Tag tone="ok">Seen</Tag> : null}
        {!confirm ? (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        ) : (
          <span className="flex items-center gap-2 border-2 border-danger px-2 py-1 text-small">
            Delete it for good?
            <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
            <Button size="sm" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </span>
        )}
      </div>

      <form
        className="flex flex-col gap-2 border-t border-soft pt-3"
        onSubmit={ev => {
          ev.preventDefault()
          if (question.trim()) ask.mutate()
        }}
      >
        <span className="lk-label text-[11px] text-ink-2">Ask Mini about this</span>
        <div className="flex gap-2">
          <label className="lk-field flex-1">
            <b>&gt;</b>
            <input value={question} onChange={x => setQuestion(x.target.value)} aria-label="Ask Mini about this item" />
          </label>
          <Button type="submit" variant="primary" busy={ask.isPending} disabled={!question.trim() || !mini?.running}>
            Ask Mini
          </Button>
        </div>
        {!mini?.running && <p className="text-micro text-ink-3">Mini is not running. Start it on the Mini screen.</p>}
        {sharesAnyway && <p className="text-micro text-warn">This shares this item with Mini. Mini's switch for this kind stays off for everything else.</p>}
        {note && (
          <p role="status" className="text-micro text-ink-2">
            {note}
          </p>
        )}
      </form>

      {sender && (person.data?.items.length ?? 0) > 1 && (
        <div className="border-t border-soft pt-3">
          <span className="lk-label text-[11px] text-ink-2">Recently with {visible(e.who ?? "")}</span>
          <ul>
            {person.data!.items
              .filter(x => x.id !== e.id && x.type !== 'device_state')
              .slice(0, 6)
              .map(x => (
                <Row key={x.id} icon={icon(x.type)} title={<Masked text={text(x) || kindWord(x)} />} time={clock(x.occurredAt)} />
              ))}
          </ul>
        </div>
      )}
    </Window>
  )
}

export function Inbox() {
  const search = useSearch({ strict: false }) as { kind?: string; item?: number | string; device?: number | string; who?: unknown }
  const [kind, setKind] = useState<Kind>(search.kind && search.kind in KINDS ? (search.kind as Kind) : 'all')
  const [device, setDevice] = useState(search.device ? String(search.device) : '')
  // "From <name>": one person (their key or name), from the command box or a link; the address is where it lives.
  const [who, setWho] = useState(search.who === undefined || search.who === null ? '' : String(search.who))
  const [unseen, setUnseen] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<number | null>(search.item ? Number(search.item) : null)
  // The picked item itself, so it stays open after it leaves the list (seen, while "Unseen only" is on).
  const [picked, setPicked] = useState<EventRow | null>(null)
  const devices = useDevices().data?.items ?? []
  const privacy = useSettings().data?.privacy === true
  // The command box can send us here while this screen is open: follow the address when it changes.
  useEffect(() => {
    if (search.kind && search.kind in KINDS) setKind(search.kind as Kind)
  }, [search.kind])
  useEffect(() => {
    if (search.item !== undefined) setSelected(Number(search.item))
  }, [search.item])
  useEffect(() => {
    setWho(search.who === undefined || search.who === null ? '' : String(search.who))
    // A person from the command box: everything they sent, nothing picked yet.
    if (search.who !== undefined && search.kind === undefined) setKind('all')
    if (search.who !== undefined && search.item === undefined) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.who])
  const params: Record<string, string | string[]> = { type: [...KINDS[kind].types], limit: '100' }
  if (device) params.device = device
  if (who) params.who = who
  if (unseen) params.unseen = '1'
  if (q.trim()) params.q = q.trim()
  const events = useEvents(params)
  const items = events.data?.items ?? []
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: EventRow[] }> = []
    for (const e of items) {
      const d = dayOf(e.occurredAt)
      const last = out.at(-1)
      if (last?.day === d) last.items.push(e)
      else out.push({ day: d, items: [e] })
    }
    return out
  }, [items])
  const inList = items.find(e => e.id === selected) ?? (picked?.id === selected ? picked : null)
  // An item the command box opened may be older than the 100 listed, or not in this filter: fetch it by itself.
  const alone = useQuery({ queryKey: ['events', 'one', selected], queryFn: () => api<EventRow>(`/v1/events/${selected}`), enabled: selected !== null && !inList && !events.isPending, retry: false })
  const chosen = inList ?? (alone.data?.id === selected ? alone.data : null)
  const whoName = who ? visible(items.find(e => e.whoKey === who || e.who === who)?.who ?? who) : ''
  const clearWho = () => {
    setWho('')
    // Take it out of the address too, so choosing the same person again works.
    if (search.who !== undefined) window.location.hash = '#/inbox'
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 flex flex-wrap items-center gap-3">
        <Choice label="Show" value={kind} onChange={v => (setKind(v), setSelected(null))} options={(Object.keys(KINDS) as Kind[]).map(k => ({ value: k, label: KINDS[k].label }))} />
        {who && (
          <Tag tone="muted">
            <span dir="auto">From {whoName}</span>
            <button type="button" className="ml-1 cursor-pointer font-black hover:text-ink" aria-label={`Clear the filter: from ${whoName}`} onClick={clearWho}>
              ✕
            </button>
          </Tag>
        )}
        <select value={device} onChange={e => setDevice(e.target.value)} aria-label="From which device" className="h-[34px] border-2 border-ink bg-card px-2 text-[12px] font-bold uppercase">
          <option value="">All devices</option>
          {devices
            .filter(d => d.kind !== 'pc')
            .map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <span className="flex items-center gap-2 text-[12px] font-bold uppercase">
          Unseen only <Switch checked={unseen} onChange={setUnseen} label="Unseen only" />
        </span>
        <label className="lk-field min-w-48 flex-1">
          <b>/</b>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="search names and text…" aria-label="Search the Inbox" />
        </label>
      </div>

      <div className="col-span-12 min-[1000px]:col-span-7">
        <Window
          title={KINDS[kind].label}
          tag={items.length ? <Tag>{items.length >= 100 ? '100+' : items.length}</Tag> : undefined}
          state={events.isPending ? 'loading' : events.isError ? 'error' : items.length ? 'ready' : 'empty'}
          emptyText={q || unseen || device || who ? 'Nothing matches.' : 'Nothing yet. Turn on what to collect in Permissions.'}
          {...(q || unseen || device || who
            ? {}
            : {
                emptyAction: (
                  <a href="#/permissions">
                    <Button size="sm">Open Permissions</Button>
                  </a>
                ),
              })}
          {...(events.error ? { error: events.error.message } : {})}
          onRetry={() => void events.refetch()}
        >
          {groups.map(g => (
            <div key={g.day}>
              <div className="lk-label mt-1 mb-1 text-[11px] text-ink-3">{g.day}</div>
              <ul>
                {g.items.map(e => (
                  <li key={e.id} className={selected === e.id ? 'bg-card-bar outline-2 outline-accent' : ''}>
                    <button type="button" className="lk-row w-full cursor-pointer px-1 text-left hover:bg-card-bar" onClick={() => (setSelected(e.id), setPicked(e))} aria-current={selected === e.id || undefined}>
                      <span className={`lk-ib ${e.seenAt ? '' : 'acc'}`}>{icon(e.type)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <Line text={name(e)} className="text-[13.5px] font-bold" />
                          {!e.seenAt && <span className="sr-only">unseen</span>}
                        </span>
                        <span className={`block text-small text-ink-2 ${privacy ? 'privacy-blur' : ''}`}>
                          <Masked text={text(e)} />
                        </span>
                      </span>
                      <Tag tone="muted" className="hidden sm:inline-flex">
                        {kindWord(e)}
                      </Tag>
                      <span className="tabular shrink-0 text-micro text-ink-3">{clock(e.occurredAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Window>
      </div>

      <div className="col-span-12 min-[1000px]:col-span-5">
        {chosen ? (
          <Detail key={chosen.id} e={chosen} onGone={() => (setSelected(null), setPicked(null))} />
        ) : (
          <Window title="Selected" state="empty" emptyText={alone.isError ? 'That item is no longer here.' : 'Choose something on the left to see it in full, with what else that person sent.'} />
        )}
      </div>
    </div>
  )
}

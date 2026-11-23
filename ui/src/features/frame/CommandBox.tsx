// The command box (docs/07 > The frame > Command box): one box to ask Mini or to find things. Ctrl+K focuses it. From
// two characters, after a short pause, it lists: Ask Mini (always first), places to go, boards, devices, people and
// items (what came in). Arrow keys pick, Enter runs, Esc closes the list and then leaves the box. It only ever opens
// a place or asks Mini; it runs nothing else, so there is no action to confirm here.

import { useQuery } from '@tanstack/react-query'
import { ArrowRight, LayoutDashboard, Mail, Monitor, Smartphone, Sparkles, User } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../app/api.ts'
import { useDevices, useEvents, useSettings, type EventRow } from '../../app/queries.ts'
import { Masked } from '../../components/ui/bits.tsx'
import { Tag } from '../../components/look/index.ts'
import { visible } from '../../components/look/plainText.tsx'
import { openBoard, useBoardList } from '../boards/useBoards.ts'
import { eventIcon, eventKind, eventText, eventWho } from '../inbox/Inbox.tsx'

/** What the box searches in "Items": what came in, nothing else (the Inbox lists exactly these). */
const ITEM_TYPES = ['call', 'sms', 'chat', 'notification', 'mail']
/** The Inbox filter an item of each type belongs to (its `kind=` address). */
const KIND_OF: Record<string, string> = { call: 'calls', sms: 'messages', chat: 'messages', mail: 'mail', notification: 'notifications' }
const PER_SECTION = 5
const PAUSE_MS = 200
const MIN_CHARS = 2
// The hub searches at most this many characters; longer text is a prompt for Mini, not a search.
const MAX_SEARCH = 200

type Place = { label: string; href: string; words?: string }
const PLACES: Place[] = [
  { label: 'Home', href: '#/' },
  { label: 'Inbox', href: '#/inbox' },
  { label: 'Devices', href: '#/devices' },
  { label: 'Mini', href: '#/mini' },
  { label: 'Activity', href: '#/activity', words: 'audit log history' },
  { label: 'Permissions', href: '#/permissions', words: 'switches allow' },
  { label: 'Settings', href: '#/settings' },
  { label: 'Settings > Look', href: '#/settings?section=look', words: 'theme dark light colour density privacy' },
  { label: 'Settings > Data', href: '#/settings?section=data', words: 'backup export import keep delete' },
  { label: 'Settings > Network', href: '#/settings?section=network', words: 'address port' },
  { label: 'Settings > Start-up', href: '#/settings?section=startup', words: 'login autostart' },
  { label: 'Settings > Boards', href: '#/settings?section=boards', words: 'tiles' },
  { label: 'Settings > About', href: '#/settings?section=about', words: 'version' },
  { label: 'Add a phone', href: '#/devices?add=phone', words: 'pair android' },
  { label: 'Add a mail account', href: '#/devices?add=mail', words: 'email gmail outlook' },
]

const clean = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean)
const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * How well a text matches what was typed: 0 when it starts with it, 1 when a word does, 2 when it only holds it
 * (names only: `contains`), null when it does not match. Every typed word has to match.
 */
function score(query: string, text: string, contains: boolean): number | null {
  const typed = clean(query)
  if (typed.length === 0) return null
  const low = text.toLowerCase()
  const words = wordsOf(text)
  let best = 0
  for (const t of typed) {
    if (low.startsWith(t)) continue
    if (words.some(w => w.startsWith(t))) best = Math.max(best, 1)
    else if (contains && low.includes(t)) best = Math.max(best, 2)
    else return null
  }
  return best
}

/** The matches, best first, at most five; equal scores keep their order. */
function pick<T>(query: string, list: T[], text: (x: T) => string, contains: boolean): T[] {
  const out: Array<{ x: T; s: number; i: number }> = []
  list.forEach((x, i) => {
    const s = score(query, text(x), contains)
    if (s !== null) out.push({ x, s, i })
  })
  return out.sort((a, b) => a.s - b.s || a.i - b.i).slice(0, PER_SECTION).map(o => o.x)
}

type Person = { who: string; whoKey: string; count: number; lastAt: number }
/** One thing the list can run. */
type Option = { key: string; icon: ReactNode; label: ReactNode; source: string; run: () => void }
type Section = { id: string; title: string; options: Option[]; note?: string }

const go = (href: string) => {
  window.location.hash = href
}
/** A value in an address, quoted so a key that looks like a number or a word stays text. */
const q = (v: string) => encodeURIComponent(JSON.stringify(v))

export function CommandBox({ onAsk, sending, onEdit }: { onAsk: (text: string) => Promise<unknown>; sending: boolean; onEdit: () => void }) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [settled, setSettled] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('ask')
  const privacy = useSettings().data?.privacy === true
  const typed = text.trim()
  const searching = settled.length >= MIN_CHARS && settled.length <= MAX_SEARCH
  const tooLong = typed.length > MAX_SEARCH

  // The list waits for a pause in typing.
  useEffect(() => {
    if (typed.length < MIN_CHARS) return setSettled('')
    const t = window.setTimeout(() => setSettled(typed), PAUSE_MS)
    return () => window.clearTimeout(t)
  }, [typed])

  // Ctrl+K from anywhere.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return
      const input = inputRef.current
      // A dialog keeps the rest of the page inert: leave the key alone then.
      if (!input || input.closest('[inert]')) return
      e.preventDefault()
      input.focus()
      input.select()
      setOpen(true)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const boards = useBoardList().data?.items ?? []
  const devices = useDevices().data?.items ?? []
  const people = useQuery({ queryKey: ['events', 'people'], queryFn: () => api<{ items: Person[] }>('/v1/people'), enabled: searching, staleTime: 30_000 })
  const items = useEvents({ type: ITEM_TYPES, q: settled, limit: '8' }, searching)

  const clearAndLeave = () => {
    setText('')
    setSettled('')
    setOpen(false)
    inputRef.current?.blur()
  }
  const ask = (t: string) => {
    if (sending || !t.trim()) return
    setOpen(false)
    void onAsk(t.trim()).then(
      () => (setText(''), setSettled('')),
      () => undefined, // the top bar says what went wrong, under the box
    )
  }

  const sections = useMemo<Section[]>(() => {
    if (!searching) return []
    const out: Section[] = []
    const places = pick(settled, PLACES, p => `${p.label} ${p.words ?? ''}`, false)
    if (places.length) out.push({ id: 'go', title: 'Go to', options: places.map(p => ({ key: `go:${p.href}`, icon: <ArrowRight aria-hidden size={14} />, label: p.label, source: 'Go to', run: () => (go(p.href), clearAndLeave()) })) })
    const bs = pick(settled, boards, b => b.name, true)
    if (bs.length) out.push({ id: 'boards', title: 'Boards', options: bs.map(b => ({ key: `board:${b.id}`, icon: <LayoutDashboard aria-hidden size={14} />, label: b.name, source: 'Board', run: () => (openBoard(b.id), clearAndLeave()) })) })
    const ds = pick(settled, devices, d => d.name, true)
    if (ds.length)
      out.push({
        id: 'devices',
        title: 'Devices',
        options: ds.map(d => ({ key: `device:${d.id}`, icon: d.kind === 'phone' ? <Smartphone aria-hidden size={14} /> : d.kind === 'mail-account' ? <Mail aria-hidden size={14} /> : <Monitor aria-hidden size={14} />, label: d.name, source: 'Device', run: () => (go(`#/devices/${encodeURIComponent(d.id)}`), clearAndLeave()) })),
      })
    const ps = pick(settled, people.data?.items ?? [], p => `${p.who} ${p.whoKey}`, true)
    if (ps.length) out.push({ id: 'people', title: 'People', options: ps.map(p => ({ key: `person:${p.whoKey}`, icon: <User aria-hidden size={14} />, label: (
              <>
                <bdi>{visible(p.who)}</bdi>
                {p.whoKey !== p.who && (
                  <span className="font-normal text-ink-3">
                    {' · '}
                    <bdi>{visible(p.whoKey)}</bdi>
                  </span>
                )}
              </>
            ), source: 'Person', run: () => (go(`#/inbox?who=${q(p.whoKey)}`), clearAndLeave()) })) })
    const rows = (items.data?.items ?? []).filter(e => e.type in KIND_OF).slice(0, PER_SECTION)
    const section: Section = {
      id: 'items',
      title: 'Items',
      options: rows.map((e: EventRow) => ({
        key: `item:${e.id}`,
        icon: eventIcon(e.type),
        label: (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="max-w-[40%] shrink-0 truncate font-bold" dir="auto">
              <bdi>{visible(eventWho(e))}</bdi>
            </span>
            <span className={`min-w-0 flex-1 font-normal text-ink-2 ${privacy ? 'privacy-blur' : ''}`} dir="auto">
              <Masked text={visible(eventText(e))} />
            </span>
          </span>
        ),
        source: eventKind(e),
        run: () => (go(`#/inbox?kind=${KIND_OF[e.type]}&item=${e.id}`), clearAndLeave()),
      })),
    }
    if (items.isError) section.note = `Search did not work: ${items.error.message}`
    else if (people.isError) section.note = `Search did not work: ${people.error.message}`
    else if (items.isLoading) section.note = 'Searching…'
    if (section.options.length || section.note) out.push(section)
    return out
    // clearAndLeave only touches state setters and a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, settled, boards, devices, people.data, people.isError, people.error, items.data, items.isError, items.isLoading, items.error, privacy])

  const askOption: Option = { key: 'ask', icon: <Sparkles aria-hidden size={14} />, label: <span className="font-bold">Ask Mini: {typed}</span>, source: 'Mini', run: () => ask(typed) }
  const options = [askOption, ...sections.flatMap(s => s.options)]
  const settledAll = searching && settled === typed && !items.isLoading && !people.isLoading
  const found = options.length - 1
  const nothing = settledAll && !items.isError && !people.isError && found === 0
  const expanded = open && typed.length >= MIN_CHARS
  const at = Math.max(0, options.findIndex(o => o.key === active))
  const activeKey = options[at]?.key ?? 'ask'
  const optionId = (key: string) => `${id}-o-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`

  // A new search starts on Ask Mini again.
  useEffect(() => setActive('ask'), [settled])
  // Keep the picked row in view.
  useEffect(() => {
    if (expanded) document.getElementById(optionId(activeKey))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, expanded])

  const announce = !expanded
    ? ''
    : tooLong
      ? 'Too long to search'
      : items.isError || people.isError
      ? 'Search did not work'
      : !settledAll
        ? ''
        : found === 0
          ? 'Nothing found'
          : `${found} ${found === 1 ? 'result' : 'results'}`

  const move = (by: number) => setActive(options[(at + by + options.length) % options.length]?.key ?? 'ask')

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // A key that an input method is still composing with belongs to it: its Enter picks a word, it does not ask Mini.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      // Esc closes the list; a second one leaves the box.
      if (expanded) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      } else {
        inputRef.current?.blur()
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (typed.length < MIN_CHARS) return
      e.preventDefault()
      if (!expanded) return setOpen(true)
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!typed) return
      if (e.repeat) return
      // With the list closed, or on its first row, Enter asks Mini.
      if (expanded) options[at]?.run()
      else ask(typed)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const heading = (s: Section) => `${id}-h-${s.id}`

  return (
    <div
      ref={boxRef}
      className="relative flex min-w-40 flex-1"
      onBlur={e => {
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <label className="lk-field w-full">
        <b aria-hidden>/</b>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Ask Mini or search"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          {...(expanded ? { 'aria-activedescendant': optionId(activeKey) } : {})}
          autoComplete="off"
          spellCheck={false}
          maxLength={2000}
          value={text}
          placeholder="Ask Mini or search…  Ctrl+K"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={e => (setText(e.target.value), setOpen(true), onEdit())}
          onKeyDown={onKeyDown}
        />
        {sending && <span className="text-micro text-ink-3">sending…</span>}
      </label>
      <p role="status" className="sr-only">
        {announce}
      </p>
      <ul id={listId} role="listbox" aria-label="Results" hidden={!expanded} onMouseDown={e => e.preventDefault()} className="lk-drop absolute top-[40px] left-0 z-50 max-h-[60vh] w-full min-w-[380px] overflow-y-auto border-2 border-ink bg-card shadow-[4px_4px_0_var(--shadow)]">
        {expanded && (
          <>
            <Rows options={[askOption]} active={activeKey} optionId={optionId} onPick={o => o.run()} onHover={setActive} />
            {sections.map(s => (
              <li key={s.id} role="presentation">
                <div id={heading(s)} className="lk-label px-3 pt-2 pb-1 text-[11px] text-ink-3">
                  {s.title}
                </div>
                <ul role="group" aria-labelledby={heading(s)}>
                  <Rows options={s.options} active={activeKey} optionId={optionId} onPick={o => o.run()} onHover={setActive} />
                </ul>
                {s.note && <div className={`px-3 py-2 text-small ${s.note.startsWith('Search did not') ? 'text-danger' : 'text-ink-3'}`}>{s.note}</div>}
              </li>
            ))}
            {tooLong && (
              <li role="presentation" className="px-3 py-2 text-small text-ink-3">
                Too long to search. Enter asks Mini.
              </li>
            )}
            {nothing && !tooLong && (
              <li role="presentation" className="px-3 py-2 text-small text-ink-3">
                Nothing found. Enter asks Mini.
              </li>
            )}
          </>
        )}
      </ul>
    </div>
  )
}

function Rows({ options, active, optionId, onPick, onHover }: { options: Option[]; active: string; optionId: (key: string) => string; onPick: (o: Option) => void; onHover: (key: string) => void }) {
  return (
    <>
      {options.map(o => (
        <li
          key={o.key}
          id={optionId(o.key)}
          role="option"
          aria-selected={o.key === active}
          className={`lk-row cursor-pointer gap-2 px-3 text-small ${o.key === active ? 'bg-card-bar outline-2 -outline-offset-2 outline-accent' : ''}`}
          // Keep the focus in the box while the pointer picks.
          onMouseDown={e => e.preventDefault()}
          onMouseMove={() => o.key !== active && onHover(o.key)}
          onClick={e => {
            // A double press runs once.
            if (e.detail > 1) return
            onPick(o)
          }}
        >
          <span className="lk-ib">{o.icon}</span>
          <span className="block min-w-0 flex-1 truncate text-[13.5px]">{o.label}</span>
          <Tag tone="muted" className="shrink-0">
            {o.source}
          </Tag>
        </li>
      ))}
    </>
  )
}

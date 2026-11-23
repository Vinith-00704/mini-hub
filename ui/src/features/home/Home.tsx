// Home: the open board (docs/07 > Home, Making it one's own). The board in the address (?board=<id>), else the one
// opened last, else the first. The head shows its name, the pencil for edit mode and, on the first board only, the
// headline numbers; the boards' tabs sit above the grid.

import { useSearch } from '@tanstack/react-router'
import { Pencil, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStats } from '../../app/queries.ts'
import { Button, Stat, Window } from '../../components/look/index.ts'
import { Board, BoardSkeleton, KEYS_ID, tileTitle } from '../boards/Board.tsx'
import { BoardTabs, tabId } from '../boards/BoardTabs.tsx'
import { Gallery } from '../boards/Gallery.tsx'
import { addAtEnd, readingOrder } from '../boards/layout.ts'
import { TileSettings } from '../boards/TileSettings.tsx'
import { openBoard, pickBoard, rememberBoard, useBoardLayout, useBoardList } from '../boards/useBoards.ts'
import { PageHead } from '../frame/Frame.tsx'

function Numbers() {
  const s = useStats(7).data
  const t = s?.today
  const y = s?.yesterday
  const go = (to: string) => () => (window.location.hash = to)
  return (
    <div className="flex flex-wrap" aria-label="Today">
      <Stat label="Calls today" value={t?.calls ?? '–'} {...(t && y ? { delta: t.calls - y.calls } : {})} onClick={go('#/inbox?kind=calls')} />
      <Stat label="Messages" value={t?.messages ?? '–'} {...(t && y ? { delta: t.messages - y.messages } : {})} onClick={go('#/inbox?kind=messages')} />
      <Stat label="Mini did" value={t?.miniDid ?? '–'} {...(t && y ? { delta: t.miniDid - y.miniDid } : {})} onClick={go('#/activity')} />
      <Stat label="Waiting" value={t?.waiting ?? '–'} accent={(t?.waiting ?? 0) > 0} onClick={() => document.querySelector('section[aria-label="Waiting for you"]')?.scrollIntoView({ block: 'center' })} />
    </div>
  )
}

const WIDE = '(min-width: 900px)'

/** At least 900 px wide: the board is a grid and can be arranged. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true)
  useEffect(() => {
    const m = window.matchMedia?.(WIDE)
    if (!m) return
    const on = () => setWide(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

const NARROW = 'Widen the window to arrange tiles.'

export function Home() {
  const search = useSearch({ strict: false }) as { board?: unknown }
  const asked = search.board === undefined ? undefined : String(search.board)
  const list = useBoardList()
  const boards = list.data?.items ?? []
  const board = pickBoard(boards, asked)
  const layout = useBoardLayout(board)
  const wide = useWide()
  const [editing, setEditing] = useState(false)
  const [focusTile, setFocusTile] = useState<string | null>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  const undoButton = useRef<HTMLButtonElement>(null)
  const backToPencil = useRef(false)
  const [gallery, setGallery] = useState(false)
  const [settingsOf, setSettingsOf] = useState<string | null>(null)
  const openGallery = () => setGallery(true)

  useEffect(() => {
    if (board) rememberBoard(board.id)
  }, [board?.id])
  useEffect(() => {
    if (!wide) setEditing(false)
  }, [wide])
  useEffect(() => {
    if (editing || !backToPencil.current) return
    backToPencil.current = false
    pencil.current?.focus()
  }, [editing])
  const focused = useCallback(() => setFocusTile(null), [])

  /** The gallery's Add: the tile goes at the bottom, the gallery closes and the new tile has focus. Gives a reason when it cannot. */
  const addTile = (type: string): string | null => {
    try {
      addAtEnd(layout.widgets, type)
    } catch (e) {
      return (e as Error).message
    }
    const before = new Set(layout.widgets.map(t => t.id))
    const r = layout.apply(ws => addAtEnd(ws, type))
    const added = r.widgets.find(t => !before.has(t.id))
    if (!r.changed || !added) return 'That tile could not be added.'
    setGallery(false)
    // Said once the gallery has given the page back: words changed while it is still out of reach may not be read out.
    setTimeout(() => layout.say(`Added ${tileTitle(added)}.`), 150)
    if (wide) {
      setEditing(true)
      setFocusTile(added.id)
    }
    return null
  }

  const startEditing = () => {
    setEditing(true)
    setFocusTile(readingOrder(layout.widgets)[0]?.id ?? null)
  }
  const stopEditing = () => {
    backToPencil.current = true
    setEditing(false)
  }

  // In edit mode, Escape leaves it and Ctrl+Z undoes wherever the focus is, also on the page itself after a click on
  // nothing or when a tile is gone. Not while typing; a menu, a name box or a drag open on the board takes its own
  // Escape first.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keysRef.current = e => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement | null
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || Boolean(t?.isContentEditable)
    if (typing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      stopEditing()
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (!layout.undo()) layout.say('There is nothing to undo.')
    }
  }
  useEffect(() => {
    if (!editing) return
    const on = (e: KeyboardEvent) => keysRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [editing])

  if (list.isPending)
    return (
      <>
        <PageHead title="Home" />
        <BoardSkeleton />
      </>
    )
  // A failed fetch with a board in hand (the hub restarting) keeps the board; the error shows only without one.
  if (!board)
    return (
      <>
        <PageHead title="Home" />
        <Window title="Boards" state="error" error={list.error?.message ?? 'The hub sent no boards.'} onRetry={() => void list.refetch()} />
      </>
    )

  const first = boards[0]?.id === board.id
  // A tile removed in another window while its settings are open closes them.
  const settingsTile = settingsOf ? layout.widgets.find(t => t.id === settingsOf) : undefined

  return (
    <div>
      <PageHead title={board.name}>
        {first && <Numbers />}
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button onClick={openGallery}>Add a tile</Button>
              <button ref={undoButton} type="button" className="lk-btn" disabled={!layout.canUndo} onClick={() => layout.undo()}>
                <Undo2 aria-hidden size={14} />
                Undo
              </button>
              <Button variant="primary" onClick={stopEditing}>
                Done
              </Button>
            </>
          ) : (
            <span title={wide ? undefined : NARROW}>
              <button ref={pencil} type="button" className="lk-btn" aria-label="Edit this board" title={wide ? 'Edit this board' : NARROW} disabled={!wide} onClick={startEditing}>
                <Pencil aria-hidden size={15} />
              </button>
            </span>
          )}
        </div>
      </PageHead>

      <BoardTabs boards={boards} active={board.id} onOpen={openBoard} />

      {editing && (
        <p id={KEYS_ID} className="mb-1 text-small text-ink-2">
          Drag a tile by its bar, or its corner to resize it. With the keys: arrows move the tile with focus, Shift and
          arrows resize it, Delete removes it, Enter opens its settings, Ctrl+Z undoes, Esc ends.
        </p>
      )}
      <p role="status" aria-live="polite" className={editing ? 'mb-3 min-h-[18px] text-small text-ink' : 'sr-only'}>
        {layout.said.text}
        {/* The same words said twice are still read out: every other time they carry an invisible space. */}
        {layout.said.n % 2 ? ' ' : ''}
      </p>
      {layout.failure && <p className="mb-3 border-2 border-danger bg-card px-3 py-2 text-small text-danger">{layout.failure}</p>}

      <Board
        layout={layout}
        labelledBy={tabId(board.id)}
        editing={editing}
        wide={wide}
        onEditing={on => (on ? setEditing(true) : stopEditing())}
        focusTile={focusTile}
        onFocused={focused}
        onAddTile={openGallery}
        onTileSettings={setSettingsOf}
        onNoTileLeft={() => requestAnimationFrame(() => (undoButton.current ?? pencil.current)?.focus())}
      />

      {gallery && <Gallery onAdd={addTile} onClose={() => setGallery(false)} />}
      {settingsTile && (
        <TileSettings
          tile={settingsTile}
          title={tileTitle(settingsTile)}
          problem={layout.failure}
          onChange={settings => layout.apply(ws => ws.map(t => (t.id === settingsTile.id ? { ...t, settings } : t)))}
          onClose={() => setSettingsOf(null)}
        />
      )}
    </div>
  )
}

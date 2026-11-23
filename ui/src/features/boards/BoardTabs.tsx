// The boards as tabs above the grid (docs/07 > Making it one's own): one tab per board, arrow keys (and Home, End)
// move between them, Enter opens; tabs can be dragged to a new place. Board options holds Rename, Duplicate, Move
// left, Move right, Reset to the default and Delete; New board asks for a name in place.

import type { Board } from '@minihub/protocol'
import { MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Button } from '../../components/look/index.ts'
import { copyName, deleteQuestion, MAX_BOARDS, NAME_MAX, nameProblem, resetQuestion, TOO_MANY_BOARDS, useBoardActions } from './useBoards.ts'

export const tabId = (id: string): string => `board-tab-${id}`

type Naming = { kind: 'new' } | { kind: 'rename'; id: string; name: string }
type Reorder = { id: string; pointer: number; x: number; y: number; moving: boolean; index: number; mark?: { left: number; top: number; height: number } }

function MenuItem({ onClick, disabled, danger, title, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-small font-bold hover:bg-card-bar focus-visible:bg-card-bar disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent ${danger ? 'text-danger' : ''}`}
    >
      {children}
    </button>
  )
}

export function BoardTabs({ boards, active, onOpen }: { boards: Board[]; active: string; onOpen: (id: string) => void }) {
  const actions = useBoardActions()
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const strip = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  /** A tab to give focus to once it is shown (a board just made, or the one opened after a delete). */
  const focusTab = useRef<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState<Naming | null>(null)
  const [name, setName] = useState('')
  const [asking, setAsking] = useState<'reset' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const [reorder, setReorder] = useState<Reorder | null>(null)
  const reorderRef = useRef<Reorder | null>(null)
  const dragged = useRef(false)
  const questionId = useId()

  const index = Math.max(0, boards.findIndex(b => b.id === active))
  const current = boards[index]
  const full = boards.length >= MAX_BOARDS
  const fail = (e: Error) => setNote(e.message)
  const later = (el: () => HTMLElement | null | undefined) => requestAnimationFrame(() => el()?.focus())
  const openAndFocus = (id: string) => {
    focusTab.current = id
    onOpen(id)
  }

  useEffect(() => {
    const id = focusTab.current
    if (!id || active !== id || !tabs.current.has(id)) return
    focusTab.current = null
    tabs.current.get(id)?.focus()
  }, [boards, active])

  // The menu: focus on its first item when it opens; a click anywhere else closes it.
  useEffect(() => {
    if (!menu) return
    menuBox.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const away = (e: Event) => {
      if (!menuBox.current?.contains(e.target as Node) && !menuButton.current?.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [menu])

  const closeMenu = (refocus = true) => {
    setMenu(false)
    if (refocus) menuButton.current?.focus()
  }

  const menuKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuBox.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => (e.preventDefault(), items[(i + items.length) % items.length]?.focus())
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
    } else if (e.key === 'Tab') setMenu(false)
  }

  const tabKeys = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const go = (j: number) => (e.preventDefault(), tabs.current.get(boards[(j + boards.length) % boards.length].id)?.focus())
    if (e.key === 'ArrowRight') go(i + 1)
    else if (e.key === 'ArrowLeft') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(boards.length - 1)
  }

  // --- Dragging a tab to a new place ---

  const placeAt = (r: Reorder, px: number, py: number): Reorder => {
    const others = boards.filter(b => b.id !== r.id)
    const box = strip.current?.getBoundingClientRect()
    let at = 0
    for (const b of others) {
      const t = tabs.current.get(b.id)?.getBoundingClientRect()
      if (t && (py > t.bottom || (py >= t.top && px > t.left + t.width / 2))) at++
    }
    const near = tabs.current.get((others[at] ?? others.at(-1))?.id ?? '')?.getBoundingClientRect()
    const mark = near && box ? { left: (others[at] ? near.left - 6 : near.right + 4) - box.left, top: near.top - box.top, height: near.height } : undefined
    return { ...r, index: at, ...(mark ? { mark } : {}) }
  }

  const drag = (b: Board, i: number) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      dragged.current = false
      if (e.button !== 0 || boards.length < 2) return
      e.currentTarget.setPointerCapture(e.pointerId)
      reorderRef.current = { id: b.id, pointer: e.pointerId, x: e.clientX, y: e.clientY, moving: false, index: i }
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const r = reorderRef.current
      if (!r || r.pointer !== e.pointerId) return
      if (!r.moving && Math.hypot(e.clientX - r.x, e.clientY - r.y) < 6) return
      const next = placeAt({ ...r, moving: true }, e.clientX, e.clientY)
      reorderRef.current = next
      setReorder(next)
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const r = reorderRef.current
      if (!r || r.pointer !== e.pointerId) return
      reorderRef.current = null
      setReorder(null)
      if (!r.moving) return
      // The click that follows the drop does not open the tab.
      dragged.current = true
      const from = boards.findIndex(o => o.id === r.id)
      if (r.index !== from) actions.move.mutate({ id: r.id, position: r.index }, { onError: fail })
    },
    onPointerCancel: () => {
      reorderRef.current = null
      setReorder(null)
    },
  })

  // --- Names ---

  const startNaming = (n: Naming) => {
    setNote('')
    setNaming(n)
    setName(n.kind === 'rename' ? n.name : '')
  }

  const submitName = () => {
    if (!naming) return
    const problem = nameProblem(name)
    if (problem) return setNote(problem)
    const done = () => (setNaming(null), setNote(''))
    if (naming.kind === 'new')
      actions.create.mutate({ name: name.trim() }, { onSuccess: b => (done(), openAndFocus(b.id)), onError: fail })
    else {
      const id = naming.id
      actions.rename.mutate({ id, name: name.trim() }, { onSuccess: () => (done(), tabs.current.get(id)?.focus()), onError: fail })
    }
  }

  const confirm = () => {
    if (!current || !asking) return
    if (asking === 'reset')
      actions.reset.mutate(current.id, { onSuccess: () => (setAsking(null), setNote(''), later(() => menuButton.current)), onError: fail })
    else {
      const next = boards[index + 1] ?? boards[index - 1]
      actions.remove.mutate(current.id, { onSuccess: () => (setAsking(null), setNote(''), next && openAndFocus(next.id)), onError: fail })
    }
  }

  /** Closing the name box gives focus back to what opened it. */
  const stopNaming = () => {
    const was = naming
    setNaming(null)
    setNote('')
    later(() => (was?.kind === 'rename' ? tabs.current.get(was.id) : newButton.current))
  }

  const busy = actions.create.isPending || actions.rename.isPending || actions.reset.isPending || actions.remove.isPending

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div ref={strip} className="relative flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Boards" className="flex flex-wrap items-center gap-2">
          {boards.map((b, i) => {
            const on = b.id === active
            return (
              <button
                key={b.id}
                ref={el => {
                  if (el) tabs.current.set(b.id, el)
                  else tabs.current.delete(b.id)
                }}
                type="button"
                role="tab"
                id={tabId(b.id)}
                aria-selected={on}
                aria-controls="board-panel"
                tabIndex={on ? 0 : -1}
                title={b.name}
                onKeyDown={tabKeys(i)}
                onClick={() => {
                  if (dragged.current) return void (dragged.current = false)
                  if (!on) onOpen(b.id)
                }}
                {...drag(b, i)}
                className={`max-w-[16rem] touch-none truncate border-2 border-ink px-3 py-1.5 text-[11.5px] font-extrabold tracking-[0.07em] uppercase select-none ${
                  on ? 'bg-accent text-on-accent shadow-[3px_3px_0_var(--shadow)]' : 'bg-card text-ink-2 hover:text-ink'
                } ${reorder?.id === b.id ? 'opacity-60' : ''}`}
              >
                {b.name}
              </button>
            )
          })}
        </div>

        {current && (
          <span className="relative inline-flex">
            <button
              ref={menuButton}
              type="button"
              className="lk-btn ghost sm"
              aria-label="Board options"
              title={`Board options for ${current.name}`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => (setMenu(m => !m), setAsking(null))}
            >
              <MoreHorizontal aria-hidden size={16} />
            </button>
            {menu && (
              <div
                ref={menuBox}
                role="menu"
                aria-label="Board options"
                onKeyDown={menuKeys}
                className="lk-drop absolute top-[34px] left-0 z-40 w-56 border-2 border-ink bg-card py-1 shadow-[4px_4px_0_var(--shadow)]"
              >
                <MenuItem onClick={() => (closeMenu(false), startNaming({ kind: 'rename', id: current.id, name: current.name }))}>Rename</MenuItem>
                <MenuItem
                  disabled={full}
                  {...(full ? { title: TOO_MANY_BOARDS } : {})}
                  onClick={() => (closeMenu(), actions.create.mutate({ name: copyName(current.name), from: current.id }, { onSuccess: b => openAndFocus(b.id), onError: fail }))}
                >
                  Duplicate
                </MenuItem>
                <MenuItem disabled={index === 0} onClick={() => (closeMenu(), actions.move.mutate({ id: current.id, position: index - 1 }, { onError: fail }))}>
                  Move left
                </MenuItem>
                <MenuItem disabled={index === boards.length - 1} onClick={() => (closeMenu(), actions.move.mutate({ id: current.id, position: index + 1 }, { onError: fail }))}>
                  Move right
                </MenuItem>
                <MenuItem onClick={() => (closeMenu(false), setNote(''), setAsking('reset'))}>Reset to the default</MenuItem>
                {boards.length > 1 && (
                  <MenuItem danger onClick={() => (closeMenu(false), setNote(''), setAsking('delete'))}>
                    Delete
                  </MenuItem>
                )}
              </div>
            )}
          </span>
        )}

        {naming?.kind !== 'new' && (
          <button
            ref={newButton}
            type="button"
            className="lk-btn sm"
            disabled={full}
            {...(full ? { title: TOO_MANY_BOARDS } : {})}
            onClick={() => startNaming({ kind: 'new' })}
          >
            <Plus aria-hidden size={14} />
            New board
          </button>
        )}

        {reorder?.moving && reorder.mark && (
          <span aria-hidden className="pointer-events-none absolute w-[3px] bg-accent" style={{ left: reorder.mark.left, top: reorder.mark.top, height: reorder.mark.height }} />
        )}
      </div>

      {naming && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault()
            submitName()
          }}
          onKeyDown={e => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            stopNaming()
          }}
        >
          <label className="lk-field w-72">
            <b>&gt;</b>
            <input
              autoFocus
              value={name}
              maxLength={NAME_MAX}
              onChange={e => (setName(e.target.value), setNote(''))}
              onFocus={e => e.currentTarget.select()}
              aria-label={naming.kind === 'new' ? 'Name of the new board' : `New name for ${naming.name}`}
              placeholder={naming.kind === 'new' ? 'name of the new board' : naming.name}
            />
          </label>
          <Button type="submit" size="sm" variant="primary" busy={busy}>
            {naming.kind === 'new' ? 'Make the board' : 'Rename'}
          </Button>
          <Button size="sm" variant="ghost" onClick={stopNaming}>
            Cancel
          </Button>
        </form>
      )}

      {asking && current && (
        <div
          role="group"
          aria-labelledby={questionId}
          className="flex flex-wrap items-center gap-2 self-start border-2 border-danger px-2 py-1 text-small"
          onKeyDown={e => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            setAsking(null)
            menuButton.current?.focus()
          }}
        >
          <span id={questionId}>{asking === 'reset' ? resetQuestion(current.name) : deleteQuestion(current.name)}</span>
          <Button autoFocus size="sm" variant="danger" busy={busy} onClick={confirm}>
            {asking === 'reset' ? 'Reset' : 'Delete'}
          </Button>
          <Button size="sm" onClick={() => (setAsking(null), menuButton.current?.focus())}>
            Keep
          </Button>
        </div>
      )}

      {note && (
        <p role="status" className="text-small text-danger">
          {note}
        </p>
      )}
    </div>
  )
}

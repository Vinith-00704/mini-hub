// A board's tiles (docs/07 > Home, Making it one's own). At 900 px and wider: a grid of 12 columns and rows of 80 px,
// each tile on its own cells. Narrower: one column in reading order, each tile its own height. In edit mode every
// tile can be moved, resized and removed by mouse (pointer events, no library) and by keys; each change is said.

import type { Widget } from '@minihub/protocol'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { holdTopic } from '../../app/live.ts'
import { Button, Empty, Window } from '../../components/look/index.ts'
import { WIDGETS } from '../../widgets/registry.tsx'
import { EditFrame, FILL, type Handle } from './EditFrame.tsx'
import { place, readingOrder, remove, resize } from './layout.ts'
import type { BoardLayout } from './useBoards.ts'

export const ROW_PX = 80
const GAP_PX = 16
export const KEYS_ID = 'board-keys'

export const tileTitle = (t: Widget): string => WIDGETS[t.type]?.title ?? t.type

function TileBody({ tile }: { tile: Widget }) {
  const def = WIDGETS[tile.type]
  if (!def) return <Window title={tile.type} state="empty" emptyText="This tile is not in this version." />
  return <>{def.render(tile.settings ?? {})}</>
}

const cellStyle = (t: Widget): CSSProperties => ({ gridColumn: `${t.x + 1} / span ${t.w}`, gridRow: `${t.y + 1} / span ${t.h}` })
const tallStyle = (t: Widget): CSSProperties => ({ height: t.h * ROW_PX + (t.h - 1) * GAP_PX })

type Drag = {
  id: string
  kind: 'move' | 'resize'
  pointer: number
  base: Widget[]
  /** Which cell of the tile the pointer took it by. */
  grab: { cx: number; cy: number }
  from: { px: number; py: number }
  /** Move: the column and row it lands on. Resize: its width and height. */
  target: { a: number; b: number }
  preview: Widget[]
  shift: { x: number; y: number }
  release: () => void
}

/** Loading: the shape of a board, striped. */
export function BoardSkeleton() {
  const spans = [4, 5, 3, 3, 3, 3, 3]
  return (
    <div aria-busy="true" aria-label="Loading" className="grid grid-cols-12 gap-4" style={{ gridAutoRows: `${ROW_PX}px` }}>
      {spans.map((w, i) => (
        <div key={i} className="lk-skel" style={{ gridColumn: `span ${w}`, gridRow: 'span 3' }} />
      ))}
    </div>
  )
}

export function Board({
  layout,
  labelledBy,
  editing,
  wide,
  onEditing,
  focusTile,
  onFocused,
  onAddTile,
  onTileSettings,
  onNoTileLeft,
}: {
  layout: BoardLayout
  /** The id of the board's tab. */
  labelledBy?: string
  editing: boolean
  /** At least 900 px wide: the grid, and editing allowed. */
  wide: boolean
  onEditing: (on: boolean) => void
  /** A tile to give focus to once it is shown (after entering edit mode). */
  focusTile?: string | null
  onFocused?: () => void
  /** Opens the gallery of tiles; without it, Add a tile is not offered. */
  onAddTile?: () => void
  /** Opens a tile's settings; without it, the gear says the tile has none. */
  onTileSettings?: (id: string) => void
  /** The last tile was removed: focus goes somewhere that still takes the keys. */
  onNoTileLeft?: () => void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /** A dropped tile waiting for the board's newest copy before it lands. */
  const dropping = useRef(false)
  /** The holds on the boards' live news this board has taken; all given back when it goes. */
  const holds = useRef(new Set<() => void>())
  const widgets = layout.widgets

  const hold = (): (() => void) => {
    const release = holdTopic('boards')
    const once = () => {
      if (holds.current.delete(once)) release()
    }
    holds.current.add(once)
    return once
  }
  useEffect(() => {
    const held = holds.current
    return () => {
      for (const release of [...held]) release()
    }
  }, [])

  const focus = (id: string | undefined) => {
    if (id) requestAnimationFrame(() => frames.current.get(id)?.focus())
  }

  useEffect(() => {
    if (!editing || !focusTile) return
    focus(focusTile)
    onFocused?.()
  }, [editing, focusTile, onFocused])

  // Leaving edit mode, or the window getting narrow, drops a drag on its way.
  useEffect(() => {
    if (editing && wide) return
    dragRef.current?.release()
    dragRef.current = null
    if (!dropping.current) setDrag(null)
  }, [editing, wide])

  const settings = (t: Widget) => (onTileSettings ? onTileSettings(t.id) : layout.say('This tile has no settings.'))

  const removeTile = (t: Widget) => {
    const order = readingOrder(widgets)
    const i = order.findIndex(o => o.id === t.id)
    const r = layout.apply(ws => remove(ws, t.id))
    if (!r.changed) return
    layout.say(`Removed ${tileTitle(t)}. Undo with Ctrl+Z.`)
    const next = order[i + 1]?.id ?? order[i - 1]?.id
    if (next) focus(next)
    else onNoTileLeft?.()
  }

  const moveBy = (id: string, dx: number, dy: number) => {
    const r = layout.apply(ws => {
      const c = ws.find(w => w.id === id)
      return c ? place(ws, id, c.x + dx, c.y + dy) : ws
    })
    const t = r.widgets.find(w => w.id === id)
    if (!t) return
    layout.say(r.changed ? `Moved ${tileTitle(t)} to column ${t.x + 1}, row ${t.y + 1}.` : `${tileTitle(t)} stays at column ${t.x + 1}, row ${t.y + 1}.`)
    focus(id)
  }

  const sizeBy = (id: string, dw: number, dh: number) => {
    const r = layout.apply(ws => {
      const c = ws.find(w => w.id === id)
      return c ? resize(ws, id, c.w + dw, c.h + dh) : ws
    })
    const t = r.widgets.find(w => w.id === id)
    if (!t) return
    layout.say(r.changed ? `${tileTitle(t)} is now ${t.w} by ${t.h}.` : `${tileTitle(t)} stays ${t.w} by ${t.h}.`)
    focus(id)
  }

  const onKey = (t: Widget) => (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys on the gear or the x inside the frame are theirs (Enter, Space), not the tile's.
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const d = step[e.key]
    if (d) {
      e.preventDefault()
      if (dragRef.current || dropping.current) return
      // Shift with Right or Down grows by one, with Left or Up shrinks by one.
      if (e.shiftKey) sizeBy(t.id, d[0], d[1])
      else moveBy(t.id, d[0], d[1])
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeTile(t)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      settings(t)
    } else if (e.key === 'Escape' && dragRef.current) {
      e.preventDefault()
      e.stopPropagation()
      endDrag(false)
    }
  }

  // --- The pointer: the cell under it, from the grid's rectangle, its column width and the 80 px rows ---

  const cellAt = (px: number, py: number): { cx: number; cy: number } => {
    const g = grid.current as HTMLDivElement
    const r = g.getBoundingClientRect()
    const css = getComputedStyle(g)
    const colGap = parseFloat(css.columnGap) || GAP_PX
    const rowGap = parseFloat(css.rowGap) || GAP_PX
    const col = (r.width - colGap * 11) / 12
    return { cx: Math.floor((px - r.left) / (col + colGap)), cy: Math.floor((py - r.top) / (ROW_PX + rowGap)) }
  }

  const aim = (d: Drag, px: number, py: number): Drag => {
    const t = d.base.find(w => w.id === d.id) as Widget
    const { cx, cy } = cellAt(px, py)
    const target = d.kind === 'move' ? { a: cx - d.grab.cx, b: cy - d.grab.cy } : { a: cx - t.x + 1, b: cy - t.y + 1 }
    const same = target.a === d.target.a && target.b === d.target.b
    const preview = same ? d.preview : d.kind === 'move' ? place(d.base, d.id, target.a, target.b) : resize(d.base, d.id, target.a, target.b)
    return { ...d, target, preview, shift: { x: px - d.from.px, y: py - d.from.py } }
  }

  function endDrag(commit: boolean) {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (!commit) {
      setDrag(null)
      return d.release()
    }
    // The drop lands on the hub's newest copy of the board (fetched first), so a change made in another window while
    // dragging is kept and this move is made on top of it. Until then the tile stays where it was dropped.
    dropping.current = true
    void layout
      .applyFresh(ws => (d.kind === 'move' ? place(ws, d.id, d.target.a, d.target.b) : resize(ws, d.id, d.target.a, d.target.b)))
      .then(r => {
        const t = r.widgets.find(w => w.id === d.id)
        if (r.changed && t) layout.say(d.kind === 'move' ? `Moved ${tileTitle(t)} to column ${t.x + 1}, row ${t.y + 1}.` : `${tileTitle(t)} is now ${t.w} by ${t.h}.`)
        focus(d.id)
      })
      .finally(() => {
        dropping.current = false
        setDrag(null)
        d.release()
      })
  }

  const handle = (t: Widget, kind: Drag['kind']): Handle => ({
    onPointerDown: e => {
      if (e.button !== 0 || !grid.current || dragRef.current || dropping.current) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const { cx, cy } = cellAt(e.clientX, e.clientY)
      const d: Drag = {
        id: t.id,
        kind,
        pointer: e.pointerId,
        base: widgets,
        grab: { cx: cx - t.x, cy: cy - t.y },
        from: { px: e.clientX, py: e.clientY },
        target: kind === 'move' ? { a: t.x, b: t.y } : { a: t.w, b: t.h },
        preview: widgets,
        shift: { x: 0, y: 0 },
        release: hold(),
      }
      dragRef.current = d
      setDrag(d)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current
      if (!d || d.pointer !== e.pointerId) return
      const next = aim(d, e.clientX, e.clientY)
      dragRef.current = next
      setDrag(next)
    },
    onPointerUp: e => {
      if (dragRef.current?.pointer === e.pointerId) endDrag(true)
    },
    onPointerCancel: () => endDrag(false),
    onLostPointerCapture: () => endDrag(false),
  })

  if (widgets.length === 0)
    return (
      <div role="tabpanel" aria-labelledby={labelledBy} id="board-panel" className="lk-dash p-6">
        <Empty
          text="This board is empty."
          action={
            onAddTile ? (
              <Button variant="primary" onClick={onAddTile}>
                Add a tile
              </Button>
            ) : undefined
          }
        />
      </div>
    )

  if (!wide)
    return (
      <div role="tabpanel" aria-labelledby={labelledBy} id="board-panel" className="flex flex-col gap-4">
        {readingOrder(widgets).map(t => (
          <div key={t.id} className={FILL} style={tallStyle(t)}>
            <TileBody tile={t} />
          </div>
        ))}
      </div>
    )

  // While dragging, the tiles keep their order in the page (the dragged one holds the pointer); only their cells move.
  const order = readingOrder(drag ? drag.base : widgets)
  const shown = new Map((drag ? drag.preview : widgets).map(t => [t.id, t]))
  const landing = drag ? shown.get(drag.id) : undefined

  return (
    <div
      ref={grid}
      role="tabpanel"
      aria-labelledby={labelledBy}
      id="board-panel"
      className="relative grid grid-cols-12 gap-4"
      style={{ gridAutoRows: `${ROW_PX}px` }}
    >
      {order.map(o => {
        const lifted = drag?.id === o.id && drag.kind === 'move'
        // The dragged tile stays on its cells and follows the pointer; the others show where they will be.
        const t = drag?.id === o.id ? o : (shown.get(o.id) ?? o)
        const title = tileTitle(t)
        return (
          <div
            key={t.id}
            className={`min-w-0 ${editing ? 'h-full min-h-0' : FILL} ${lifted ? 'relative z-20' : ''}`}
            style={{ ...cellStyle(t), ...(lifted ? { transform: `translate(${drag.shift.x}px, ${drag.shift.y}px)` } : {}) }}
            onContextMenu={
              editing
                ? undefined
                : e => {
                    e.preventDefault()
                    onEditing(true)
                    focus(t.id)
                  }
            }
          >
            {editing ? (
              <EditFrame
                title={title}
                tile={t}
                frameRef={el => {
                  if (el) frames.current.set(t.id, el)
                  else frames.current.delete(t.id)
                }}
                describedBy={KEYS_ID}
                lifted={lifted}
                move={handle(t, 'move')}
                resize={handle(t, 'resize')}
                onKeyDown={onKey(t)}
                onSettings={() => settings(t)}
                onRemove={() => removeTile(t)}
              >
                <TileBody tile={t} />
              </EditFrame>
            ) : (
              <TileBody tile={t} />
            )}
          </div>
        )
      })}
      {landing && (
        <div aria-hidden className="pointer-events-none z-10 border-2 border-dashed border-ink bg-accent/15" style={cellStyle(landing)} />
      )}
    </div>
  )
}

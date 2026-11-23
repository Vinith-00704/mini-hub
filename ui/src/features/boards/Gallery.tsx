// The gallery of tiles (docs/07 > Making it one's own): one card for each kind of tile, with a live preview of the real
// tile at its default size, scaled down to fit. Tab goes from one card's Add to the next.

import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../../components/look/index.ts'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { WIDGETS, type WidgetDef } from '../../widgets/registry.tsx'
import { FILL } from './EditFrame.tsx'
import { ROW_PX } from './Board.tsx'

/** The width of one column in a preview, whatever the window: the tile is drawn at this size and scaled to the card. */
const PREVIEW_COL = 80
const GAP = 16
const PREVIEW_HEIGHT = 150

export const sizeWords = (d: { w: number; h: number }): string => `${d.w} by ${d.h}`

function Preview({ def }: { def: WidgetDef }) {
  const frame = useRef<HTMLDivElement>(null)
  const width = def.w * PREVIEW_COL + (def.w - 1) * GAP
  const height = def.h * ROW_PX + (def.h - 1) * GAP
  const [box, setBox] = useState(0)

  useLayoutEffect(() => {
    const el = frame.current as HTMLDivElement
    const measure = () => setBox(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const scale = box > 0 ? Math.min(1, box / width, PREVIEW_HEIGHT / height) : 0
  return (
    <div ref={frame} aria-hidden="true" className="relative overflow-hidden border-2 border-dashed border-ink-3 bg-surface" style={{ height: PREVIEW_HEIGHT }}>
      {/* The real tile with its default settings; it cannot be used or reached from here. */}
      <div inert aria-hidden="true" className={`absolute top-0 ${FILL}`} style={{ width, height, left: Math.max(0, (box - width * scale) / 2), transform: `scale(${scale})`, transformOrigin: 'top left', visibility: scale ? 'visible' : 'hidden' }}>
        {def.render({})}
      </div>
    </div>
  )
}

export function Gallery({ onAdd, onClose }: { onAdd: (type: string) => string | null; onClose: () => void }) {
  const [problem, setProblem] = useState('')
  return (
    <Dialog label="Add a tile" onClose={onClose} wide>
      <p className="text-small text-ink-2">Each tile is added at the bottom of the board, at its usual size. Move it where you want it afterwards.</p>
      {problem && (
        <p role="alert" className="border-2 border-danger px-3 py-2 text-small text-danger">
          {problem}
        </p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {Object.values(WIDGETS).map(def => (
          <li key={def.type} className="flex min-w-0 flex-col gap-2 border-2 border-ink bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-[15px] font-black uppercase">{def.title}</h3>
              <span className="tabular shrink-0 text-micro text-ink-3">{sizeWords(def)}</span>
            </div>
            <p className="text-small text-ink-2">{def.about}</p>
            <Preview def={def} />
            <Button variant="primary" size="sm" className="self-start" aria-label={`Add ${def.title}`} onClick={() => setProblem(onAdd(def.type) ?? '')}>
              Add
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

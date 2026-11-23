// A tile in edit mode: its content can no longer be used (inert); a bar over its title with the move handle, the gear
// and the x; and a corner to resize it. The frame itself takes focus and the keys (docs/07 > Making it one's own).

import type { Widget } from '@minihub/protocol'
import { GripVertical, Settings, X } from 'lucide-react'
import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from 'react'

/** What a handle needs to follow the pointer. */
export type Handle = {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onLostPointerCapture: (e: PointerEvent<HTMLElement>) => void
}

/** The tile fills its cell, nothing in it spills out of it, and its body scrolls inside when its content is taller. */
export const FILL =
  'h-full min-h-0 [&>.lk-win]:h-full [&>.lk-win]:overflow-hidden [&>.lk-win>.lk-win-body]:overflow-auto [&>.lk-win>.lk-win-body]:[scrollbar-width:thin]'

export const frameLabel = (title: string, t: Widget): string => `${title}, column ${t.x + 1}, row ${t.y + 1}, ${t.w} by ${t.h}`

const tool = 'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center border-2 border-transparent hover:border-on-accent'

export function EditFrame({
  title,
  tile,
  frameRef,
  describedBy,
  lifted,
  move,
  resize,
  onKeyDown,
  onSettings,
  onRemove,
  children,
}: {
  title: string
  tile: Widget
  frameRef: Ref<HTMLDivElement>
  /** The id of the line that says which keys do what. */
  describedBy: string
  /** Being dragged: it floats above the others. */
  lifted: boolean
  move: Handle
  resize: Handle
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  onSettings: () => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <div
      ref={frameRef}
      role="group"
      tabIndex={0}
      aria-label={frameLabel(title, tile)}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className={`relative h-full min-h-0 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] ${lifted ? 'shadow-[10px_10px_0_var(--shadow)]' : ''}`}
    >
      <div inert className={FILL}>
        {children}
      </div>
      {/* The dashed edge says the tile can be moved. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 border-2 border-dashed border-accent" />
      <div className="absolute inset-x-0 top-0 flex h-[34px] items-center gap-1 border-2 border-ink bg-accent pr-1 text-on-accent">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Move ${title}`}
          title={`Move ${title}`}
          className={`flex h-full min-w-0 flex-1 touch-none items-center gap-1.5 pl-1.5 text-left select-none ${lifted ? 'cursor-grabbing' : 'cursor-grab'}`}
          {...move}
        >
          <GripVertical aria-hidden size={16} className="shrink-0" />
          <span className="truncate text-[12px] font-extrabold tracking-[0.07em] uppercase">{title}</span>
        </button>
        <button type="button" aria-label={`Settings for ${title}`} title={`Settings for ${title}`} className={tool} onClick={onSettings}>
          <Settings aria-hidden size={15} />
        </button>
        <button type="button" aria-label={`Remove ${title}`} title={`Remove ${title}`} className={tool} onClick={onRemove}>
          <X aria-hidden size={16} />
        </button>
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Resize ${title}`}
        title={`Resize ${title}`}
        className="absolute right-0 bottom-0 flex h-8 w-8 cursor-nwse-resize touch-none items-end justify-end border-t-2 border-l-2 border-ink bg-accent p-1 select-none"
        {...resize}
      >
        {/* Three steps, like a window's corner. */}
        <svg aria-hidden viewBox="0 0 12 12" width={12} height={12} shapeRendering="crispEdges">
          <rect x={9} y={3} width={3} height={9} fill="var(--on-accent)" />
          <rect x={3} y={9} width={9} height={3} fill="var(--on-accent)" />
          <rect x={6} y={6} width={3} height={3} fill="var(--on-accent)" />
        </svg>
      </button>
    </div>
  )
}

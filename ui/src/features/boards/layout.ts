// The rules of a board's grid (docs/07 > Making it one's own): 12 columns, rows of 80 px, no two tiles on one cell,
// and every tile as high up as it can go. Pure functions: each takes the tiles and gives back new ones.

import type { Widget } from '@minihub/protocol'
import { WIDGETS } from '../../widgets/registry.tsx'

export const COLUMNS = 12
export const MAX_TILES = 60
export const TOO_MANY = 'A board holds 60 tiles at most.'
export const NO_ROOM = 'There is no room left at the bottom of this board.'
/** The tallest a tile may be, and the lowest row it may start on (as the hub checks a layout). */
const MAX_H = 12
const MAX_Y = 199

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

/** The smallest a tile of this type may be; a type this version does not know may be any size. */
export const minSize = (type: string): { w: number; h: number } => {
  const d = WIDGETS[type]
  return d ? { w: d.minW, h: d.minH } : { w: 1, h: 1 }
}

/** Two different tiles on at least one same cell. */
export function collides(a: Widget, b: Widget): boolean {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Every tile moves up while it can, in (y, x) order. A tile that lands on one before it goes below it first. */
export function compact(ws: Widget[]): Widget[] {
  const placed: Widget[] = []
  for (const t of [...ws].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const n = { ...t }
    while (placed.some(p => collides(n, p))) n.y++
    while (n.y > 0 && !placed.some(p => collides({ ...n, y: n.y - 1 }, p))) n.y--
    placed.push(n)
  }
  return placed
}

/** `fixed` takes its place; each tile it lands on goes down just below it, and so on for the tiles those land on. */
function pushDown(ws: Widget[], fixed: Widget): Widget[] {
  const out = ws.map(t => (t.id === fixed.id ? fixed : { ...t }))
  const queue = [fixed]
  for (let guard = 0; queue.length && guard < 10_000; guard++) {
    const top = queue.shift() as Widget
    for (const t of out) {
      if (t === fixed || !collides(t, top)) continue
      t.y = top.y + top.h
      queue.push(t)
    }
  }
  return out
}

/** The new tiles, unless one would start below the last row the hub keeps: then the tiles as they were. */
const within = (before: Widget[], after: Widget[]): Widget[] => (after.every(t => t.y <= MAX_Y) ? after : before)

/** The tile at column `x`, row `y` (kept inside the 12 columns); the tiles it lands on are pushed down, then all compact. */
export function moveTo(ws: Widget[], id: string, x: number, y: number): Widget[] {
  const t = ws.find(w => w.id === id)
  if (!t) return ws
  return within(ws, compact(pushDown(ws, { ...t, x: clamp(x, 0, COLUMNS - t.w), y: clamp(y, 0, MAX_Y) })))
}

/** The tile at a new size, no smaller than its type allows and no wider than the 12 columns. */
export function resize(ws: Widget[], id: string, w: number, h: number): Widget[] {
  const t = ws.find(o => o.id === id)
  if (!t) return ws
  const min = minSize(t.type)
  const nw = clamp(Math.min(w, COLUMNS - t.x), Math.min(min.w, COLUMNS), COLUMNS)
  const nh = clamp(h, min.h, MAX_H)
  return within(ws, compact(pushDown(ws, { ...t, x: Math.min(t.x, COLUMNS - nw), w: nw, h: nh })))
}

const hex = (): string => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')

/** A new tile of this type at its default size, at the left, below everything. */
export function addAtEnd(ws: Widget[], type: string): Widget[] {
  if (ws.length >= MAX_TILES) throw new Error(TOO_MANY)
  const d = WIDGETS[type]
  let id = `w-${hex()}`
  while (ws.some(t => t.id === id)) id = `w-${hex()}`
  const y = ws.reduce((m, t) => Math.max(m, t.y + t.h), 0)
  if (y > MAX_Y) throw new Error(NO_ROOM)
  return [...ws, { id, type, x: 0, y, w: d?.w ?? 3, h: d?.h ?? 2, settings: {} }]
}

export function remove(ws: Widget[], id: string): Widget[] {
  return compact(ws.filter(t => t.id !== id))
}

/** Every tile where it was in the other layout. */
export const samePlaces = (a: Widget[], b: Widget[]): boolean =>
  a.length === b.length && a.every(t => b.some(o => o.id === t.id && o.x === t.x && o.y === t.y && o.w === t.w && o.h === t.h))

/**
 * Where a tile lands when it is dropped on (or stepped to) a cell. Because every tile rises as far as it can, a tile
 * moved down onto the one below it would only float back: so it goes on down until it lands below that one, and the
 * two change places. A tile with nothing below it stays where it is.
 */
export function place(ws: Widget[], id: string, x: number, y: number): Widget[] {
  const t = ws.find(w => w.id === id)
  if (!t) return ws
  const now = compact(ws)
  const next = moveTo(ws, id, x, y)
  if (y <= t.y || !samePlaces(next, now)) return next
  for (let k = 1; k <= MAX_H * 2; k++) {
    const further = moveTo(ws, id, x, y + k)
    if (!samePlaces(further, now)) return further
  }
  return next
}

/** Reading order: by row, then column. */
export const readingOrder = (ws: Widget[]): Widget[] => [...ws].sort((a, b) => a.y - b.y || a.x - b.x)

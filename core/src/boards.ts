// The dashboard's boards (docs/05 > The dashboard's own things): pages of tiles, kept in the `boards` table. Home is
// written the first time the boards are asked for, so a new hub starts with the layout the dashboard always had.

import { randomBytes } from 'node:crypto'
import { DEFAULT_HOME, layoutSchema, type Board, type Layout, type Widget } from '@minihub/protocol'
import { ApiFailure } from './rules/policy.ts'
import type { Store } from './store/db.ts'

export const MAX_BOARDS = 20
/** A layout's JSON, as stored, at most this many bytes. */
export const MAX_LAYOUT_BYTES = 64 * 1024

type Raw = { id: string; name: string; position: number; layout_json: string }

const toBoard = (r: Raw): Board => {
  let layout: Layout = { widgets: [] }
  try {
    layout = layoutSchema.parse(JSON.parse(r.layout_json))
  } catch {}
  return { id: r.id, name: r.name, position: r.position, layout }
}

const hex = (): string => randomBytes(4).toString('hex')

const overlap = (a: Widget, b: Widget): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** A layout as it may be stored: valid, no two tiles with one id, no two tiles on the same cells, at most 64 KiB. */
export const checkLayout = (raw: unknown): Layout => {
  if (Buffer.byteLength(JSON.stringify(raw ?? null) ?? '') > MAX_LAYOUT_BYTES) throw new ApiFailure(413, 'too-large', 'That board is too large.')
  const layout = layoutSchema.parse(raw)
  const ids = new Set(layout.widgets.map(w => w.id))
  if (ids.size !== layout.widgets.length) throw new ApiFailure(400, 'bad-request', 'Two tiles have the same id.')
  for (let i = 0; i < layout.widgets.length; i++)
    for (let j = i + 1; j < layout.widgets.length; j++)
      if (overlap(layout.widgets[i], layout.widgets[j])) throw new ApiFailure(400, 'bad-request', 'Two tiles overlap.')
  return layout
}

export class Boards {
  #db: Store
  #listeners = new Set<() => void>()

  constructor(db: Store) {
    this.#db = db
  }

  /** Every board by position. With none yet, Home is written first. */
  list(): Board[] {
    const rows = this.#db.prepare('SELECT * FROM boards ORDER BY position, id').all() as Raw[]
    if (rows.length) return rows.map(toBoard)
    this.#db.prepare('INSERT INTO boards (id, name, position, layout_json) VALUES (?, ?, ?, ?)').run('home', 'Home', 0, JSON.stringify(DEFAULT_HOME))
    this.#changed()
    return [{ id: 'home', name: 'Home', position: 0, layout: DEFAULT_HOME }]
  }

  get(id: string): Board {
    const r = this.#db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as Raw | undefined
    if (!r) throw new ApiFailure(404, 'not-found', 'There is no such board.')
    return toBoard(r)
  }

  /** A new board at the end; `from` copies that board's tiles, each with a new id. */
  create(name: string, from?: string): Board {
    const all = this.list()
    if (all.length >= MAX_BOARDS) throw new ApiFailure(409, 'conflict', `There can be ${MAX_BOARDS} boards at most.`)
    const layout: Layout = { widgets: [] }
    if (from !== undefined) {
      const used = new Set<string>()
      for (const w of this.get(from).layout.widgets) {
        let id = `w-${hex()}`
        while (used.has(id)) id = `w-${hex()}`
        used.add(id)
        layout.widgets.push({ ...w, id })
      }
    }
    let id = `b-${hex()}`
    while (all.some(b => b.id === id)) id = `b-${hex()}`
    const position = all.length
    this.#db.prepare('INSERT INTO boards (id, name, position, layout_json) VALUES (?, ?, ?, ?)').run(id, name, position, JSON.stringify(layout))
    this.#changed()
    return { id, name, position, layout }
  }

  /** A new name, place or layout. A layout that fails any check writes nothing. */
  update(id: string, patch: { name?: string; position?: number; layout?: unknown }): Board {
    const board = this.get(id)
    const layout = patch.layout === undefined ? undefined : checkLayout(patch.layout)
    this.#db.transaction(() => {
      if (patch.name !== undefined) this.#db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(patch.name, id)
      if (layout) this.#db.prepare('UPDATE boards SET layout_json = ? WHERE id = ?').run(JSON.stringify(layout), id)
      if (patch.position !== undefined && patch.position !== board.position) {
        // The others move up or down so the places stay 0 to n-1.
        const order = this.list()
          .map(b => b.id)
          .filter(b => b !== id)
        order.splice(Math.min(Math.max(patch.position, 0), order.length), 0, id)
        this.#renumber(order)
      }
    })()
    this.#changed()
    return this.get(id)
  }

  remove(id: string): void {
    this.get(id)
    if (this.list().length <= 1) throw new ApiFailure(409, 'conflict', 'Keep at least one board.')
    this.#db.transaction(() => {
      this.#db.prepare('DELETE FROM boards WHERE id = ?').run(id)
      this.#renumber(this.list().map(b => b.id))
    })()
    this.#changed()
  }

  reset(id: string): Board {
    this.get(id)
    this.#db.prepare('UPDATE boards SET layout_json = ? WHERE id = ?').run(JSON.stringify(DEFAULT_HOME), id)
    this.#changed()
    return this.get(id)
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #renumber(order: string[]): void {
    const stmt = this.#db.prepare('UPDATE boards SET position = ? WHERE id = ?')
    order.forEach((b, i) => stmt.run(i, b))
  }

  #changed(): void {
    for (const fn of this.#listeners) fn()
  }
}

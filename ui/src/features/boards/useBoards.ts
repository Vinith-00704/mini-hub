// The boards from the hub (GET /v1/boards), which one is open, the changes made to them, and Undo. A change to a
// board's tiles is shown at once and saved (PUT /v1/boards/<id> { layout }), one save at a time per board: while one
// is on its way, only the newest layout waits to follow it. A change the hub refuses is taken back (the board shows
// the hub's own copy again) and said. Undo keeps the last ten layouts of each board in memory only (gone on reload).

import type { Board, Layout, Widget } from '@minihub/protocol'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api, del, post, put } from '../../app/api.ts'
import { holdTopic } from '../../app/live.ts'

export type { Board, Layout, Widget }
type List = { items: Board[] }

const KEY = ['boards']
export const BOARD_KEY = 'minihub.board'
export const UNDO_LIMIT = 10
export const MAX_BOARDS = 20
export const NAME_MAX = 40
export const TOO_MANY_BOARDS = 'There can be 20 boards at most.'

// Kept for the whole window, not per screen: leaving Home and coming back keeps Undo, and a save still on its way
// finishes (or is taken back) on its own.
const history = new Map<string, Layout[]>()
/** The last layout the hub has of each board, to put back when a change is refused. */
const saved = new Map<string, Layout>()
/** What went wrong with the last change of each board, shown until the next change saves. */
const failures = new Map<string, string>()
const failureListeners = new Set<(id: string, words: string) => void>()

type Waiter = (error: Error | null) => void
/** One board's saves: the one on its way, the newest layout waiting to follow it, and who waits for them. */
type Chain = { next: { layout: Layout; waiters: Waiter[] } | null; failed: boolean; idle: Array<() => void>; release: () => void }
const chains = new Map<string, Chain>()

/** While this window is saving, a fetch (on focus) would bring the layout from before the change. */
export const useBoardList = () => useQuery({ queryKey: KEY, queryFn: () => api<List>('/v1/boards'), refetchOnWindowFocus: () => chains.size === 0 })

/** The board opened last on this computer (kept in this window's storage, which may be refused). */
export const lastBoard = (): string | null => {
  try {
    return window.localStorage.getItem(BOARD_KEY)
  } catch {
    return null
  }
}

export const rememberBoard = (id: string): void => {
  try {
    window.localStorage.setItem(BOARD_KEY, id)
  } catch {}
}

export const boardHref = (id: string): string => `#/?board=${encodeURIComponent(id)}`

export const openBoard = (id: string): void => {
  rememberBoard(id)
  window.location.hash = boardHref(id)
}

/** The board asked for in the address, else the one opened last, else the first. */
export const pickBoard = (items: Board[], asked?: string): Board | undefined =>
  items.find(b => b.id === asked) ?? items.find(b => b.id === lastBoard()) ?? items[0]

export const resetQuestion = (name: string): string => `Put the default tiles back on ${name}?`
export const deleteQuestion = (name: string): string => `Delete ${name}? Its tiles go with it.`

/** What is wrong with a board name, or null: 1 to 40 characters, as the hub checks it. */
export const nameProblem = (raw: string): string | null => {
  const name = raw.trim()
  if (!name) return 'Give the board a name.'
  if (name.length > NAME_MAX) return `A board name has at most ${NAME_MAX} characters.`
  return null
}

/** A copy's name: "<name> copy", kept to 40 characters. */
export const copyName = (name: string): string => `${name.slice(0, NAME_MAX - 5).trim()} copy`

const path = (id: string): string => `/v1/boards/${encodeURIComponent(id)}`

const show = (client: QueryClient, id: string, layout: Layout): void => {
  // A fetch on its way would bring an older layout; it is dropped (the hub's copy is fetched again afterwards).
  void client.cancelQueries({ queryKey: KEY })
  client.setQueryData<List>(KEY, old => old && { items: old.items.map(b => (b.id === id ? { ...b, layout } : b)) })
}

/** Saves a board's layout after the save on its way, if any; a layout that is still waiting is replaced by a newer one. */
function send(client: QueryClient, id: string, layout: Layout, waiter: Waiter): void {
  const chain = chains.get(id)
  if (chain) {
    chain.next = { layout, waiters: [...(chain.next?.waiters ?? []), waiter] }
    return
  }
  const c: Chain = { next: null, failed: false, idle: [], release: holdTopic('boards') }
  chains.set(id, c)
  run(client, id, c, layout, [waiter])
}

function run(client: QueryClient, id: string, c: Chain, layout: Layout, waiters: Waiter[]): void {
  const after = (): void => {
    const n = c.next
    c.next = null
    if (n) return run(client, id, c, n.layout, n.waiters)
    chains.delete(id)
    c.release()
    for (const fn of c.idle) fn()
    // After a refusal the hub's own copy is fetched, so the board shows what the hub has.
    if (c.failed) void client.invalidateQueries({ queryKey: KEY })
  }
  put<Board>(path(id), { layout })
    .then(b => {
      saved.set(id, b.layout)
      failures.delete(id)
      for (const w of waiters) w(null)
      after()
    })
    .catch((e: Error) => {
      c.failed = true
      // What waits was built on the refused layout: it is refused with it.
      const all = [...waiters, ...(c.next?.waiters ?? [])]
      c.next = null
      const back = saved.get(id)
      if (back) show(client, id, back)
      const words = `That change was not saved: ${e.message}`
      failures.set(id, words)
      for (const w of all) w(e)
      for (const fn of failureListeners) fn(id, words)
      after()
    })
}

/** Resolves once none of this window's saves of the board is on its way. */
const idle = (id: string): Promise<void> =>
  new Promise(resolve => {
    const c = chains.get(id)
    if (c) c.idle.push(resolve)
    else resolve()
  })

/** Making, renaming, moving, resetting and deleting boards (the tabs here, and Settings > Boards). */
export function useBoardActions() {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: KEY })
  return {
    create: useMutation({ mutationFn: (b: { name: string; from?: string }) => post<Board>('/v1/boards', b), onSuccess: refresh }),
    rename: useMutation({ mutationFn: (b: { id: string; name: string }) => put<Board>(path(b.id), { name: b.name }), onSuccess: refresh }),
    move: useMutation({ mutationFn: (b: { id: string; position: number }) => put<Board>(path(b.id), { position: b.position }), onSuccess: refresh }),
    reset: useMutation({
      mutationFn: (id: string) => post<Board>(`${path(id)}/reset`),
      // Undo goes back over changes made by hand; after a reset those belong to tiles that are gone.
      onSuccess: (_b, id) => (history.delete(id), failures.delete(id), refresh()),
    }),
    remove: useMutation({
      mutationFn: (id: string) => del<{ removed: string }>(path(id)),
      onSuccess: (_r, id) => (history.delete(id), saved.delete(id), failures.delete(id), refresh()),
    }),
  }
}

/** Tiles in a fixed order, so two layouts with the same tiles compare equal however they were reached. */
const sameTiles = (a: Widget[], b: Widget[]): boolean => {
  const key = (ws: Widget[]) => JSON.stringify([...ws].sort((x, y) => (x.id < y.id ? -1 : 1)))
  return a.length === b.length && key(a) === key(b)
}

/** The open board's tiles, how to change them, Undo, and what to say about it. */
export function useBoardLayout(board: Board | undefined) {
  const client = useQueryClient()
  const id = board?.id
  const [said, setSaid] = useState({ text: '', n: 0 })
  const [, redraw] = useState(0)

  // What the hub sent, when none of this window's own changes is still on its way.
  useEffect(() => {
    if (board && !chains.has(board.id)) saved.set(board.id, board.layout)
  }, [board])

  const say = useCallback((text: string) => setSaid(s => ({ text, n: s.n + 1 })), [])

  // A refusal of this board's change is said, also when it comes back after other changes.
  useEffect(() => {
    const on = (board: string, words: string) => {
      redraw(n => n + 1)
      if (board === id) say(words)
    }
    failureListeners.add(on)
    return () => void failureListeners.delete(on)
  }, [id, say])

  const current = useCallback((): Layout | undefined => client.getQueryData<List>(KEY)?.items.find(b => b.id === id)?.layout, [client, id])

  const save = useCallback(
    (layout: Layout, done: Waiter) => {
      if (!id) return
      const before = current()
      if (!saved.has(id) && before) saved.set(id, before)
      failures.delete(id)
      show(client, id, layout)
      send(client, id, layout, done)
    },
    [client, current, id],
  )

  /** Applies a change to the tiles and saves it. Says whether anything changed, and gives the tiles as they are now. */
  const apply = useCallback(
    (change: (ws: Widget[]) => Widget[]): { changed: boolean; widgets: Widget[] } => {
      const now = current()
      if (!id || !now) return { changed: false, widgets: [] }
      let next: Widget[]
      try {
        next = change(now.widgets)
      } catch (e) {
        const words = (e as Error).message
        failures.set(id, words)
        redraw(n => n + 1)
        say(words)
        return { changed: false, widgets: now.widgets }
      }
      if (sameTiles(next, now.widgets)) return { changed: false, widgets: now.widgets }
      const h = history.get(id) ?? []
      h.push(now)
      while (h.length > UNDO_LIMIT) h.shift()
      history.set(id, h)
      const board = id
      save({ widgets: next }, error => {
        // A refused change leaves nothing to undo.
        if (!error) return
        const list = history.get(board)
        const at = list?.lastIndexOf(now) ?? -1
        if (list && at >= 0) list.splice(at, 1)
      })
      return { changed: true, widgets: next }
    },
    [current, id, save, say],
  )

  /**
   * Like apply, but on the hub's newest copy of the board: after this window's own saves, the board is fetched again,
   * so a change made in another window in the meantime is kept and this one is made on top of it.
   */
  const applyFresh = useCallback(
    async (change: (ws: Widget[]) => Widget[]): Promise<{ changed: boolean; widgets: Widget[] }> => {
      if (id) {
        await idle(id)
        try {
          const fresh = await api<List>('/v1/boards')
          void client.cancelQueries({ queryKey: KEY })
          client.setQueryData<List>(KEY, fresh)
          const b = fresh.items.find(o => o.id === id)
          if (b && !chains.has(id)) saved.set(id, b.layout)
        } catch {
          // The hub did not answer: the change is made on what is shown, and its save says what happens.
        }
      }
      return apply(change)
    },
    [apply, client, id],
  )

  const undo = useCallback((): boolean => {
    const board = id
    const back = board ? history.get(board)?.pop() : undefined
    if (!board || !back) return false
    save(back, error => {
      // Said only once the hub has it; a refused Undo keeps its step, to try again.
      if (!error) return say('Undid the last change.')
      const list = history.get(board) ?? []
      list.push(back)
      while (list.length > UNDO_LIMIT) list.shift()
      history.set(board, list)
      redraw(n => n + 1)
    })
    return true
  }, [id, save, say])

  return {
    widgets: board?.layout.widgets ?? [],
    apply,
    applyFresh,
    undo,
    canUndo: Boolean(id && history.get(id)?.length),
    said,
    say,
    failure: (id && failures.get(id)) || '',
  }
}

export type BoardLayout = ReturnType<typeof useBoardLayout>

// Settings > Boards: every board in one list, with the same actions, confirms and limits as the tabs above the grid
// (docs/07 > Making it one's own): rename, open, move up and down, duplicate, reset to the default, delete, and a new one.

import { Plus } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Button } from '../../components/look/index.ts'
import { Tile } from '../../components/ui/Tile.tsx'
import {
  copyName,
  deleteQuestion,
  MAX_BOARDS,
  NAME_MAX,
  nameProblem,
  openBoard,
  resetQuestion,
  TOO_MANY_BOARDS,
  useBoardActions,
  useBoardList,
  type Board,
} from '../boards/useBoards.ts'

type Naming = { kind: 'new' } | { kind: 'rename'; id: string; name: string }
type Asking = { kind: 'reset' | 'delete'; id: string }

export function BoardsSettings() {
  const list = useBoardList()
  const actions = useBoardActions()
  const box = useRef<HTMLDivElement>(null)
  const questionId = useId()
  const [naming, setNaming] = useState<Naming | null>(null)
  const [name, setName] = useState('')
  const [asking, setAsking] = useState<Asking | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean }>({ text: '', bad: false })

  const boards = list.data?.items
  const busy = actions.create.isPending || actions.rename.isPending || actions.move.isPending || actions.reset.isPending || actions.remove.isPending
  const say = (text: string) => setNote({ text, bad: false })
  const fail = (e: Error) => setNote({ text: e.message, bad: true })
  /** Gives focus to a control once it is on the screen: `act` of one board, or the New board button. */
  const focus = (id: string | null, act: string) =>
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(id ? `[data-board="${CSS.escape(id)}"] [data-act="${act}"]` : `[data-act="${act}"]`)?.focus())

  if (!boards) return <Tile title="Boards" state={list.isError ? 'error' : 'loading'} {...(list.error ? { error: list.error.message } : {})} onRetry={() => void list.refetch()} />

  const full = boards.length >= MAX_BOARDS
  const asked = asking ? boards.find(b => b.id === asking.id) : undefined

  const startNaming = (n: Naming) => {
    setAsking(null)
    setNote({ text: '', bad: false })
    setNaming(n)
    setName(n.kind === 'rename' ? n.name : '')
  }

  const stopNaming = () => {
    const was = naming
    setNaming(null)
    setNote({ text: '', bad: false })
    focus(was?.kind === 'rename' ? was.id : null, was?.kind === 'rename' ? 'rename' : 'new')
  }

  const submitName = () => {
    if (!naming) return
    const problem = nameProblem(name)
    if (problem) return fail(new Error(problem))
    const given = name.trim()
    if (naming.kind === 'new')
      actions.create.mutate(
        { name: given },
        {
          onSuccess: () => (setNaming(null), say(`Made ${given}.`), focus(null, 'new')),
          onError: fail,
        },
      )
    else {
      const id = naming.id
      actions.rename.mutate(
        { id, name: given },
        {
          onSuccess: () => (setNaming(null), say(`Renamed to ${given}.`), focus(id, 'rename')),
          onError: fail,
        },
      )
    }
  }

  const confirm = () => {
    if (!asking || !asked) return
    const { kind, id } = asking
    if (kind === 'reset') actions.reset.mutate(id, { onSuccess: () => (setAsking(null), say(`${asked.name} has its default tiles again.`), focus(id, 'reset')), onError: fail })
    else actions.remove.mutate(id, { onSuccess: () => (setAsking(null), say(`Deleted ${asked.name}.`), focus(null, 'new')), onError: fail })
  }

  const ask = (kind: Asking['kind'], b: Board) => {
    setNaming(null)
    setNote({ text: '', bad: false })
    setAsking({ kind, id: b.id })
  }

  const cancelAsk = () => {
    const was = asking
    setAsking(null)
    if (was) focus(was.id, was.kind)
  }

  return (
    <Tile title="Boards">
      <div ref={box} className="flex flex-col">
        <ul className="flex flex-col">
          {boards.map((b, i) => (
            <li key={b.id} data-board={b.id} className="flex flex-wrap items-center gap-2 border-b border-line/60 py-2 last:border-0">
              <span className="min-w-[10rem] flex-1 truncate text-body font-bold" title={b.name}>
                {b.name}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" aria-label={`Open ${b.name}`} onClick={() => openBoard(b.id)}>
                  Open
                </Button>
                <Button size="sm" data-act="rename" aria-label={`Rename ${b.name}`} onClick={() => startNaming({ kind: 'rename', id: b.id, name: b.name })}>
                  Rename
                </Button>
                <Button size="sm" aria-label={`Move ${b.name} up`} disabled={i === 0 || busy} onClick={() => actions.move.mutate({ id: b.id, position: i - 1 }, { onError: fail })}>
                  Move up
                </Button>
                <Button
                  size="sm"
                  aria-label={`Move ${b.name} down`}
                  disabled={i === boards.length - 1 || busy}
                  onClick={() => actions.move.mutate({ id: b.id, position: i + 1 }, { onError: fail })}
                >
                  Move down
                </Button>
                <Button
                  size="sm"
                  aria-label={`Duplicate ${b.name}`}
                  disabled={full || busy}
                  {...(full ? { title: TOO_MANY_BOARDS } : {})}
                  onClick={() => actions.create.mutate({ name: copyName(b.name), from: b.id }, { onSuccess: c => say(`Made ${c.name}.`), onError: fail })}
                >
                  Duplicate
                </Button>
                <Button size="sm" data-act="reset" aria-label={`Reset ${b.name} to the default`} onClick={() => ask('reset', b)}>
                  Reset to the default
                </Button>
                {boards.length > 1 && (
                  <Button size="sm" variant="danger" data-act="delete" aria-label={`Delete ${b.name}`} onClick={() => ask('delete', b)}>
                    Delete
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>

        {asking && asked && (
          <div
            role="group"
            aria-labelledby={questionId}
            className="mt-2 flex flex-wrap items-center gap-2 self-start border-2 border-danger px-2 py-1 text-small"
            onKeyDown={e => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              e.stopPropagation()
              cancelAsk()
            }}
          >
            <span id={questionId}>{asking.kind === 'reset' ? resetQuestion(asked.name) : deleteQuestion(asked.name)}</span>
            <Button
              autoFocus
              size="sm"
              variant="danger"
              busy={busy}
              onClick={e => {
                // The second click of a double click is not an answer.
                if (e.detail > 1) return
                confirm()
              }}
            >
              {asking.kind === 'reset' ? 'Reset' : 'Delete'}
            </Button>
            <Button size="sm" onClick={cancelAsk}>
              Keep
            </Button>
          </div>
        )}

        {naming ? (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
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
              <b aria-hidden>&gt;</b>
              <input
                autoFocus
                value={name}
                maxLength={NAME_MAX}
                onChange={e => (setName(e.target.value), setNote({ text: '', bad: false }))}
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
        ) : (
          <div className="mt-2">
            <Button size="sm" data-act="new" disabled={full || busy} {...(full ? { title: TOO_MANY_BOARDS } : {})} onClick={() => startNaming({ kind: 'new' })}>
              <Plus aria-hidden size={14} />
              New board
            </Button>
          </div>
        )}

        <p role="status" className={`mt-2 text-small ${note.bad ? 'text-danger' : 'text-ink-2'}`}>
          {note.text}
        </p>
      </div>
    </Tile>
  )
}

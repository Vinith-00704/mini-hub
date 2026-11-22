// Mini on the Home board: the bot, what it is doing, and a box to ask it something.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { post } from '../app/api.ts'
import { useMini } from '../app/queries.ts'
import { BotSprite } from '../components/BotSprite.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Tile } from '../components/ui/Tile.tsx'
import { botState } from '../features/frame/look.ts'

export function MiniTile() {
  const client = useQueryClient()
  const mini = useMini()
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setText(''), setNote('Sent'), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote(e.message),
  })
  const start = useMutation({ mutationFn: () => post('/v1/mini/start'), onSettled: () => client.invalidateQueries({ queryKey: ['mini'] }) })
  const m = mini.data
  const profile = m?.profile

  return (
    <Tile title={profile?.name ?? 'Mini'} state={mini.isPending ? 'loading' : 'ready'}>
      <div className="flex items-center gap-3">
        <BotSprite sprite={profile?.sprite} accent={profile?.accent ?? '#d77757'} state={botState(m?.phase)} size={44} label={profile?.name ?? 'Mini'} />
        <div className="min-w-0 text-small text-ink-2">
          {!m?.running ? (
            <>
              <p>Mini is not running.</p>
              <Button size="sm" className="mt-1" onClick={() => start.mutate()} disabled={start.isPending}>
                Start Mini
              </Button>
            </>
          ) : m.card ? (
            <p className="text-warn">A question is open on the bot. Answer it there.</p>
          ) : (
            <p className="truncate">{m.detail || 'Resting'}</p>
          )}
        </div>
      </div>
      {m?.running && (
        <form
          className="mt-3"
          onSubmit={e => {
            e.preventDefault()
            if (text.trim()) ask.mutate(text.trim())
          }}
        >
          <input
            value={text}
            onChange={e => (setText(e.target.value), setNote(''))}
            placeholder="Ask Mini"
            aria-label="Ask Mini"
            className="h-8 w-full rounded-control border border-line bg-surface-2 px-2.5 text-body placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          />
          {note && <p className="mt-1 text-micro text-ink-3">{note}</p>}
        </form>
      )}
    </Tile>
  )
}

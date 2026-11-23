// Mini's own screen: the conversation from the dashboard as a terminal log, what Mini is doing, and a question
// waiting in the bot, which is answered in the bot and never here.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { post } from '../../app/api.ts'
import { useConversation, useMini } from '../../app/queries.ts'
import { BotSprite } from '../../components/BotSprite.tsx'
import { Button, Cursor, PixelBot, Tag, Window } from '../../components/look/index.ts'
import { botState } from '../frame/look.ts'

const PERMISSION_NAMES: Record<string, string> = { screen: 'Screen', microphone: 'Microphone', computer: 'Computer control', files: 'Files' }

export function MiniScreen() {
  const client = useQueryClient()
  const mini = useMini()
  const convo = useConversation()
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const end = useRef<HTMLLIElement>(null)
  const ask = useMutation({
    mutationFn: (t: string) => post('/v1/mini/prompt', { text: t }),
    onSuccess: () => (setText(''), setNote(''), client.invalidateQueries({ queryKey: ['mini'] })),
    onError: (e: Error) => setNote(e.message),
  })
  const startStop = useMutation({
    mutationFn: (run: boolean) => post(run ? '/v1/mini/start' : '/v1/mini/stop'),
    onSettled: () => client.invalidateQueries({ queryKey: ['mini'] }),
    onError: (e: Error) => setNote(e.message),
  })
  const m = mini.data
  const profile = m?.profile
  const turns = convo.data?.turns ?? []
  const inUse = Object.entries(m?.permissions ?? {}).filter(([, on]) => on)
  const phase = botState(m?.phase)
  const look = !m?.running ? 'asleep' : phase === 'thinking' || phase === 'working' ? 'thinking' : 'idle'
  const lastReply = turns.at(-1)?.reply

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" })
  }, [turns.length, lastReply])

  return (
    <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[1fr_320px]">
      <Window title={`${profile?.name ?? 'Mini'} · conversation`} tag={m?.running ? <Tag tone="ok" pill>● Running</Tag> : <Tag tone="muted" pill>Off</Tag>} className="min-h-[60vh]">
        <ol className="tabular flex max-h-[58vh] min-h-48 flex-1 flex-col gap-3 overflow-auto bg-ground p-3 text-[13px] leading-relaxed" aria-label="Conversation">
          {turns.length === 0 && (
            <li className="text-ink-3">
              Ask Mini something below. Replies appear here as they are written. <Cursor />
            </li>
          )}
          {turns.map(t => (
            <li key={t.id} className="flex flex-col gap-1">
              <p className="break-words">
                <span className="text-accent-ink">&gt;</span> {t.text}
              </p>
              {t.reply !== undefined ? (
                <p className={`break-words whitespace-pre-wrap ${t.isError ? 'text-danger' : 'text-ink-2'}`}>
                  {t.reply}
                  {t.partial && <Cursor />}
                </p>
              ) : (
                <p className="text-ink-3">
                  Mini is working on it <Cursor />
                </p>
              )}
              {t.partial && (
                <Tag tone="warn" className="self-start">
                  Still writing
                </Tag>
              )}
            </li>
          ))}
          <li ref={end} aria-hidden />
        </ol>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (text.trim()) ask.mutate(text.trim())
          }}
        >
          <label className="lk-field flex-1">
            <b>&gt;</b>
            <input value={text} onChange={e => setText(e.target.value)} placeholder={m?.running ? 'ask mini…' : 'start Mini to ask it something'} aria-label="Ask Mini" disabled={!m?.running} />
          </label>
          <Button variant="primary" type="submit" busy={ask.isPending} disabled={!m?.running || !text.trim() || ask.isPending}>
            Send
          </Button>
        </form>
        {note && (
          <p role="status" className="text-small text-danger">
            {note}
          </p>
        )}
      </Window>

      <div className="flex flex-col gap-4">
        <Window title="Now">
          <div className="flex items-center gap-3">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center border-2 border-ink bg-card-bar">
              {profile?.sprite ? <BotSprite sprite={profile.sprite} accent={profile.accent ?? '#d97757'} state={phase} size={44} label={profile.name ?? 'Mini'} /> : <PixelBot state={look} size={44} label={profile?.name ?? 'Mini'} />}
            </span>
            <div className="min-w-0">
              <p className="text-[18px] font-black uppercase">{!m ? 'Loading' : !m.running ? 'Not running' : look === 'thinking' ? 'Thinking' : 'Idle'}</p>
              <p className="truncate text-small text-ink-2">{m?.running ? m.detail || 'Resting' : 'Start it to talk to it here.'}</p>
            </div>
          </div>
          {inUse.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {inUse.map(([k]) => (
                <Tag key={k} tone="warn">
                  {PERMISSION_NAMES[k] ?? k}: on
                </Tag>
              ))}
            </div>
          )}
          <Button size="sm" variant={m?.running ? 'danger' : 'primary'} className="self-start" onClick={() => startStop.mutate(!m?.running)} disabled={!m} busy={startStop.isPending}>
            {m?.running ? 'Stop the bot' : 'Start Mini'}
          </Button>
        </Window>
        {m?.card && (
          <Window title="Waiting in the bot" tag={<Tag tone="warn">Needs you</Tag>}>
            <p className="text-[15px] font-bold break-words">{m.card.text}</p>
            <p className="text-small text-warn">A question is open on the bot. Answer it there.</p>
          </Window>
        )}
      </div>
    </div>
  )
}

// The owner's own bot, drawn the way the Mini Bot draws it: a bot designed as pixel art shows its own frames;
// the built-in characters are drawn as a small pixel version of the default one in the bot's accent.

import { useEffect, useRef } from 'react'

type Sprite = { width: number; height: number; palette: Record<string, string>; frames: Record<string, string[] | string[][]> }

export type BotState = 'idle' | 'listening' | 'thinking' | 'working' | 'done' | 'error'

// A small stand-in for the default character: body, eyes, little legs.
const CLAWD = ['............', '..AAAAAAAA..', '.AAAAAAAAAA.', 'AAAEAAAAEAAA', 'AAAEAAAAEAAA', 'AAAAAAAAAAAA', '.AAAAAAAAAA.', '..A.A..A.A..', '..A.A..A.A..', '............']

const isSprite = (v: unknown): v is Sprite => {
  const s = v as Sprite
  return Boolean(s && typeof s.width === 'number' && typeof s.height === 'number' && s.palette && s.frames && s.frames.idle)
}

/** The picture for a state, and the frame within it. Several pictures for a state take turns. */
const pick = (frames: Record<string, string[] | string[][]>, state: string, tick: number): string[] => {
  const raw = frames[state] ?? frames.idle
  const list = Array.isArray(raw[0]) ? (raw as string[][]) : [raw as string[]]
  return list[tick % list.length]
}

const MOTION: Record<BotState, number> = { idle: 0, listening: 1, thinking: 1, working: 2, done: 1, error: 0 }

export function BotSprite({ sprite, accent, state = 'idle', size = 40, label = 'Mini' }: { sprite?: unknown; accent: string; state?: BotState; size?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const custom = isSprite(sprite) ? sprite : null
    const width = custom?.width ?? 12
    const height = custom?.height ?? 10
    const palette = custom?.palette ?? { A: accent, E: '#111111' }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let tick = 0
    let raf = 0
    let last = 0

    const draw = (time: number): void => {
      if (time - last > 300 || last === 0) {
        last = time
        tick++
        const blink = !still && tick % 14 === 0
        const rows = custom ? pick(custom.frames, blink && custom.frames.blink ? 'blink' : state, tick) : CLAWD
        const unit = Math.floor(canvas.width / Math.max(width, height))
        const bob = still ? 0 : Math.round(Math.sin(tick / 2) * MOTION[state])
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const ox = Math.floor((canvas.width - width * unit) / 2)
        const oy = Math.floor((canvas.height - height * unit) / 2) + bob
        rows.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            if (ch === '.' || ch === ' ') return
            const colour = !custom && blink && ch === 'E' ? accent : palette[ch]
            if (!colour) return
            ctx.fillStyle = colour
            ctx.fillRect(ox + x * unit, oy + y * unit, unit, unit)
          }),
        )
      }
      if (!still) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [sprite, accent, state])

  const px = size * 2
  return <canvas ref={ref} width={px} height={px} style={{ width: size, height: size, imageRendering: 'pixelated' }} role="img" aria-label={`${label}, ${state}`} />
}

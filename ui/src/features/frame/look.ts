import type { BotState } from '../../components/BotSprite.tsx'
import { accentFor, readable, textOn } from '../../design/color.ts'

/** The bot's runtime phase, as one of the states the sprite can show. */
export const botState = (phase?: string): BotState =>
  phase === 'listening' ? 'listening' : phase === 'thinking' || phase === 'sending' ? 'thinking' : phase === 'working' ? 'working' : phase === 'error' ? 'error' : 'idle'

/** Puts the chosen look on the page: theme, density and the accent (the bot's own unless the owner chose one). */
export function applyLook(look: { theme?: string; density?: string; accent?: string }, botAccent?: string): void {
  const root = document.documentElement
  const dark = look.theme === 'light' ? false : look.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true) : true
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.density = look.density ?? 'comfortable'
  const accent = accentFor(look.accent, botAccent)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-text', textOn(accent))
  root.style.setProperty('--accent-ink', readable(accent, dark ? '#16181b' : '#ffffff'))
}

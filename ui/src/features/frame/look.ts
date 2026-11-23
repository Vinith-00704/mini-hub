import type { BotState } from '../../components/BotSprite.tsx'

/** The bot's runtime phase, as one of the states the sprite can show. */
export const botState = (phase?: string): BotState =>
  phase === 'listening' ? 'listening' : phase === 'thinking' || phase === 'sending' ? 'thinking' : phase === 'working' ? 'working' : phase === 'error' ? 'error' : 'idle'

/** Puts the chosen look on the page: theme and density. The accent is Claude orange, from the tokens. */
export function applyLook(look: { theme?: string; density?: string }): void {
  const root = document.documentElement
  const dark = look.theme === 'light' ? false : look.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true) : true
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.density = look.density ?? 'comfortable'
}

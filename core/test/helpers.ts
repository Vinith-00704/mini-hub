import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** A throwaway data folder, never the owner's real one. */
export const scratch = (): { dir: string; done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'minihub-test-'))
  return { dir, done: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
}

export const newKey = (): string => randomBytes(32).toString('hex')

/** A Mini Bot runtime that is not there: enough for hubs in tests that are not about the bot. */
export const fakeMini = () => {
  const self = {
    stops: 0,
    snapshot: () => ({ running: false, profile: { name: 'Mini', avatar: 'clawd', accent: '#d77757' } }),
    refresh: async () => self.snapshot(),
    prompt: async () => 'turn-1',
    conversation: () => [],
    startBot: async () => {},
    stopBot: async () => {},
    stopControl: async () => void self.stops++,
    syncLog: async () => {},
    onChange: () => () => {},
  }
  return self
}

export const quiet = { info() {}, warn() {}, error() {}, debug() {} }

/** Waits until `check` holds, for at most `ms`. */
export const until = async (check: () => boolean | Promise<boolean>, ms = 2000): Promise<void> => {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

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

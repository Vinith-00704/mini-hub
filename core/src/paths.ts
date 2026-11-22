// Where things live. MINI_HUB_HOME and MINI_BOT_HOME override the folders, for tests and development.

import { homedir } from 'node:os'
import { join } from 'node:path'

export const hubHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.MINI_HUB_HOME ?? (env.APPDATA ? join(env.APPDATA, 'MiniHub') : join(homedir(), '.mini-hub'))

/** The Mini Bot's own data folder, where its runtime.json is. */
export const botHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.MINI_BOT_HOME ?? (env.APPDATA ? join(env.APPDATA, 'ClaudeMiniBot') : join(homedir(), '.claude-mini-bot'))

export const files = (home: string) => ({
  db: join(home, 'hub.db'),
  info: join(home, 'hub.json'),
  logs: join(home, 'logs'),
  log: join(home, 'logs', 'core.log'),
})

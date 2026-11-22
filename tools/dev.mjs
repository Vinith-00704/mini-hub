// Runs the hub for development: the core on a scratch data folder with made-up data, and the dashboard with hot
// reload. It plays the shell's part until the shell exists: it makes the keys, starts the core, and hands the
// dashboard the person key in the address's #fragment (which is never sent to any server).
//
//   node tools/dev.mjs             start, and open the dashboard in the browser
//   node tools/dev.mjs --no-open   start without opening a browser
//   node tools/dev.mjs --bot       also connect to the Mini Bot running on this PC (its real session: Stop, the
//                                  ask box and "Stop the bot" then reach it). Off by default.
//
// The data lives in .minihub-home/dev and the database key in local/dev-db-key, both ignored by git.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const home = join(repo, '.minihub-home', 'dev')
const keyFile = join(repo, 'local', 'dev-db-key')
const UI_PORT = 5173
const uiOrigin = `http://127.0.0.1:${UI_PORT}`

mkdirSync(home, { recursive: true })
mkdirSync(dirname(keyFile), { recursive: true })
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 })
const dbKey = readFileSync(keyFile, 'utf8').trim()
const personKey = randomBytes(32).toString('hex')

if (!existsSync(join(home, 'hub.db'))) {
  const seeded = spawn(process.execPath, [join(repo, 'tools', 'seed.mjs'), home, dbKey], { stdio: 'inherit' })
  await new Promise(r => seeded.on('exit', r))
}

const env = { ...process.env, MINI_HUB_HOME: home, ...(flags.has('--bot') ? {} : { MINI_BOT_HOME: join(home, 'no-bot') }) }
const core = spawn(process.execPath, [join(repo, 'core', 'src', 'main.ts')], { env, stdio: ['pipe', 'pipe', 'inherit'] })
core.stdin.write(`${JSON.stringify({ dbKey, personKey, uiOrigin })}\n`)

const port = await new Promise((resolvePort, reject) => {
  let out = ''
  core.stdout.on('data', d => {
    out += String(d)
    const ready = out.match(/\{"ready":true,"port":(\d+)\}/)
    if (ready) resolvePort(Number(ready[1]))
  })
  core.on('exit', code => reject(new Error(`The core stopped (exit ${code}).`)))
})

const vite = spawn(process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(UI_PORT), '--strictPort'], {
  cwd: join(repo, 'ui'),
  stdio: 'inherit',
})

const url = `${uiOrigin}/#api=${port}&k=${personKey}`
process.stdout.write(`\nMini Hub (development)\n  Core:      http://127.0.0.1:${port}\n  Dashboard: ${url}\n\n`)
if (!flags.has('--no-open')) spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { stdio: 'ignore', windowsHide: true })

const stop = () => {
  core.stdin.end()
  vite.kill()
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
core.on('exit', () => (vite.kill(), process.exit(0)))

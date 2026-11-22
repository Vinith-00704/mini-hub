import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { newKey, scratch } from './helpers.ts'

const BUNDLE = fileURLToPath(new URL('../../tools/bundle-core.mjs', import.meta.url))

let out: ReturnType<typeof scratch>
let home: ReturnType<typeof scratch>
beforeEach(() => ((out = scratch()), (home = scratch())))
afterEach(() => (out.done(), home.done()))

describe('core bundle', () => {
  test('the bundled core starts, answers health, and exits on end of input', async () => {
    const built = spawnSync(process.execPath, [BUNDLE, out.dir, '--no-node'], { encoding: 'utf8' })
    expect(built.stderr).toBe('')
    expect(built.status).toBe(0)
    expect(existsSync(join(out.dir, 'core.mjs'))).toBe(true)
    expect(existsSync(join(out.dir, 'migrations', '001-init.sql'))).toBe(true)
    expect(existsSync(join(out.dir, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds', 'win32-x64.node'))).toBe(true)
    expect(existsSync(join(out.dir, 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds', 'linux-x64.node'))).toBe(false)
    expect(existsSync(join(out.dir, 'node.exe'))).toBe(false)

    const child = spawn(process.execPath, [join(out.dir, 'core.mjs')], { cwd: out.dir, env: { ...process.env, MINI_HUB_HOME: home.dir, MINI_BOT_HOME: join(home.dir, 'no-bot') } })
    child.stdin.write(`${JSON.stringify({ dbKey: newKey(), personKey: newKey() })}\n`)
    const port = await new Promise<number>((resolve, reject) => {
      let text = ''
      child.stdout.on('data', d => {
        text += String(d)
        const m = text.match(/\{"ready":true,"port":(\d+)\}/)
        if (m) resolve(Number(m[1]))
      })
      let err = ''
      child.stderr.on('data', d => (err += String(d)))
      child.on('exit', code => reject(new Error(`exited ${code}: ${err}`)))
    })
    expect((await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json()).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(home.dir, 'hub.json'), 'utf8')).port).toBe(port)
    child.stdin.end()
    const code = await new Promise<number | null>(r => child.on('exit', r))
    expect(code).toBe(0)
    expect(existsSync(join(home.dir, 'hub.json'))).toBe(false)
  })
})

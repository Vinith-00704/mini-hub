// This computer, as a device like any other (docs/06-connectors.md > pc). Anything beyond these few actions is the
// Mini Bot's computer control, with its own permissions.

import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { freemem, totalmem, uptime } from 'node:os'
import { z } from 'zod'
import type { Connector, Ctx } from './types.ts'

export type Exec = (cmd: string, args: string[]) => Promise<void>

const run: Exec = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true }, error => (error ? reject(error) : resolve())))

const MB = 1024 * 1024
const none = z.object({}).strict()
// How often the PC's own state is refreshed while the hub runs.
const STATE_EVERY_MS = 60_000

export function pcConnector({ exec = run }: { exec?: Exec } = {}): Connector {
  let timer: NodeJS.Timeout | null = null

  const status = async (): Promise<Record<string, number>> => {
    const root = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : '/'
    let diskFreeGb = 0
    try {
      const s = await statfs(root)
      diskFreeGb = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
    } catch {}
    return {
      memoryFreeMb: Math.round(freemem() / MB),
      memoryTotalMb: Math.round(totalmem() / MB),
      diskFreeGb,
      uptimeMinutes: Math.round(uptime() / 60),
    }
  }

  return {
    manifest: { id: 'pc', name: 'This PC', kind: 'device', icon: 'monitor', scopes: ['pc.status.read', 'pc.power'], eventTypes: ['device_state'], widgets: ['device-status'], multiple: false },
    async start(ctx: Ctx) {
      ctx.devices.upsert({ id: 'pc', connectorId: 'pc', kind: 'pc', name: 'This PC', state: { online: true, ...(await status()) } })
      timer = setInterval(() => void status().then(s => ctx.devices.setState('pc', { online: true, ...s })), STATE_EVERY_MS)
      timer.unref()
    },
    async stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    health: () => ({ state: 'ok' }),
    actions: {
      status: { title: 'Check this PC', scope: 'pc.status.read', risk: 'read', args: none, run: () => status() },
      lock: {
        title: 'Lock this PC',
        scope: 'pc.power',
        risk: 'act',
        args: none,
        describe: () => 'Lock this PC',
        run: () => exec('rundll32.exe', ['user32.dll,LockWorkStation']).then(() => ({ locked: true })),
      },
      sleep: {
        title: 'Put this PC to sleep',
        scope: 'pc.power',
        risk: 'important',
        args: none,
        describe: () => 'Put this PC to sleep',
        run: () => exec('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']).then(() => ({ sleeping: true })),
      },
      restart: {
        title: 'Restart this PC',
        scope: 'pc.power',
        risk: 'important',
        args: none,
        describe: () => 'Restart this PC',
        run: () => exec('shutdown', ['/r', '/t', '0']).then(() => ({ restarting: true })),
      },
      shut_down: {
        title: 'Shut down this PC',
        scope: 'pc.power',
        risk: 'important',
        args: none,
        describe: () => 'Shut down this PC',
        run: () => exec('shutdown', ['/s', '/t', '0']).then(() => ({ shuttingDown: true })),
      },
    },
  }
}

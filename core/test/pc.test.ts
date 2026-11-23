import { join } from 'node:path'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { pcConnector } from '../src/connectors/pc.ts'
import { DeviceStore, Registry } from '../src/connectors/registry.ts'
import { Secrets } from '../src/connectors/secrets.ts'
import type { Connector } from '../src/connectors/types.ts'
import { Grants } from '../src/rules/grants.ts'
import { openStore, type Store } from '../src/store/db.ts'
import { newKey, scratch } from './helpers.ts'

let s: ReturnType<typeof scratch>
let db: Store
beforeEach(() => {
  s = scratch()
  db = openStore(join(s.dir, 'hub.db'), newKey())
})
afterEach(() => {
  db.close()
  s.done()
})

const quietLog = { info() {}, warn() {}, error() {}, debug() {} }
const registry = () => new Registry({ db, devices: new DeviceStore(db), emit: () => {}, log: quietLog, grants: new Grants(db), secrets: new Secrets(db) })

describe('registry', () => {
  test('registry refuses an action without a risk', () => {
    const bad = {
      manifest: { id: 'bad', name: 'Bad', kind: 'device', icon: 'x', scopes: [], eventTypes: [], widgets: [], multiple: false },
      start: async () => {},
      stop: async () => {},
      health: () => ({ state: 'ok' }),
      actions: { poke: { title: 'Poke', scope: 'pc.power', args: z.object({}), describe: () => 'Poke', run: async () => null } },
    } as unknown as Connector
    expect(() => registry().add(bad)).toThrow(/risk/)
  })

  test('registry refuses an act action without describe', () => {
    const bad = {
      manifest: { id: 'bad', name: 'Bad', kind: 'device', icon: 'x', scopes: [], eventTypes: [], widgets: [], multiple: false },
      start: async () => {},
      stop: async () => {},
      health: () => ({ state: 'ok' }),
      actions: { poke: { title: 'Poke', scope: 'pc.power', risk: 'act', args: z.object({}), run: async () => null } },
    } as unknown as Connector
    expect(() => registry().add(bad)).toThrow(/describe/)
  })
})

describe('pc connector', () => {
  test('pc registers itself as a device', async () => {
    const r = registry()
    r.add(pcConnector({ exec: async () => {} }))
    await r.startAll()
    const pc = new DeviceStore(db).get('pc')
    expect(pc?.kind).toBe('pc')
    expect(pc?.connectorId).toBe('pc')
    await r.stopAll()
  })

  test('pc status reports memory, disk and uptime', async () => {
    const r = registry()
    r.add(pcConnector({ exec: async () => {} }))
    const status = (await r.find('pc', 'status').run({}, undefined)) as Record<string, number>
    expect(status.memoryFreeMb).toBeGreaterThan(0)
    expect(status.memoryTotalMb).toBeGreaterThan(status.memoryFreeMb)
    expect(status.uptimeMinutes).toBeGreaterThanOrEqual(0)
    expect(typeof status.diskFreeGb).toBe('number')
  })

  test('pc lock runs the lock command', async () => {
    const ran: string[][] = []
    const r = registry()
    r.add(pcConnector({ exec: async (cmd, args) => void ran.push([cmd, ...args]) }))
    await r.find('pc', 'lock').run({}, undefined)
    expect(ran).toEqual([['rundll32.exe', 'user32.dll,LockWorkStation']])
  })

  test('pc actions carry the scopes and risks of the plan', () => {
    const r = registry()
    r.add(pcConnector({ exec: async () => {} }))
    const info = Object.fromEntries(r.actions().map(a => [a.name, [a.scope, a.risk]]))
    expect(info).toEqual({
      status: ['pc.status.read', 'read'],
      lock: ['pc.power', 'act'],
      sleep: ['pc.power', 'important'],
      restart: ['pc.power', 'important'],
      shut_down: ['pc.power', 'important'],
    })
    expect(r.find('pc', 'shut_down').describe?.({}, undefined)).toBe('Shut down this PC')
  })
})

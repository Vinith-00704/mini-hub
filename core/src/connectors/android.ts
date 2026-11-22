// An Android phone (docs/06 > android). Its other half is the phone app; pairing and the link are in core/src/link.
// Actions become commands over the link; the phone checks its own "From my PC" switch as well (docs/04 > Commands).

import { z } from 'zod'
import { SCOPES, type ScopeId } from '@minihub/protocol'
import { ApiFailure } from '../rules/policy.ts'
import type { Phones } from '../link/phones.ts'
import type { DeviceLink } from '../link/server.ts'
import type { Tokens } from '../link/tokens.ts'
import type { Connector } from './types.ts'

const PHONE_SCOPES = (Object.keys(SCOPES) as ScopeId[]).filter(k => SCOPES[k].connector === 'android')

export function androidConnector(d: { phones: Phones; link: DeviceLink; tokens: Tokens }): Connector {
  return {
    manifest: {
      id: 'android',
      name: 'Android phone',
      kind: 'device',
      icon: 'smartphone',
      scopes: PHONE_SCOPES,
      eventTypes: ['call', 'sms', 'chat', 'notification', 'device_state', 'app_usage', 'mini_action'],
      widgets: ['device-status', 'calls', 'messages', 'notifications'],
      multiple: true,
    },
    async start() {},
    async stop() {},
    health() {
      const paired = d.tokens.paired()
      if (paired.length === 0) return { state: 'off', note: 'No phone is paired.' }
      if (!paired.some(id => d.link.connected(id))) return { state: 'down', note: 'Not at home.' }
      return { state: 'ok' }
    },
    actions: {
      status: {
        title: "Check the phone's battery and network",
        scope: 'phone.usage.read',
        risk: 'read',
        args: z.object({}).strict(),
        run: async (_args, device, how) => {
          if (!device) throw new ApiFailure(400, 'bad-request', 'Say which phone.')
          return d.phones.command(device.id, 'status', {}, how ?? { origin: 'person', approved: true }, 'phone.usage.read')
        },
      },
    },
  }
}

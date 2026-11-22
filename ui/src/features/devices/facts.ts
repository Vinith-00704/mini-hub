// Plain words for a device's live state, shared by the Devices grid, a device's page and the status tile.

import type { Device } from '../../app/queries.ts'

const NETWORK: Record<string, string> = { wifi: 'Wi-Fi', mobile: 'Mobile data', none: 'No network' }

export const isOnline = (d: Device): boolean => d.state.online === true

/** "Online", or for a phone that is not linked, "Not at home" (it links only on the home Wi-Fi). */
export const presence = (d: Device): string => (isOnline(d) ? 'Online' : d.kind === 'phone' ? 'Not at home' : 'Away')

export const battery = (d: Device): string | undefined => {
  const b = d.state.battery
  return typeof b === 'number' ? `${b}%${d.state.charging === true ? ', charging' : ''}` : undefined
}

export const network = (d: Device): string | undefined => {
  const n = d.state.network
  return typeof n === 'string' ? (NETWORK[n] ?? n) : undefined
}

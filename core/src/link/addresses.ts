// Where the device link may listen: the PC's own private IPv4 addresses only (docs/03 > The network).

import type { NetworkInterfaceInfo } from 'node:os'

const isPrivate = (a: string): boolean => {
  const [x, y] = a.split('.').map(Number) as [number, number]
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)
}

export function privateAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && isPrivate(i.address) && !out.includes(i.address)) out.push(i.address)
  return out
}

/** The address for the pairing code: a home router's 192.168.x.x first, else the first private one. */
export const preferredAddress = (addresses: string[]): string | undefined => addresses.find(a => a.startsWith('192.168.')) ?? addresses[0]

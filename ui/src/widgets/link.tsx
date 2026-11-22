// The dashboard routes by the address's hash, so a plain link reaches a screen from anywhere, in or out of the router.

import type { ReactNode } from 'react'

export function Link({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={`#${to}`} className="inline-flex">
      {children}
    </a>
  )
}

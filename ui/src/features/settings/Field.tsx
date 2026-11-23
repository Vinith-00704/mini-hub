// One row of a settings tile: what it is, a line of help, and its control.

import type { ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[var(--row)] flex-wrap items-center gap-4 border-b border-line/60 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-body">{label}</div>
        {hint && <div className="text-small text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

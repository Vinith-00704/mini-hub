// A tile on a board. Every tile handles the same four states the same way (docs/07 > Widgets).

import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import { Empty } from './bits.tsx'

export type TileState = 'ready' | 'loading' | 'empty' | 'error' | 'not-allowed'

export function Tile({
  title,
  action,
  state = 'ready',
  emptyText = 'Nothing yet.',
  emptyAction,
  error,
  onRetry,
  children,
  className = '',
}: {
  title: string
  action?: ReactNode
  state?: TileState
  emptyText?: string
  emptyAction?: ReactNode
  error?: string
  onRetry?: () => void
  children?: ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col rounded-tile border border-line bg-surface p-[var(--pad-tile)] shadow-[var(--shadow-tile)] ${className}`}>
      <header className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h2 className="truncate text-head font-semibold">{title}</h2>
        {action}
      </header>
      <div className="min-h-0 flex-1">
        {state === 'loading' && (
          <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-4 animate-pulse rounded bg-surface-2" style={{ width: `${80 - i * 15}%` }} />
            ))}
          </div>
        )}
        {state === 'empty' && <Empty text={emptyText} action={emptyAction} />}
        {state === 'not-allowed' && <Empty text={emptyText} action={emptyAction} />}
        {state === 'error' && (
          <Empty
            text={error ?? 'This could not be loaded.'}
            action={
              onRetry && (
                <Button size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )
            }
          />
        )}
        {state === 'ready' && children}
      </div>
    </section>
  )
}

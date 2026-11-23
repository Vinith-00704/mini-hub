// A tile on a board: now the look's Window (docs/superpowers/specs/2026-11-22-claude-look-design.md > The parts).

import type { ReactNode } from 'react'
import { Window, type PartState } from '../look/index.ts'

export type TileState = PartState

export function Tile(props: {
  title: string
  action?: ReactNode
  tag?: ReactNode
  state?: TileState
  emptyText?: string
  emptyAction?: ReactNode
  error?: string
  onRetry?: () => void
  notConnected?: string
  children?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return <Window {...props} />
}

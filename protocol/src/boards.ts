// The dashboard's boards: pages of tiles on a 12-column grid (docs/07 > Boards, docs/05 > The dashboard's own things).

import { z } from 'zod'

/** A board's, a tile's and a tile type's id: lower-case letters, digits and dashes. */
export const BOARD_ID = /^[a-z0-9-]{1,40}$/

export const widgetSchema = z
  .object({
    id: z.string().regex(BOARD_ID),
    // Any type is kept, also one this version does not know (a newer version's tile); the dashboard says so on it.
    type: z.string().regex(BOARD_ID),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(199),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(12),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(t => t.x + t.w <= 12, { message: 'A tile goes past the right edge.' })

export const layoutSchema = z.object({ widgets: z.array(widgetSchema).max(60) })

export type Widget = z.infer<typeof widgetSchema>
export type Layout = z.infer<typeof layoutSchema>
export type Board = { id: string; name: string; position: number; layout: Layout }

const tile = (type: string, x: number, y: number, w: number, h: number): Widget => ({ id: `w-${type}`, type, x, y, w, h, settings: {} })

/** The first board, Home, as the dashboard has always laid it out. */
export const DEFAULT_HOME: Layout = {
  widgets: [
    tile('mini', 0, 0, 4, 3),
    tile('week', 4, 0, 5, 3),
    tile('device-status', 9, 0, 3, 3),
    tile('approvals', 0, 3, 3, 3),
    tile('devices', 3, 3, 3, 3),
    tile('mail', 6, 3, 3, 3),
    tile('mini-activity', 9, 3, 3, 3),
    tile('calls', 0, 6, 3, 4),
    tile('messages', 3, 6, 6, 4),
    tile('notifications', 9, 6, 3, 4),
  ],
}

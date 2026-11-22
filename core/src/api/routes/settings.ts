// The dashboard's own choices: how it looks. Kept in the encrypted database with everything else.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Hub } from '../../hub.ts'
import { getSetting, setSetting } from '../../store/db.ts'

export const uiSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  /** "bot" follows the active bot's accent; otherwise a named colour or a hex value. */
  accent: z.union([z.enum(['bot', 'claude', 'blue', 'green', 'pink', 'orange', 'purple']), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  density: z.enum(['comfortable', 'compact']),
  privacy: z.boolean(),
})

export type UiSettings = z.infer<typeof uiSettingsSchema>

export const DEFAULT_UI: UiSettings = { theme: 'dark', accent: 'bot', density: 'comfortable', privacy: false }

export function settingsRoutes(app: FastifyInstance, hub: Hub): void {
  const current = (): UiSettings => ({ ...DEFAULT_UI, ...getSetting<Partial<UiSettings>>(hub.db, 'ui', {}) })

  app.get('/v1/settings', { config: { access: 'person' } }, async () => ({ ...current(), dataDir: hub.dataDir ?? null, version: hub.version }))

  app.patch('/v1/settings', { config: { access: 'person', audit: 'settings' } }, async req => {
    const patch = uiSettingsSchema.partial().strict().parse(req.body)
    const next = { ...current(), ...patch }
    setSetting(hub.db, 'ui', next)
    return next
  })
}

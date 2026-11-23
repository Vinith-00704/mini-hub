// The dashboard's own choices: how it looks, and how long things are kept (Settings > Data). Kept in the encrypted database with everything else.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { retentionPatchSchema } from '../../data/retention.ts'
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

  app.get('/v1/settings', { config: { access: 'person' } }, async () => ({
    ...current(),
    retention: hub.retention.current(),
    dataDir: hub.dataDir ?? null,
    version: hub.version,
  }))

  app.patch('/v1/settings', { config: { access: 'person', audit: 'settings' } }, async req => {
    const { retention, ...look } = uiSettingsSchema.partial().extend({ retention: retentionPatchSchema.optional() }).strict().parse(req.body)
    const next = { ...current(), ...look }
    setSetting(hub.db, 'ui', next)
    // A shorter time removes the older items at the next run, not at once.
    return { ...next, retention: retention ? hub.retention.update(retention) : hub.retention.current() }
  })
}

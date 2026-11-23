// What a tile's settings may hold, and how they are read. A board stores them as it was given them, so a tile never
// trusts them: each reader takes a value only if it is of the right kind and else uses the default.

export type Settings = Record<string, unknown>
export type TileProps = { settings?: Settings }

export const MAX_NOTE = 2000
export const MAX_BUTTONS = 8
export const MAX_LABEL = 40
export const MAX_PROMPT = 2000

/** At most `max` characters, cut between whole characters (an emoji is not split). */
export const clip = (s: string, max: number): string => (s.length <= max ? s : Array.from(s).slice(0, max).join(''))

export const text = (s: Settings, key: string): string => (typeof s[key] === 'string' ? (s[key] as string) : '')
export const flag = (s: Settings, key: string, fallback: boolean): boolean => (typeof s[key] === 'boolean' ? (s[key] as boolean) : fallback)
/** A note as the tile shows it: at most 2,000 characters, whatever the hub holds. */
export const noteText = (s: Settings): string => clip(text(s, 'text'), MAX_NOTE)

export const strings = (s: Settings, key: string): string[] => {
  const v = s[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
export const oneOf = <T extends string | number>(s: Settings, key: string, allowed: readonly T[], fallback: T): T => {
  const v = s[key]
  return allowed.includes(v as T) ? (v as T) : fallback
}

export const MINI_COUNTS = [3, 5, 8, 12] as const
export const DEFAULT_MINI_COUNT = 5

export const TODAY_COUNTS = [
  { id: 'calls', label: 'Calls' },
  { id: 'messages', label: 'Messages' },
  { id: 'mail', label: 'Mail' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'mini', label: 'Mini did' },
] as const
export type TodayCount = (typeof TODAY_COUNTS)[number]['id']

/** The counts a Today tile shows: the ones ticked, else all of them. */
export const todayCounts = (s: Settings): TodayCount[] => {
  const ticked = strings(s, 'counts')
  const chosen = TODAY_COUNTS.map(c => c.id).filter(id => ticked.includes(id))
  return chosen.length ? chosen : TODAY_COUNTS.map(c => c.id)
}

export const HOURS = ['system', '12', '24'] as const
export type Hours = (typeof HOURS)[number]
export const HOURS_LABEL: Record<Hours, string> = { system: 'As Windows does', '12': '12-hour', '24': '24-hour' }

/** One button of a quick-actions tile: a prompt for Mini, or an action the hub runs. */
export type QuickButton =
  | { kind: 'prompt'; label: string; text: string }
  | { kind: 'action'; label: string; connector: string; name: string; device?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The buttons stored in a tile's settings: at most 8, each with a label; anything else is left out. */
export const quickButtons = (s: Settings): QuickButton[] => {
  const raw = Array.isArray(s.buttons) ? (s.buttons as unknown[]) : []
  const out: QuickButton[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const b = r as Record<string, unknown>
    const label = clip(str(b.label), MAX_LABEL)
    if (!label) continue
    if (b.kind === 'prompt') out.push({ kind: 'prompt', label, text: clip(str(b.text), MAX_PROMPT) })
    else if (b.kind === 'action' && str(b.connector) && str(b.name)) out.push({ kind: 'action', label, connector: str(b.connector), name: str(b.name), ...(str(b.device) ? { device: str(b.device) } : {}) })
    if (out.length >= MAX_BUTTONS) break
  }
  return out
}

/** Whether an action's arguments schema asks for nothing (no required properties): the only kind a button can run. */
export const needsNoArguments = (schema: Record<string, unknown>): boolean => !(Array.isArray(schema.required) && schema.required.length > 0)

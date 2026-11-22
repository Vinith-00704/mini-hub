// The accent is the bot's colour. These keep it readable whatever the owner's bot looks like (docs/07 > Colour).

export const DEFAULT_ACCENT = '#d77757'

const NAMED: Record<string, string> = {
  claude: DEFAULT_ACCENT,
  blue: '#4c8dff',
  green: '#2fbf71',
  pink: '#ef5da8',
  orange: '#f58f29',
  purple: '#8e5cf0',
}

const HEX = /^#[0-9a-f]{6}$/i

/** The accent to use: "bot" follows the bot's own accent; a named colour or a hex value is used as is. */
export function accentFor(setting: string | undefined, botAccent: string | undefined): string {
  if (setting && HEX.test(setting)) return setting.toLowerCase()
  if (setting && setting !== 'bot' && NAMED[setting]) return NAMED[setting]
  return botAccent && HEX.test(botAccent) ? botAccent.toLowerCase() : DEFAULT_ACCENT
}

const channels = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on the colour. */
export function textOn(hex: string): '#000000' | '#ffffff' {
  return contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff'
}

const toHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = channels(hex).map(c => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

const fromHsl = (h: number, s: number, l: number): string => {
  const f = (n: number): string => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** The same hue, lighter or darker in 5% steps, until it reads on the surface. */
export function readable(accent: string, surface: string, min = 4.5): string {
  if (contrast(accent, surface) >= min) return accent.toLowerCase()
  const [h, s, l] = toHsl(accent)
  const lighter = luminance(surface) < 0.5
  for (let step = 1; step <= 20; step++) {
    const next = fromHsl(h, s, Math.min(1, Math.max(0, l + (lighter ? 0.05 : -0.05) * step)))
    if (contrast(next, surface) >= min) return next
  }
  return lighter ? '#ffffff' : '#000000'
}

import * as ToggleGroup from '@radix-ui/react-toggle-group'

/** `quiet`: when chosen, shown in neutral grey instead of the accent, so "off" never looks like something is on. */
export type Option<T extends string> = { value: T; label: string; quiet?: boolean }

const CHOSEN = 'data-[state=on]:bg-accent data-[state=on]:text-accent-text'
const CHOSEN_QUIET = 'data-[state=on]:bg-line-strong data-[state=on]:text-ink'

/** A small choice of a few values, such as Mini's off / ask / on. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as T)}
      aria-label={label}
      className="inline-flex rounded-control border border-line bg-surface-2 p-0.5"
    >
      {options.map(o => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          aria-label={`${label}: ${o.label}`}
          className={`h-6 min-w-10 rounded-[6px] px-2 text-micro text-ink-2 transition-colors duration-[120ms] hover:text-ink ${o.quiet ? CHOSEN_QUIET : CHOSEN}`}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

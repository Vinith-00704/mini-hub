import * as RadixSwitch from '@radix-ui/react-switch'

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-surface-2 transition-colors duration-[120ms] data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-ink-2 transition-transform duration-[120ms] data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-accent-text" />
    </RadixSwitch.Root>
  )
}

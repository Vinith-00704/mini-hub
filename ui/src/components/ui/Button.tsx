import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const STYLES: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:brightness-110',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-line-strong',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'text-danger border border-danger/60 hover:bg-danger hover:text-white',
}

export function Button({ variant = 'secondary', className = '', size = 'md', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'h-7 px-2.5 text-small' : 'h-8 px-3 text-body'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-[background,color,border,filter] duration-[120ms] disabled:opacity-50 disabled:pointer-events-none ${pad} ${STYLES[variant]} ${className}`}
      {...rest}
    />
  )
}

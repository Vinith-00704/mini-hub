// A dialog over the page, in the look's window: the page behind it is not reachable (inert), focus stays inside and
// wraps with Tab, Esc closes it (and is not passed on to the page, where it would leave edit mode), and focus goes
// back to where it was when the dialog closes.

import { X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const focusables = (box: HTMLElement): HTMLElement[] => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]') && el.getClientRects().length > 0)

export function Dialog({
  label,
  onClose,
  wide = false,
  children,
}: {
  /** The dialog's name for screen readers, and its title. */
  label: string
  onClose: () => void
  wide?: boolean
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement
    const page = document.getElementById('root')
    // Given back as it was found: only a page that was not inert before is made reachable again.
    const wasInert = page?.hasAttribute('inert') ?? true
    page?.setAttribute('inert', '')
    const el = box.current as HTMLDivElement
    // The first thing in the body that takes focus, else the dialog itself.
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(el.querySelector('[data-body]') ?? el)[0] ?? el
    first.focus()
    return () => {
      if (!wasInert) page?.removeAttribute('inert')
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') {
      const all = focusables(box.current as HTMLElement)
      const at = all.indexOf(document.activeElement as HTMLElement)
      if (all.length === 0) return e.preventDefault()
      if (e.shiftKey && at <= 0) (e.preventDefault(), all[all.length - 1]?.focus())
      else if (!e.shiftKey && (at < 0 || at === all.length - 1)) (e.preventDefault(), all[0]?.focus())
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
      // Undo belongs to the board behind; it is not changed from in here.
      e.preventDefault()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`lk-win lk-drop flex max-h-[calc(100vh-2rem)] w-full flex-col ${wide ? 'max-w-[980px]' : 'max-w-[560px]'}`}
      >
        <header className="lk-win-bar shrink-0">
          <span className="lk-sq" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <h2 className="lk-win-title">{label}</h2>
          <button type="button" aria-label="Close" title="Close (Esc)" className="flex h-7 w-7 cursor-pointer items-center justify-center border-2 border-transparent hover:border-ink" onClick={onClose}>
            <X aria-hidden size={16} />
          </button>
        </header>
        <div data-body className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

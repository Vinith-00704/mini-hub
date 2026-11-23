// The window's frame: the top bar (logo, sections as pills, the command box, what is waiting, dark or light, Stop), the stopped
// bar, the screen, and the approval cards. It also applies the look: theme and density.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { post } from '../../app/api.ts'
import { useLive } from '../../app/live.ts'
import { useHubState, useMini, useSettings } from '../../app/queries.ts'
import { Button, PixelBot } from '../../components/look/index.ts'
import { ApprovalCards } from './ApprovalCards.tsx'
import { applyLook, botState } from './look.ts'
import { TopBar } from './TopBar.tsx'

export const SECTIONS = [
  { to: '/', label: 'Home' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/devices', label: 'Devices' },
  { to: '/mini', label: 'Mini' },
  { to: '/activity', label: 'Activity' },
  { to: '/permissions', label: 'Permissions' },
  { to: '/settings', label: 'Settings' },
] as const

const TITLES: Record<string, string> = { '/': 'Home', '/inbox': 'Inbox', '/mini': 'Mini', '/devices': 'Devices', '/activity': 'Activity', '/permissions': 'Permissions', '/settings': 'Settings', '/look': 'The look' }

export const titleFor = (path: string): string => TITLES[path] ?? (path.startsWith('/devices/') ? 'Devices' : 'Mini Hub')

function useLook(): void {
  const settings = useSettings().data
  useEffect(() => {
    applyLook(settings ?? {})
    if (settings?.theme !== 'system') return
    // "Follow Windows": change with it.
    const m = window.matchMedia?.('(prefers-color-scheme: dark)')
    const on = () => applyLook(settings)
    m?.addEventListener('change', on)
    return () => m?.removeEventListener('change', on)
  }, [settings])
}

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()

/** The big heading of a screen, with the date above it and anything else (Home's numbers) to its right. */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div>
        <div className="tabular mb-1 text-micro text-ink-3">{today()}</div>
        <h1 className="text-[52px] leading-[0.9] font-black tracking-[-0.01em] uppercase">{title}</h1>
      </div>
      <div className="flex-1" />
      {children}
    </div>
  )
}

export function Frame() {
  useLive()
  useLook()
  const client = useQueryClient()
  const state = useHubState()
  const mini = useMini().data
  const path = useRouterState({ select: s => s.location.pathname })
  const [cardsHidden, setCardsHidden] = useState(false)
  const resume = useMutation({ mutationFn: () => post('/v1/resume'), onSettled: () => client.invalidateQueries({ queryKey: ['state'] }) })
  const linked = (state.data?.devices ?? []).some(d => d.kind === 'phone' && d.state.online === true)
  const phones = (state.data?.devices ?? []).some(d => d.kind === 'phone')
  const profile = mini?.profile ?? state.data?.mini.profile

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 px-6 pt-4 pb-3">
        <Link to="/mini" className="flex items-center gap-2" title={`${profile?.name ?? 'Mini'}: ${mini?.running ? (mini.card ? 'needs you, in the bot' : mini.detail || 'resting') : 'not running'}`}>
          <PixelBot state={!mini?.running ? 'asleep' : botState(mini.phase) === 'thinking' || botState(mini.phase) === 'working' ? 'thinking' : 'idle'} size={28} label={profile?.name ?? 'Mini'} />
          <span className="text-[18px] font-black tracking-[0.04em]">MINI HUB</span>
        </Link>
        <nav aria-label="Sections" className="flex overflow-x-auto rounded-full border-2 border-ink bg-card p-[3px] shadow-[3px_3px_0_var(--shadow)]">
          {SECTIONS.map(s => (
            <Link
              key={s.to}
              to={s.to}
              activeOptions={{ exact: s.to === '/', includeSearch: false }}
              className="rounded-full px-3 py-1.5 text-[11.5px] font-extrabold tracking-[0.07em] whitespace-nowrap text-ink-2 uppercase hover:text-ink data-[status=active]:bg-accent data-[status=active]:text-on-accent"
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <TopBar onBell={() => setCardsHidden(h => !h)} />
      </header>
      {state.data?.stopped && (
        <div role="status" className="lk-stripes moving mx-6 mb-3 flex shrink-0 items-center justify-between gap-3 px-3 py-2">
          <span>{phones && !linked ? 'Mini is stopped · phones are not linked now' : 'Mini is stopped · your data is still being collected'}</span>
          {resume.error && <span className="bg-danger px-2 text-[11px] font-bold text-black">{resume.error.message}</span>}
          <Button variant="primary" size="sm" onClick={() => resume.mutate()} busy={resume.isPending}>
            Resume
          </Button>
        </div>
      )}
      {state.error && (
        <div role="status" className="mx-6 mb-3 border-2 border-danger bg-card px-3 py-2 text-small text-danger">
          {state.error.message}
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {path !== '/' && <PageHead title={titleFor(path)} />}
        <Outlet />
      </main>
      <ApprovalCards hidden={cardsHidden} onShow={() => setCardsHidden(false)} />
    </div>
  )
}

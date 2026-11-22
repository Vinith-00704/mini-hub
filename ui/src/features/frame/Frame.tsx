// The window's frame: the rail, the stopped bar, the screen, and approval cards. It also applies the look:
// theme, density, and the accent taken from the owner's bot.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { Activity, Bot, House, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { post } from '../../app/api.ts'
import { useLive } from '../../app/live.ts'
import { useHubState, useMini, useSettings } from '../../app/queries.ts'
import { BotSprite } from '../../components/BotSprite.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { ApprovalCards } from './ApprovalCards.tsx'
import { applyLook, botState } from './look.ts'
import { TopBar } from './TopBar.tsx'

const SECTIONS = [
  { to: '/', label: 'Home', icon: House },
  { to: '/mini', label: 'Mini', icon: Bot },
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/activity', label: 'Activity', icon: Activity },
] as const
const LOWER = [
  { to: '/permissions', label: 'Permissions', icon: ShieldCheck },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

const TITLES: Record<string, string> = { '/': 'Home', '/mini': 'Mini', '/devices': 'Devices', '/activity': 'Activity', '/permissions': 'Permissions', '/settings': 'Settings' }


function useLook(): void {
  const settings = useSettings().data
  const mini = useMini().data
  useEffect(() => {
    applyLook(settings ?? {}, mini?.profile?.accent)
  }, [settings, mini?.profile?.accent])
}

function NavItem({ to, label, icon: Icon, open, badge }: { to: string; label: string; icon: typeof House; open: boolean; badge?: number }) {
  return (
    <Link
      to={to}
      className="flex h-9 items-center gap-3 rounded-control px-2.5 text-body text-ink-2 transition-colors duration-[120ms] hover:bg-surface-2 hover:text-ink data-[status=active]:bg-surface-2 data-[status=active]:text-ink"
      title={open ? undefined : label}
    >
      <Icon aria-hidden size={18} className="shrink-0" />
      {open && <span className="flex-1 truncate">{label}</span>}
      {open && badge ? <span className="tabular rounded-chip bg-warn/20 px-1.5 text-micro text-warn">{badge}</span> : null}
    </Link>
  )
}

export function Frame() {
  useLive()
  useLook()
  const client = useQueryClient()
  const state = useHubState()
  const mini = useMini().data
  const path = useRouterState({ select: s => s.location.pathname })
  const [open, setOpen] = useState(() => window.innerWidth >= 1100)
  const resume = useMutation({ mutationFn: () => post('/v1/resume'), onSettled: () => client.invalidateQueries({ queryKey: ['state'] }) })

  useEffect(() => {
    const onResize = () => setOpen(window.innerWidth >= 1100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const profile = mini?.profile ?? state.data?.mini.profile
  return (
    <div className="flex h-full">
      <nav aria-label="Sections" className={`flex shrink-0 flex-col gap-1 border-r border-line p-2 ${open ? 'w-52' : 'w-14'}`}>
        <Link to="/mini" className="mb-3 flex items-center gap-2 rounded-control p-1.5 hover:bg-surface-2" title="Mini">
          <BotSprite sprite={profile?.sprite} accent={profile?.accent ?? '#d77757'} state={botState(mini?.phase)} size={28} label={profile?.name ?? 'Mini'} />
          {open && (
            <span className="min-w-0">
              <span className="block truncate text-body font-semibold">{profile?.name ?? 'Mini'}</span>
              <span className="block truncate text-micro text-ink-3">{mini?.running ? (mini.card ? 'Needs you, in the bot' : mini.detail || 'Resting') : 'Not running'}</span>
            </span>
          )}
        </Link>
        {SECTIONS.map(s => (
          <NavItem key={s.to} {...s} open={open} />
        ))}
        <div className="flex-1" />
        {LOWER.map(s => (
          <NavItem key={s.to} {...s} open={open} badge={s.to === '/permissions' ? state.data?.approvalsWaiting : undefined} />
        ))}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="mt-1 flex h-8 items-center gap-3 rounded-control px-2.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
          aria-label={open ? 'Collapse the side bar' : 'Expand the side bar'}
        >
          {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={TITLES[path] ?? (path.startsWith('/devices/') ? 'Devices' : 'Mini Hub')} />
        {state.data?.stopped && (
          <div role="status" className="flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-5 py-2 text-body">
            <span className="flex-1">Mini is stopped. Your data is still being collected.</span>
            <Button variant="primary" size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}>
              Resume
            </Button>
          </div>
        )}
        {state.error && (
          <div role="status" className="border-b border-line bg-surface px-5 py-2 text-small text-ink-2">
            {state.error.message}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <Outlet />
        </main>
      </div>
      <ApprovalCards />
    </div>
  )
}

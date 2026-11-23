import { createHashHistory, createRootRoute, createRoute, createRouter, useParams, useSearch } from '@tanstack/react-router'
import { Activity } from '../features/activity/Activity.tsx'
import { DevicePage } from '../features/devices/DevicePage.tsx'
import { Devices } from '../features/devices/Devices.tsx'
import { Frame } from '../features/frame/Frame.tsx'
import { Inbox } from '../features/inbox/Inbox.tsx'
import { LookBook } from '../features/look/LookBook.tsx'
import { Home } from '../features/home/Home.tsx'
import { MiniScreen } from '../features/mini/MiniScreen.tsx'
import { Permissions } from '../features/permissions/Permissions.tsx'
import { Settings } from '../features/settings/Settings.tsx'
import { Window } from '../components/look/index.ts'

const root = createRootRoute({ component: Frame })

function DeviceRoute() {
  const { id } = useParams({ strict: false }) as { id: string }
  const search = useSearch({ strict: false }) as { new?: unknown }
  return <DevicePage key={id} id={id} isNew={search.new !== undefined} />
}
const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: Home }),
  createRoute({ getParentRoute: () => root, path: '/mini', component: MiniScreen }),
  createRoute({ getParentRoute: () => root, path: '/inbox', component: Inbox }),
  createRoute({ getParentRoute: () => root, path: '/devices', component: Devices }),
  createRoute({ getParentRoute: () => root, path: '/devices/$id', component: DeviceRoute }),
  createRoute({ getParentRoute: () => root, path: '/activity', component: Activity }),
  createRoute({ getParentRoute: () => root, path: '/permissions', component: Permissions }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: Settings }),
  // Every part of the look, for checking by eye; only in the development view.
  ...(import.meta.env.DEV ? [createRoute({ getParentRoute: () => root, path: '/look', component: LookBook })] : []),
]

/** A screen that fails shows what went wrong and Retry, inside the frame; Stop and the rest stay usable. */
function ScreenError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <Window
      title="This screen hit a problem"
      state="error"
      error={`${error instanceof Error ? error.message : String(error)} — the rest of Mini Hub still works.`}
      onRetry={() => {
        reset()
        void router.invalidate()
      }}
    />
  )
}

// Hash routing: the app is a set of files inside the shell, with no server to answer other paths.
export const router = createRouter({ routeTree: root.addChildren(routes), history: createHashHistory(), defaultErrorComponent: ScreenError })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

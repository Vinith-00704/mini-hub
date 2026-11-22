import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Activity } from '../features/activity/Activity.tsx'
import { Frame } from '../features/frame/Frame.tsx'
import { Home } from '../features/home/Home.tsx'
import { MiniScreen } from '../features/mini/MiniScreen.tsx'
import { Permissions } from '../features/permissions/Permissions.tsx'
import { Settings } from '../features/settings/Settings.tsx'

const root = createRootRoute({ component: Frame })
const routes = [
  createRoute({ getParentRoute: () => root, path: '/', component: Home }),
  createRoute({ getParentRoute: () => root, path: '/mini', component: MiniScreen }),
  createRoute({ getParentRoute: () => root, path: '/activity', component: Activity }),
  createRoute({ getParentRoute: () => root, path: '/permissions', component: Permissions }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: Settings }),
]

// Hash routing: the app is a set of files inside the shell, with no server to answer other paths.
export const router = createRouter({ routeTree: root.addChildren(routes), history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

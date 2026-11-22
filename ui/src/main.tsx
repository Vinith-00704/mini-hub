import './design/tokens.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { readKeys } from './app/keys.ts'

// The key is taken out of the address before anything else runs, and before the router reads the address.
const keys = readKeys()
const root = createRoot(document.getElementById('root') as HTMLElement)

if (!keys) {
  root.render(
    <main className="grid h-full place-items-center p-8 text-center text-ink-2">
      <p>Mini Hub was opened without its key. Open it from the tray icon, or with the development launcher.</p>
    </main>,
  )
} else {
  const { router } = await import('./app/router.tsx')
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2_000 } } })
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

import './design/tokens.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { keysFromShell, readKeys } from './app/keys.ts'

const root = createRoot(document.getElementById('root') as HTMLElement)

const notice = (text: string) =>
  root.render(
    <main className="grid h-full place-items-center p-8 text-center text-ink-2">
      <p className="max-w-lg">{text}</p>
    </main>,
  )

// The key is taken out of the address (development) or from the desktop app before the router reads the address.
// The address only carries a key in development (tools/dev.mjs); the built dashboard takes it from the shell alone.
let keys = import.meta.env.DEV ? readKeys() : null
let failure: string | null = null
if (!keys) {
  try {
    keys = await keysFromShell()
  } catch (error) {
    failure = (error as Error).message
  }
}

if (failure) notice(`Mini Hub could not start. ${failure}`)
else if (!keys) notice('Mini Hub was opened without its key. Open it from the tray icon, or with the development launcher.')
else {
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

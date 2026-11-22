import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The dashboard loads nothing from the internet: fonts and icons are bundled, and the only server it talks to is
// the core on 127.0.0.1.
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
})

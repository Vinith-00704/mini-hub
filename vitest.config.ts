import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'protocol', include: ['protocol/test/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'core', include: ['core/test/**/*.test.ts'], environment: 'node', testTimeout: 20000, pool: 'forks' } },
      { extends: './ui/vite.config.ts', test: { name: 'ui', root: './ui', include: ['test/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./test/setup.ts'] } },
    ],
  },
})

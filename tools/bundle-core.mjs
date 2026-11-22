// Packs the hub core for shipping inside the desktop app: one bundled core.mjs, its migrations, the encrypted
// database module with only the Windows binary, and (unless --no-node) the node.exe that runs it.
//
// Usage: node tools/bundle-core.mjs <outDir> [--no-node]

import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [outArg, ...flags] = process.argv.slice(2)
if (!outArg) {
  process.stderr.write('Usage: node tools/bundle-core.mjs <outDir> [--no-node]\n')
  process.exit(1)
}
const out = resolve(outArg)
const DB = 'better-sqlite3-multiple-ciphers'

// The folder is emptied first, so only a folder under .build or the temp folder is accepted.
const inside = (child, parent) => (resolve(child).toLowerCase() + '\\').startsWith(resolve(parent).toLowerCase() + '\\')
if (!(inside(out, join(repo, '.build')) || inside(out, (await import('node:os')).tmpdir())) || out === resolve(repo, '.build')) {
  process.stderr.write('bundle-core only writes to a folder under .build or the temp folder.\n')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [join(repo, 'core', 'src', 'main.ts')],
  outfile: join(out, 'core.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: [DB],
  // Some dependencies are CommonJS and call require(); give the ES module bundle one.
  banner: { js: "import { createRequire as __hubRequire } from 'node:module'; const require = __hubRequire(import.meta.url);" },
  logLevel: 'error',
  legalComments: 'none',
})

cpSync(join(repo, 'core', 'src', 'store', 'migrations'), join(out, 'migrations'), { recursive: true })

const from = join(repo, 'node_modules', DB)
const to = join(out, 'node_modules', DB)
mkdirSync(join(to, 'prebuilds'), { recursive: true })
copyFileSync(join(from, 'package.json'), join(to, 'package.json'))
cpSync(join(from, 'lib'), join(to, 'lib'), { recursive: true })
copyFileSync(join(from, 'prebuilds', 'win32-x64.node'), join(to, 'prebuilds', 'win32-x64.node'))

if (!flags.includes('--no-node')) copyFileSync(process.execPath, join(out, 'node.exe'))

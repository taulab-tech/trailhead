// Test runner. better-sqlite3 is compiled against Electron's Node ABI (see the
// postinstall script), so tests run under Electron-as-Node rather than plain
// Node — otherwise the native module refuses to load.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')
const electronPath = require('electron')

const outdir = path.join(__dirname, '..', 'out', 'tests')
const entryPoints = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(__dirname, f))

buildSync({
  entryPoints,
  outdir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['better-sqlite3', 'electron', 'xlsx'],
  logLevel: 'warning'
})

let failed = false
for (const entry of entryPoints) {
  const compiled = path.join(outdir, path.basename(entry).replace(/\.ts$/, '.js'))
  const result = spawnSync(electronPath, [compiled], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (result.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)

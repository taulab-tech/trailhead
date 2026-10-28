// Prepares a private Python with `ddgs` for the Windows installer, so the
// LinkedIn position lookup works on machines without Python. Produces
// python-runtime/win/ (shipped via electron-builder's extraResources):
//   1. the official "embeddable" CPython for Windows from python.org
//   2. ddgs and its dependencies, installed as prebuilt win_amd64 wheels
// Needs Python with pip on the build machine (only to fetch the wheels).
// Re-running is a no-op once the runtime is in place.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const PYTHON_VERSION = '3.12.10'
const ROOT = path.join(__dirname, '..')
const RUNTIME = path.join(ROOT, 'python-runtime', 'win')
const SITE_PACKAGES = path.join(RUNTIME, 'Lib', 'site-packages')
const ZIP_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`

async function main() {
  if (fs.existsSync(path.join(RUNTIME, 'python.exe')) && fs.existsSync(path.join(SITE_PACKAGES, 'ddgs'))) {
    console.log('Bundled Python already prepared:', RUNTIME)
    return
  }
  fs.rmSync(RUNTIME, { recursive: true, force: true })
  fs.mkdirSync(RUNTIME, { recursive: true })

  console.log('Downloading', ZIP_URL)
  const res = await fetch(ZIP_URL)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const zipPath = path.join(ROOT, 'python-runtime', `python-${PYTHON_VERSION}-embed-amd64.zip`)
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
  // bsdtar (bundled with Windows 10+, and standard elsewhere) extracts zips.
  execFileSync('tar', ['-xf', zipPath, '-C', RUNTIME], { stdio: 'inherit' })
  fs.rmSync(zipPath)

  // The embeddable build ignores site-packages unless its ._pth file lists it.
  const pth = fs.readdirSync(RUNTIME).find((f) => /^python\d+\._pth$/.test(f))
  if (!pth) throw new Error('python*._pth not found in the embeddable package')
  const pthPath = path.join(RUNTIME, pth)
  const lines = fs.readFileSync(pthPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '#import site')
  fs.writeFileSync(pthPath, [...lines.filter(Boolean), 'Lib\\site-packages', 'import site', ''].join('\r\n'))

  console.log('Installing ddgs into the bundled Python')
  const [major, minor] = PYTHON_VERSION.split('.')
  const pipArgs = [
    '-m', 'pip', 'install', 'ddgs',
    '--target', SITE_PACKAGES,
    '--platform', 'win_amd64',
    '--python-version', `${major}.${minor}`,
    '--implementation', 'cp',
    '--only-binary=:all:',
    '--no-compile',
    '--disable-pip-version-check'
  ]
  const hosts = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const host of hosts) {
    try {
      execFileSync(host, pipArgs, { stdio: 'inherit' })
      console.log('Bundled Python ready:', RUNTIME)
      return
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
  throw new Error('Python with pip is needed on this computer to prepare the bundled runtime.')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})

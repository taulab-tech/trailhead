import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { MAX_RESULTS, SEARCH_TIMEOUT_MS, type RawResult } from './positionLookup'

/**
 * The desktop's way of searching: DuckDuckGo through the `ddgs` Python
 * package. The Windows installer ships its own Python with ddgs
 * (scripts/bundle-python.cjs); otherwise the system Python is used.
 *
 * This is the half of the lookup a web page cannot do — it starts a
 * process, and a page has none. The browser build supplies a different
 * transport; everything above this file is shared by both.
 */

// The query arrives as argv, never interpolated into the code.
const PY_SCRIPT = `
import json, sys
try:
    from ddgs import DDGS
except ImportError:
    print(json.dumps({"error": "missing_ddgs"}))
    sys.exit(0)
try:
    results = DDGS().text(sys.argv[1], max_results=int(sys.argv[2]))
except Exception as e:
    if "no results" in str(e).lower():
        results = []
    else:
        print(json.dumps({"error": str(e)}))
        sys.exit(0)
print(json.dumps([{"title": r.get("title", ""), "body": r.get("body", ""), "href": r.get("href", "")} for r in results or []]))
`

const SYSTEM_PYTHONS: [string, string[]][] =
  process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]]

/** The bundled runtime (installed app, or a prepared python-runtime/ in dev) first, then the system's. */
function pythonCommands(): [string, string[]][] {
  const bundled = [
    process.resourcesPath && path.join(process.resourcesPath, 'python', 'python.exe'),
    path.join(process.cwd(), 'python-runtime', 'win', 'python.exe')
  ].filter((p): p is string => !!p && process.platform === 'win32' && fs.existsSync(p))
  return [...bundled.map((p): [string, string[]] => [p, []]), ...SYSTEM_PYTHONS]
}

async function runDdgs(query: string): Promise<RawResult[]> {
  for (const [command, prefixArgs] of pythonCommands()) {
    let output: string
    try {
      output = await runPython(command, [...prefixArgs, '-c', PY_SCRIPT, query, String(MAX_RESULTS)])
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(output.trim().split('\n').pop() ?? '')
    } catch {
      // e.g. the Windows Store "python" stub when Python isn't installed.
      continue
    }
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const error = String((parsed as { error: unknown }).error)
      if (error === 'missing_ddgs') {
        throw new Error('The ddgs package isn’t installed. Run "pip install ddgs" in a terminal, then try again.')
      }
      throw new Error(`The search didn’t work (${error}). Wait a minute and try again.`)
    }
    return parsed as RawResult[]
  }
  throw new Error('Python wasn’t found. Install Python 3 and run "pip install ddgs", then try again.')
}

function runPython(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The search timed out. Check your internet connection and try again.'))
    }, SEARCH_TIMEOUT_MS)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(stdout || stderr)
    })
  })
}

export { runDdgs as pythonSearch }

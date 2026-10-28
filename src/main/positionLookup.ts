import { spawn } from 'child_process'
import type { PositionCandidate } from '../shared/types'

/**
 * Looks a student up on LinkedIn through a DuckDuckGo search, using the
 * `ddgs` Python package (`pip install ddgs`). This is the app's only network
 * feature: it runs once per click on a student, never in bulk, and searches
 * are spaced out so repeated clicks can't hammer the search engine.
 */

const MAX_RESULTS = 5
const MIN_SECONDS_BETWEEN_SEARCHES = 4
const SEARCH_TIMEOUT_MS = 25_000

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

const PYTHON_COMMANDS: [string, string[]][] =
  process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]]

interface RawResult {
  title: string
  body: string
  href: string
}

let lastSearchAt = 0
let queue: Promise<unknown> = Promise.resolve()

export function buildPositionQuery(firstName: string, lastName: string, extraTerms = ''): string {
  const name = `${firstName} ${lastName}`.replace(/"/g, '').replace(/\s+/g, ' ').trim()
  return `"${name}" site:linkedin.com/in ${extraTerms.replace(/"/g, '')}`.trim()
}

/** Searches one at a time, at least MIN_SECONDS_BETWEEN_SEARCHES apart. */
export function searchPositions(query: string): Promise<PositionCandidate[]> {
  const run = queue.then(async () => {
    const wait = lastSearchAt + MIN_SECONDS_BETWEEN_SEARCHES * 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      const raw = await runDdgs(query)
      return raw
        .filter((r) => /linkedin\.com\/in\//i.test(r.href))
        .map(parseLinkedInResult)
    } finally {
      lastSearchAt = Date.now()
    }
  })
  queue = run.catch(() => undefined)
  return run
}

async function runDdgs(query: string): Promise<RawResult[]> {
  for (const [command, prefixArgs] of PYTHON_COMMANDS) {
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

function field(body: string, label: string): string | null {
  const match = body.match(new RegExp(`${label}:\\s*([^·]+)`, 'i'))
  if (!match) return null
  // A field can run into the next sentence ("Location: Catonsville. View …").
  const value = match[1]
    .split(/\.\s/)[0]
    .replace(/\s*(\.\.\.|…)\s*$/, '')
    .replace(/\.$/, '')
    .trim()
  return value || null
}

/**
 * LinkedIn results look like
 *   title: "Nadia Oyelaran - Electrical Engineer at NORTHWIND | LinkedIn"
 *   body:  "Electrical Engineer at NORTHWIND · Experience: NORTHWIND · Education: … · Location: …"
 * When a profile has no headline, the title's second part is just the
 * location ("Catonsville, Maryland, United States"), which isn't a position.
 */
export function parseLinkedInResult(r: RawResult): PositionCandidate {
  const titleCore = r.title.replace(/\s*[|–-]\s*LinkedIn.*$/i, '').replace(/\s*\|.*$/, '')
  const dash = titleCore.indexOf(' - ')
  const name = (dash >= 0 ? titleCore.slice(0, dash) : titleCore).trim()
  let headline: string | null = dash >= 0 ? titleCore.slice(dash + 3).trim() || null : null

  const experience = field(r.body, 'Experience')
  const education = field(r.body, 'Education')
  const location = field(r.body, 'Location')
  if (headline && location && headline.toLowerCase().includes(location.toLowerCase())) headline = null

  return { name, headline, experience, education, location, url: r.href, snippet: r.body }
}

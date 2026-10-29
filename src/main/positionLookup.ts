import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { normalizeName } from './normalize'
import type { PositionCandidate, PositionSearchResult } from '../shared/types'

/**
 * Looks a student up on LinkedIn through a DuckDuckGo search, using the
 * `ddgs` Python package. The Windows installer ships its own Python with
 * ddgs (scripts/bundle-python.cjs); otherwise the system Python is used. This is the app's only network
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

interface RawResult {
  title: string
  body: string
  href: string
}

let lastSearchAt = 0
let queue: Promise<unknown> = Promise.resolve()

/**
 * `"First Last" site:linkedin.com/in` plus any narrowing words. Words that
 * just repeat the name are dropped — the name is already searched exactly.
 */
export function buildPositionQuery(firstName: string, lastName: string, extraTerms = ''): string {
  const name = `${firstName} ${lastName}`.replace(/"/g, '').replace(/\s+/g, ' ').trim()
  const nameWords = new Set(name.toLowerCase().split(' '))
  const extra = extraTerms
    .replace(/"/g, '')
    .split(/\s+/)
    .filter((w) => w && !nameWords.has(w.toLowerCase()))
    .join(' ')
  return `"${name}" site:linkedin.com/in ${extra}`.trim()
}

/** A LinkedIn profile result — by its link, or by a "… | LinkedIn" title when the link is a redirect. */
export function isLinkedInProfile(r: RawResult): boolean {
  return /linkedin\.com\/(in|pub)\//i.test(r.href) || /\|\s*LinkedIn\b/i.test(r.title)
}

/**
 * Looks the student up; if narrowing words leave nothing, tries once more
 * with the name alone and says so.
 */
export async function lookUpPosition(
  firstName: string,
  lastName: string,
  extraTerms = '',
  institutionNames: string[] = []
): Promise<PositionSearchResult> {
  const onlyThisPerson = (r: PositionSearchResult): PositionSearchResult => {
    const kept = r.candidates.filter((c) => nameMatches(c.name, firstName, lastName))
    return { ...r, candidates: kept, otherNamesHidden: r.candidates.length - kept.length }
  }
  const query = buildPositionQuery(firstName, lastName, extraTerms)
  let result = onlyThisPerson(await searchPositions(query))
  const plainQuery = buildPositionQuery(firstName, lastName)
  if (result.candidates.length === 0 && query !== plainQuery) {
    result = { ...onlyThisPerson(await searchPositions(plainQuery)), broadenedFrom: query }
  }
  return { ...result, candidates: rankByInstitution(result.candidates, institutionNames) }
}

/**
 * Marks profiles that mention the configured institution (in their education,
 * or anywhere in the result) and lists them first. Others stay in the list —
 * a result only shows part of a profile, so a missing mention proves nothing.
 */
export function rankByInstitution(candidates: PositionCandidate[], institutionNames: string[]): PositionCandidate[] {
  const names = institutionNames.map((n) => n.toLowerCase()).filter(Boolean)
  const marked = candidates.map((c) => {
    const inEducation = names.find((n) => c.education?.toLowerCase().includes(n))
    const anywhere = inEducation ?? names.find((n) => c.snippet.toLowerCase().includes(n))
    const match = anywhere ? institutionNames.find((n) => n.toLowerCase() === anywhere) ?? null : null
    return { ...c, institutionMatch: match, rank: inEducation ? 0 : anywhere ? 1 : 2 }
  })
  return marked.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...c }) => c)
}

/** Searches one at a time, at least MIN_SECONDS_BETWEEN_SEARCHES apart. */
function searchPositions(query: string): Promise<PositionSearchResult> {
  const run = queue.then(async () => {
    const wait = lastSearchAt + MIN_SECONDS_BETWEEN_SEARCHES * 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      const raw = await runDdgs(query)
      return {
        query,
        resultCount: raw.length,
        candidates: raw.filter(isLinkedInProfile).map(parseLinkedInResult),
        broadenedFrom: null,
        otherNamesHidden: 0
      }
    } finally {
      lastSearchAt = Date.now()
    }
  })
  queue = run.catch(() => undefined)
  return run
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
  let headline: string | null = dash >= 0 ? ownPart(titleCore.slice(dash + 3)).trim() || null : null

  // Only this person's part of the text — see ownPart.
  const body = ownPart(r.body)
  const experience = field(body, 'Experience')
  const education = field(body, 'Education')
  const location = field(body, 'Location')

  // The title's second part is sometimes just the location or an
  // organisation ("Dylan Haussecker - University of Saskatchewan"), not a job title.
  const same = (a: string | null, b: string | null): boolean =>
    !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (
    headline &&
    ((location && headline.toLowerCase().includes(location.toLowerCase())) ||
      same(headline, experience) ||
      same(headline, education))
  ) {
    headline = null
  }

  // LinkedIn snippets usually open with the profile headline before the
  // labelled fields: "Co-Founder and CTO @ KeenSite · Experience: … · Education: …".
  if (!headline) headline = leadingHeadline(body, [experience, education, location])

  return { name, headline, experience, education, location, url: r.href, snippet: body, institutionMatch: null }
}

/**
 * Some results come from LinkedIn pages that list several people, so their
 * text runs on into other profiles: "Firmware Developer II at Bourgault
 * Industries ...McKenzie Maduke - Resource Management Officer at Parks
 * Canada ...Cheryl Brown - Payroll ...". Everything from the first such
 * "...Firstname Lastname - " onward is someone else and is cut off.
 */
export function ownPart(text: string): string {
  const other = text.match(/\s*(?:\.\.\.|…)\s*\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3}\s+[-–]\s+/u)
  return other ? text.slice(0, other.index) : text
}

/**
 * Whether a result is the searched person by name: both the first and last
 * name appear, in either order, with a first name allowed to be a short form
 * of the other ("Chris" ↔ "Christopher"). Search engines don't always honour
 * the quoted name and return unrelated people.
 */
export function nameMatches(candidateName: string, firstName: string, lastName: string): boolean {
  const words = (s: string): string[] => normalizeName(s).split(' ').filter(Boolean)
  const have = words(candidateName)
  const last = words(lastName)
  const first = words(firstName)[0]
  if (last.length === 0 || !last.every((w) => have.includes(w))) return false
  if (!first) return true
  return have.some(
    (w) => w === first || (Math.min(w.length, first.length) >= 3 && (w.startsWith(first) || first.startsWith(w)))
  )
}

/** The snippet's first "·" segment, when it reads like a headline rather than a field, bio or boilerplate. */
function leadingHeadline(body: string, knownValues: (string | null)[]): string | null {
  const first = body.split(' · ')[0]?.trim() ?? ''
  if (!first || first.length > 100) return null
  if (/^[A-Za-z ]{3,20}:/.test(first)) return null // "Education: …"
  if (/\.\s/.test(first) || /^(hi|hello|i am|i'm|view)\b/i.test(first)) return null // a sentence, not a headline
  if (/linkedin/i.test(first)) return null
  if (knownValues.some((v) => v && v.toLowerCase() === first.toLowerCase())) return null
  return first.replace(/\s*(\.\.\.|…)$/, '')
}

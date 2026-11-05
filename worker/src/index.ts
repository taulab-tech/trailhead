/**
 * The search half of the LinkedIn lookup, for the web app.
 *
 * A browser tab can't call a search engine: the engine would have to send
 * it an `Access-Control-Allow-Origin` header and none do. A desktop process
 * has no such limit, which is why the desktop build does this with a
 * bundled Python instead. This Worker is the smallest thing that closes
 * that gap.
 *
 * What it receives is a search query — a student's name, and any extra
 * words the user typed — and only when somebody presses "Look up". It never
 * sees the database, an email address, a grade or anything else. It keeps
 * no record: nothing is written down, nothing is logged, and it holds no
 * storage of any kind.
 *
 * Deploy with `npx wrangler deploy`, then paste the URL into the app's
 * Settings. Until a URL is set, the web app simply has no lookup.
 */

export interface Env {
  /**
   * Comma-separated origins allowed to call this. Set it, or the Worker
   * answers nobody — an open search proxy is somebody else's problem
   * waiting to happen.
   */
  ALLOWED_ORIGINS?: string
  /**
   * A Brave Search API key (`wrangler secret put BRAVE_API_KEY`). Strongly
   * preferred, and the only arrangement that keeps working.
   *
   * Without it the Worker falls back to reading DuckDuckGo's no-JavaScript
   * results page, which is scraping, and search engines rightly push back
   * on it. They are far harsher on a datacentre address than on somebody's
   * home connection, so where the desktop app got away with this from the
   * user's own machine, a Worker gets a CAPTCHA quickly and then keeps
   * getting one. The fallback is there so the thing runs at all before a
   * key is set up; it is not something to rely on.
   *
   * The key lives here as a secret and never reaches the browser.
   */
  BRAVE_API_KEY?: string
}

const MAX_RESULTS = 5
const UPSTREAM_TIMEOUT_MS = 20_000
/** Long enough that a stuck key can't hammer the engine; short enough to be invisible. */
const MIN_MS_BETWEEN_SEARCHES = 2_000

interface RawResult {
  title: string
  body: string
  href: string
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    Vary: 'Origin'
  }
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return headers
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
}

/** Brave's Search API: an actual API, with terms, that answers reliably. */
async function braveSearch(query: string, key: string): Promise<RawResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(MAX_RESULTS))

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  })
  if (response.status === 429) throw new SearchError('Search quota reached. Try again later.', 429)
  if (response.status === 401 || response.status === 403) {
    throw new SearchError('The search API key was refused. Check it in the Worker settings.', 502)
  }
  if (!response.ok) throw new SearchError(`The search didn’t work (${response.status}).`, 502)

  const body = (await response.json()) as { web?: { results?: { title?: string; description?: string; url?: string }[] } }
  return (body.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: stripTags(r.title ?? ''),
      body: stripTags(r.description ?? ''),
      href: r.url as string
    }))
}

class SearchError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** The page DuckDuckGo serves when it thinks it is talking to a bot. */
function isChallenge(html: string): boolean {
  return html.includes('anomaly-modal') || html.includes('confirm this search was made by a human')
}

/**
 * Reads DuckDuckGo's no-JavaScript results page.
 *
 * Parsing HTML, not calling an API, so it breaks whenever the markup moves
 * and gets challenged whenever they decide this looks automated. Kept only
 * as something that works before a Brave key is set up.
 */
function parseResults(html: string): RawResult[] {
  const results: RawResult[] = []
  const blocks = html.split('<div class="result')

  for (const block of blocks.slice(1)) {
    const link = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)

    const href = decodeRedirect(decodeEntities(link[1]))
    if (!href) continue

    results.push({
      title: stripTags(link[2]),
      body: snippet ? stripTags(snippet[1]) : '',
      href
    })
    if (results.length >= MAX_RESULTS) break
  }
  return results
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** Results come back wrapped in `//duckduckgo.com/l/?uddg=<real url>`. */
function decodeRedirect(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/)
  const url = match ? decodeURIComponent(match[1]) : href
  const absolute = url.startsWith('//') ? `https:${url}` : url
  return /^https?:\/\//i.test(absolute) ? absolute : ''
}

/** One search at a time per caller, so a stuck client can't flood the engine. */
const lastSearchAt = new Map<string, number>()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const headers = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405, headers)

    // No allowed origin matched, so no browser would accept the answer
    // anyway. Say so plainly rather than searching for nothing.
    if (!headers['Access-Control-Allow-Origin']) {
      return json({ error: 'This search proxy is not open to that site.' }, 403, headers)
    }

    const query = new URL(request.url).searchParams.get('q')?.trim()
    if (!query) return json({ error: 'Nothing to search for.' }, 400, headers)
    if (query.length > 200) return json({ error: 'That search is too long.' }, 400, headers)

    const caller = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const since = Date.now() - (lastSearchAt.get(caller) ?? 0)
    if (since < MIN_MS_BETWEEN_SEARCHES) {
      return json({ error: 'Searching too quickly. Wait a moment and try again.' }, 429, headers)
    }
    lastSearchAt.set(caller, Date.now())

    // An API with terms where there is a key for one; scraping only as a
    // stopgap before one is set up.
    if (env.BRAVE_API_KEY) {
      try {
        return json({ results: await braveSearch(query, env.BRAVE_API_KEY) }, 200, headers)
      } catch (err) {
        const status = err instanceof SearchError ? err.status : 502
        return json({ error: err instanceof Error ? err.message : String(err) }, status, headers)
      }
    }

    const upstream = new URL('https://html.duckduckgo.com/html/')
    upstream.searchParams.set('q', query)

    let response: Response
    try {
      response = await fetch(upstream, {
        headers: {
          // The no-JS endpoint serves a different page to an obvious bot.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'en-CA,en;q=0.9'
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      })
    } catch {
      return json({ error: 'The search timed out. Try again in a moment.' }, 504, headers)
    }

    if (response.status === 429 || response.status === 403) {
      return json({ error: 'The search engine is refusing searches. Try again later.' }, 429, headers)
    }
    if (!response.ok) {
      return json({ error: `The search didn’t work (${response.status}).` }, 502, headers)
    }

    const html = await response.text()
    if (isChallenge(html)) {
      return json(
        {
          error:
            'The search engine is asking for a CAPTCHA, which it does to anything automated. Add a Brave Search API key to the lookup Worker to search reliably.'
        },
        429,
        headers
      )
    }
    return json({ results: parseResults(html) }, 200, headers)
  }
}

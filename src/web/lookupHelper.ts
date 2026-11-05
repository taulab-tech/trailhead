import type { RawResult } from '../main/positionLookup'

/**
 * Reaching the lookup helper running on the user's own computer.
 *
 * A page can't call a search engine — the engine would have to let it read
 * the reply, and none do. So the search runs in a small Python program on
 * the same machine (see `lookup-helper/`) and the page asks that. The
 * search then leaves from the user's own connection, which is the whole
 * reason it works: search engines are far harsher on a datacentre address
 * than on somebody's home or office one.
 *
 * `http://127.0.0.1` is reachable from an https page without being treated
 * as mixed content, because browsers count localhost as trustworthy.
 */

const TIMEOUT_MS = 30_000

/** Where the helper listens unless somebody has moved it. */
export const DEFAULT_HELPER_URL = 'http://127.0.0.1:8765'

interface HelperReply {
  results?: RawResult[]
  error?: string
}

async function ask(baseUrl: string, path: string, signal?: AbortSignal): Promise<HelperReply> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS)
  })
  const body = (await response.json().catch(() => ({}))) as HelperReply
  if (!response.ok) throw new Error(body.error ?? `The helper answered ${response.status}.`)
  return body
}

/** True if the helper is running and answering. */
export async function helperIsRunning(baseUrl: string): Promise<boolean> {
  try {
    await ask(baseUrl, '/health', AbortSignal.timeout(2_500))
    return true
  } catch {
    return false
  }
}

/** The search transport the web build uses when a helper address is set. */
export function helperSearch(baseUrl: string) {
  return async (query: string): Promise<RawResult[]> => {
    let reply: HelperReply
    try {
      reply = await ask(baseUrl, `/search?q=${encodeURIComponent(query)}`)
    } catch (err) {
      // Far and away the usual cause: the helper isn't running.
      const message = err instanceof Error ? err.message : String(err)
      if (/fetch|network|abort|timeout/i.test(message)) {
        throw new Error(
          `Couldn’t reach the lookup helper at ${baseUrl}. Start it on this computer, or clear the address in Settings to search in a tab instead.`
        )
      }
      throw err
    }
    return reply.results ?? []
  }
}

/**
 * Finds the helper without anybody having to set it up.
 *
 * If it is running where it normally runs, the app should just use it —
 * making someone paste an address into Settings to enable something that
 * is already listening is a step for no reason. The setting is still there
 * for a helper on a different port.
 */
export async function detectHelper(configured: string | null): Promise<string | null> {
  const candidates = configured ? [configured] : [DEFAULT_HELPER_URL]
  for (const url of candidates) {
    if (await helperIsRunning(url)) return url
  }
  return null
}

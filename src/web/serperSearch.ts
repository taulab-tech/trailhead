import { SEARCH_TIMEOUT_MS, type RawResult } from '../main/positionLookup'

/**
 * Looking somebody up without installing anything.
 *
 * A search engine's own site will not let a page read its reply, which is
 * why this used to need a small Python program running alongside the app.
 * On a university computer you cannot install Python, so for the people
 * this app is for that was the same as having no lookup at all.
 *
 * A search *API* is a different thing: it answers browsers on purpose.
 * Serper returns Google results as JSON and sends
 * `Access-Control-Allow-Origin: *`, so the page can ask it directly — no
 * helper, no server of ours, nothing to install. One free key, pasted in
 * once, and the lookup works on any machine that can reach the internet.
 *
 * ## What leaves the computer
 *
 * The student's name, and nothing else. That was already true the moment
 * somebody pressed the search button: it opened a DuckDuckGo tab with the
 * name in the URL. This sends the same name to the same kind of service
 * and reads the answer back, instead of leaving a person to read it and
 * copy it across. No other field on the record is sent, ever, and the key
 * is held in the database file on the user's own machine.
 */

const ENDPOINT = 'https://google.serper.dev/search'

/** Serper's shape, narrowed to the three fields a candidate is built from. */
interface SerperReply {
  organic?: { title?: string; snippet?: string; link?: string }[]
  message?: string
}

/** True for something that looks like a Serper key rather than a typo. */
export function looksLikeSerperKey(key: string): boolean {
  return /^[a-f0-9]{32,}$/i.test(key.trim())
}

/**
 * A search transport backed by Serper. Errors are phrased for somebody who
 * has no idea what an API is, because that is who will read them.
 */
export function serperSearch(apiKey: string) {
  return async (query: string): Promise<RawResult[]> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey.trim() },
        body: JSON.stringify({ q: query, num: 10 }),
        signal: controller.signal
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/abort/i.test(message)) throw new Error('The search took too long. Try again.')
      throw new Error('Could not reach the search service. Check the internet connection.')
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('That search key was not accepted. Check it in Settings.')
    }
    if (response.status === 429) {
      throw new Error('The free monthly searches have run out. The search button still works.')
    }
    if (!response.ok) {
      throw new Error(`The search service answered ${response.status}. Try again in a moment.`)
    }

    const reply = (await response.json()) as SerperReply
    return (reply.organic ?? [])
      .filter((r) => r.link)
      .map((r) => ({ title: r.title ?? '', body: r.snippet ?? '', href: r.link as string }))
  }
}

/** Asks for one cheap result, to tell a working key from a wrong one. */
export async function serperKeyWorks(apiKey: string): Promise<boolean> {
  try {
    await serperSearch(apiKey)('site:linkedin.com/in')
    return true
  } catch {
    return false
  }
}

import { getDb } from './index'

export interface AppSettings {
  /** The institution's names as people write them ("University of Saskatchewan", "USask"). */
  institutionNames: string[]
  /**
   * Where the local lookup helper is listening, if it is being used.
   *
   * A web page can't search for somebody — a search engine won't let a
   * page read its reply — so the search runs in a small Python program on
   * the user's own computer and the app asks it. Empty means no automatic
   * lookup, and the app offers to open the search in a tab instead.
   */
  lookupHelperUrl: string | null
  /**
   * A Serper key, if one has been pasted in. It lets the app read search
   * results itself instead of opening a tab for somebody to read — which
   * is the only way the lookup works on a computer you cannot install
   * anything on. Held in this database file and sent to nobody but the
   * search service it authenticates against.
   */
  searchApiKey: string | null
}

const INSTITUTION_KEY = 'institution_names'
const HELPER_KEY = 'lookup_helper_url'
const SEARCH_KEY = 'search_api_key'

function read(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

export function getSettings(): AppSettings {
  const names = read(INSTITUTION_KEY)
  return {
    institutionNames: names ? (JSON.parse(names) as string[]) : [],
    lookupHelperUrl: read(HELPER_KEY),
    searchApiKey: read(SEARCH_KEY)
  }
}

/**
 * Saves where the lookup helper is listening. Only a plain http address on
 * this computer is accepted: the point of the helper is that the search
 * leaves from the user's own connection, and pointing it at somebody
 * else's server would quietly undo that.
 */
export function setLookupHelperUrl(url: string | null): string | null {
  const db = getDb()
  const trimmed = (url ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(HELPER_KEY)
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('That is not a web address.')
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('The helper has to be running on this computer, so the address must be localhost.')
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(HELPER_KEY, trimmed)
  return trimmed
}

/** Saves the institution's names; blanks and duplicates are dropped, and an empty list clears it. */
export function setInstitutionNames(names: string[]): string[] {
  const seen = new Set<string>()
  const clean = names
    .map((n) => n.trim().replace(/\s+/g, ' '))
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
  const db = getDb()
  if (clean.length > 0) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(INSTITUTION_KEY, JSON.stringify(clean))
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(INSTITUTION_KEY)
  }
  return clean
}

/** Saves the search key, or clears it when given nothing. */
export function setSearchApiKey(key: string | null): string | null {
  const db = getDb()
  const trimmed = (key ?? '').trim()
  if (!trimmed) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(SEARCH_KEY)
    return null
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(SEARCH_KEY, trimmed)
  return trimmed
}

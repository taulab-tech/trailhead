import { getDb } from './index'

export interface AppSettings {
  /** The institution's names as people write them ("University of Saskatchewan", "USask"). */
  institutionNames: string[]
}

const INSTITUTION_KEY = 'institution_names'

export function getSettings(): AppSettings {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(INSTITUTION_KEY) as
    | { value: string }
    | undefined
  return { institutionNames: row ? (JSON.parse(row.value) as string[]) : [] }
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

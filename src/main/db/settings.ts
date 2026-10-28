import { getDb, readSchoolEmailDomain, renormalizeNsids } from './index'

export interface AppSettings {
  schoolEmailDomain: string | null
}

export function getSettings(): AppSettings {
  return { schoolEmailDomain: readSchoolEmailDomain(getDb()) }
}

export function getSchoolEmailDomain(): string | null {
  return readSchoolEmailDomain(getDb())
}

/**
 * Sets (or with an empty value, clears) the school email domain, then
 * re-normalizes stored student IDs so ones saved as "abc123@school.edu"
 * immediately match bare "abc123" rows.
 */
export function setSchoolEmailDomain(raw: string | null): string | null {
  const domain = (raw ?? '').trim().toLowerCase().replace(/^@/, '') || null
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    throw new Error('Enter a domain like "school.edu" — no spaces or @ sign.')
  }
  const db = getDb()
  if (domain) {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('school_email_domain', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(domain)
  } else {
    db.prepare("DELETE FROM settings WHERE key = 'school_email_domain'").run()
  }
  renormalizeNsids(db)
  return domain
}

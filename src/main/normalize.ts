export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return null
  return trimmed
}

/** Values people type into an ID column when there isn't one — never a real student ID. */
const NSID_PLACEHOLDERS = new Set(['n/a', 'na', 'none', 'null', 'unknown', 'tbd', '-', '--', '?', '0'])

/** Student IDs are stored as written (lowercased), minus placeholder values. */
export function normalizeNsid(nsid: string | null | undefined): string | null {
  if (!nsid) return null
  const trimmed = nsid.trim().toLowerCase()
  if (!trimmed || NSID_PLACEHOLDERS.has(trimmed)) return null
  return trimmed
}

/**
 * Rosters often write the same student ID both bare ("abc123") and as an
 * email ("abc123@school.edu"); this is the part before the "@" that the two
 * forms share. Plain IDs are returned unchanged.
 */
export function idLocalPart(id: string): string {
  const at = id.indexOf('@')
  return at > 0 ? id.slice(0, at) : id
}

export function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function titleCase(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split('-')
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join('-')
    )
    .join(' ')
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 7 ? digits : null
}

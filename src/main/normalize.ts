export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return null
  return trimmed
}

/** Values people type into an ID column when there isn't one — never a real student ID. */
const NSID_PLACEHOLDERS = new Set(['n/a', 'na', 'none', 'null', 'unknown', 'tbd', '-', '--', '?', '0'])

/**
 * Rosters often record the same student ID both bare ("abc123") and as the
 * school email ("abc123@school.edu"). When the school's email domain is
 * configured, it (and any subdomain) is stripped so the two forms match;
 * other domains are left alone so "john@gmail.com" never becomes "john".
 */
export function normalizeNsid(
  nsid: string | null | undefined,
  schoolEmailDomain: string | null = null
): string | null {
  if (!nsid) return null
  let trimmed = nsid.trim().toLowerCase()
  if (schoolEmailDomain) {
    const escaped = schoolEmailDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    trimmed = trimmed.replace(new RegExp(`@([a-z0-9-]+\\.)*${escaped}$`), '')
  }
  if (!trimmed || NSID_PLACEHOLDERS.has(trimmed)) return null
  return trimmed
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

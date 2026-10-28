export type EnrolTerm = 'fall' | 'winter'

const CURRENT_YEAR = new Date().getFullYear()

/** Extracts a plausible 4-digit enrol year from free text like "2024" or "Fall 2024 Cohort". */
export function parseEnrolYear(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/\b(19|20)\d{2}\b/)
  if (!match) return null
  const year = Number(match[0])
  return year >= 1990 && year <= CURRENT_YEAR + 1 ? year : null
}

/** Detects an explicit Fall/Winter term marker in free text (e.g. "Fall 2024", "F24", "24W"). */
export function parseEnrolTerm(raw: string | null | undefined): EnrolTerm | null {
  if (!raw) return null
  const text = raw.trim()
  if (/\bfall\b/i.test(text)) return 'fall'
  if (/\bwinter\b/i.test(text)) return 'winter'
  if (/\bf['\s]?\d{2,4}\b|\b\d{2,4}\s?f\b/i.test(text)) return 'fall'
  if (/\bw['\s]?\d{2,4}\b|\b\d{2,4}\s?w\b/i.test(text)) return 'winter'
  return null
}

export function enrolDateFor(year: number, term: EnrolTerm): string {
  return term === 'fall' ? `${year}-09-01` : `${year}-01-01`
}

/**
 * Registrar-style exports are often stamped with a bare YYYYMM instead of
 * spelling out a term (e.g. "202209_87599_classlist GE 490.xls" was pulled in
 * September 2022). September–December belongs to that year's Fall term;
 * January–April belongs to that year's Winter term. May–August (summer) has
 * no equivalent in this app's two-term model, so it's left unmatched.
 */
export function parseYearMonthStamp(
  raw: string | null | undefined
): { year: number; term: EnrolTerm } | null {
  if (!raw) return null
  // Digit-specific lookaround, not \b — underscore counts as a word
  // character in JS regex, so "202209_87599" wouldn't have a \b boundary
  // between the stamp and the following "_" even though it should match.
  const match = raw.match(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(?!\d)/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1990 || year > CURRENT_YEAR + 1) return null
  if (month >= 9) return { year, term: 'fall' }
  if (month <= 4) return { year, term: 'winter' }
  return null
}

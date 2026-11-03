import type { YearEstimate, YearObservation } from '../shared/types'

/**
 * What year a student is in *now*, worked out from what was recorded *then*.
 *
 * Nothing in the data says this directly. A class list from Fall 2024 says
 * someone was in fourth year; two years later they are not. So the most
 * recent observation is taken and the academic years since are added on.
 *
 * It is deliberately computed on every read and never stored. Stored, it
 * would be wrong from the first of September and nobody would notice.
 */

/** Beyond this, someone has almost certainly finished. */
const LONGEST_PROGRAMME = 5

const WORD_YEARS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6
}

/** True for an answer that means "graduate student", not a year of study. */
function looksLikeGraduate(text: string): boolean {
  return /\b(phd|ph\.d|masters?|m\.sc|msc|meng|m\.eng|doctorate|graduate)\b/i.test(text)
}

/**
 * Reads a year of study out of however it was written: "Fourth Year" on a
 * registrar export, "4th year" on an event form, sometimes a bare number.
 *
 * Multi-select event answers arrive joined with "|" ("1st year | 3rd year").
 * Those are somebody ticking several boxes, and there is no way to tell
 * which they meant, so they are treated as no answer rather than a guess.
 */
export function parseYearOfStudy(raw: string | null | undefined): number | 'graduate' | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  const found = new Set<number>()
  for (const match of text.matchAll(/\b(first|second|third|fourth|fifth|sixth)\b/gi)) {
    found.add(WORD_YEARS[match[1].toLowerCase()])
  }
  for (const match of text.matchAll(/\b([1-6])\s*(?:st|nd|rd|th)?\s*year\b/gi)) {
    found.add(Number(match[1]))
  }
  // A bare "3" in a column of years.
  if (found.size === 0 && /^[1-6]$/.test(text)) found.add(Number(text))

  if (found.size > 1) return null // ambiguous; better to say nothing
  if (found.size === 1) return [...found][0]

  return looksLikeGraduate(text) ? 'graduate' : null
}

/**
 * The academic year a date falls in. September to April is one academic
 * year, named for the September: Winter 2026 belongs to 2025-26, so both
 * Fall 2025 and Winter 2026 answer 2025.
 */
export function academicYearOf(year: number, month: number): number {
  return month >= 9 ? year : year - 1
}

/** "202509" → the 2025-26 academic year, labelled "Fall 2025". */
export function readTermStamp(term: string | null | undefined): { academicYear: number; label: string } | null {
  if (!term) return null
  const match = term.match(/^(\d{4})(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const season = month >= 9 ? 'Fall' : month <= 4 ? 'Winter' : 'Spring/Summer'
  return { academicYear: academicYearOf(year, month), label: `${season} ${year}` }
}

/** An ISO date from an event, as an academic year. */
export function readEventDate(date: string | null | undefined): { academicYear: number; label: string } | null {
  if (!date) return null
  const match = date.match(/^(\d{4})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const season = month >= 9 ? 'Fall' : month <= 4 ? 'Winter' : 'Spring/Summer'
  return { academicYear: academicYearOf(year, month), label: `${season} ${year}` }
}

const UNKNOWN: YearEstimate = {
  kind: 'unknown',
  year: null,
  label: 'Unknown',
  ordinal: 8,
  basis: null,
  current: false
}

/**
 * Picks the observation to reason from: the most recent one, and where two
 * share an academic year, the registrar's over a self-reported form answer.
 */
function bestObservation(observations: YearObservation[]): YearObservation | null {
  let best: YearObservation | null = null
  for (const observation of observations) {
    if (parseYearOfStudy(observation.raw) === null) continue
    if (!best) {
      best = observation
      continue
    }
    if (observation.academicYear > best.academicYear) best = observation
    else if (
      observation.academicYear === best.academicYear &&
      observation.source === 'classlist' &&
      best.source !== 'classlist'
    ) {
      best = observation
    }
  }
  return best
}

/**
 * `today` is a parameter so the arithmetic can be tested without waiting for
 * September.
 */
export function estimateYearInProgram(
  observations: YearObservation[],
  today: Date = new Date()
): YearEstimate {
  const observation = bestObservation(observations)
  if (!observation) return UNKNOWN

  const parsed = parseYearOfStudy(observation.raw)
  if (parsed === null) return UNKNOWN

  const dated = observation.dated !== false
  const basis = `${observation.raw.trim()}, ${observation.when}`

  if (parsed === 'graduate') {
    return { kind: 'graduate', year: null, label: 'Graduate student', ordinal: 6, basis, current: dated }
  }

  const currentAcademicYear = academicYearOf(today.getFullYear(), today.getMonth() + 1)
  const elapsed = Math.max(0, currentAcademicYear - observation.academicYear)
  const estimated = parsed + elapsed

  if (estimated > LONGEST_PROGRAMME) {
    return { kind: 'likely_graduated', year: null, label: 'Likely graduated', ordinal: 7, basis, current: false }
  }

  return {
    kind: 'year',
    year: estimated,
    label: `Year ${estimated}`,
    ordinal: estimated,
    basis,
    // No inference was needed, so this is what the record actually says. An
    // undated value is never "current": it may have been true years ago.
    current: dated && elapsed === 0
  }
}

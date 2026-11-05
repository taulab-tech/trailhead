import type {
  CertificateProgress,
  ReachOutReason,
  ReachOutSuggestion,
  Student
} from '../shared/types'

/**
 * Who is worth contacting right now.
 *
 * Three questions the data can actually answer, not a ranking of people.
 * Each suggestion says which rule produced it and the number behind it, so
 * it can be argued with — a list that only says "reach out to these" is
 * one nobody can check.
 *
 * Nobody who has finished is ever suggested: the point is who is still in
 * the programme and worth a word.
 */

/** Within this many credit units, a nudge is likely to be what finishes it. */
export const CLOSE_UNITS = 6

/** Longer than this without a sign of them and they are drifting. */
export const QUIET_MONTHS = 12

/**
 * Past this, they are not drifting, they are gone. Somebody last seen six
 * years ago with a tenth of a certificate behind them is not a prospect,
 * and listing them only buries the people who are.
 */
export const GONE_MONTHS = 36

/** A student, with everything the rules need to judge them. */
export interface ReachOutInput {
  student: Student
  certificates: CertificateProgress[]
  /** The most recent event or course term on their record, as an ISO date. */
  lastSeen: string | null
}

function monthsSince(date: string | null, today: Date): number | null {
  if (!date) return null
  const then = new Date(date)
  if (Number.isNaN(then.getTime())) return null
  return (today.getFullYear() - then.getFullYear()) * 12 + (today.getMonth() - then.getMonth())
}

function units(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** The certificate they are furthest through, ignoring ones not started. */
function furthestAlong(certificates: CertificateProgress[]): CertificateProgress | null {
  const started = certificates.filter((c) => c.earnedUnits > 0 && !c.complete)
  if (started.length === 0) return null
  return started.reduce((best, c) => (c.earnedUnits > best.earnedUnits ? c : best))
}

/**
 * Works out whether a student is worth contacting, and why. Returns null
 * for most people, which is the point — a list of everybody is no help.
 */
export function suggestionFor(input: ReachOutInput, today: Date = new Date()): ReachOutSuggestion | null {
  const { student, certificates, lastSeen } = input

  // Somebody who has finished isn't a prospect, whatever their progress.
  if (student.isAlumni || student.currentYear.kind === 'likely_graduated') return null

  const certificate = furthestAlong(certificates)
  if (!certificate) return null

  const remaining = Math.max(0, certificate.totalUnits - certificate.earnedUnits)
  const quiet = monthsSince(lastSeen, today)

  const base = {
    studentId: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    certificateName: certificate.name,
    unitsRemaining: remaining,
    percent: certificate.percent,
    lastSeen,
    monthsQuiet: quiet
  }

  // Closest to the finish line first: the nudge most likely to land.
  if (remaining > 0 && remaining <= CLOSE_UNITS) {
    return {
      ...base,
      reason: 'close_to_finishing' as ReachOutReason,
      detail: `${units(remaining)} CU from finishing ${certificate.name}`
    }
  }

  // In their last year with a certificate unfinished — after this they are
  // gone and it stays unfinished.
  if (student.currentYear.year !== null && student.currentYear.year >= 4) {
    return {
      ...base,
      reason: 'final_year' as ReachOutReason,
      detail: `In their last year, ${units(remaining)} CU short of ${certificate.name}`
    }
  }

  // Started something and then stopped turning up.
  if (quiet !== null && quiet >= QUIET_MONTHS && quiet <= GONE_MONTHS) {
    return {
      ...base,
      reason: 'drifting' as ReachOutReason,
      detail: `${certificate.percent}% through ${certificate.name}, not seen in ${quiet} months`
    }
  }

  return null
}

const ORDER: Record<ReachOutReason, number> = {
  close_to_finishing: 0,
  final_year: 1,
  drifting: 2
}

/**
 * The whole list, most urgent first: closest to finishing, then final-year
 * students, then the ones drifting away. Within a reason, whoever is
 * nearest the end comes first.
 */
export function reachOutList(inputs: ReachOutInput[], today: Date = new Date()): ReachOutSuggestion[] {
  return inputs
    .map((input) => suggestionFor(input, today))
    .filter((s): s is ReachOutSuggestion => s !== null)
    .sort(
      (a, b) =>
        ORDER[a.reason] - ORDER[b.reason] ||
        (a.unitsRemaining ?? 0) - (b.unitsRemaining ?? 0) ||
        a.lastName.localeCompare(b.lastName)
    )
}

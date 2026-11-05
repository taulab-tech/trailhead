/**
 * Which way round a person's name is.
 *
 * A roster that writes "Okonkwo, Amara" says plainly which half is the
 * surname. A sheet with "first name" and "last name" columns only claims to
 * — and a claim is not a fact. Rows get typed into those two columns the
 * wrong way round, which leaves the app holding one record reading
 * "Okonkwo Amara" and another, from a class list, reading "Amara Okonkwo".
 *
 * Nothing here guesses. A name split on a comma is recorded as confirmed and
 * a name from two columns is not, and the only thing done with that is to
 * say so on screen when the two disagree — the person reviewing decides.
 */

/** The pseudo-field under which a name's provenance is recorded. */
export const NAME_ORDER_FIELD = 'nameOrder'

/**
 * Written as the source when the order came from a "Last, First" column, as
 * registrar class lists and the master contact list use. Anything else is
 * absent, which means "this is what the column headings claimed".
 */
export const NAME_ORDER_CONFIRMED = 'roster'

export interface NamedRecord {
  firstName: string
  lastName: string
}

function tidy(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * True when two records hold the same two names the opposite way round.
 *
 * Deliberately exact rather than fuzzy: a name against its own reverse is an
 * order problem with one clear answer, while a name against a near-miss
 * spelling is a different question and belongs in the ordinary similar-name
 * review.
 *
 * Somebody whose first and last names are the same word is left out — there
 * is no wrong way round for "Thomas Thomas", and calling it reversed would
 * put a pair on the screen with nothing to decide.
 */
export function isReversedName(a: NamedRecord, b: NamedRecord): boolean {
  const aFirst = tidy(a.firstName)
  const aLast = tidy(a.lastName)
  const bFirst = tidy(b.firstName)
  const bLast = tidy(b.lastName)
  if (!aFirst || !aLast || !bFirst || !bLast) return false
  if (aFirst === aLast) return false
  return aFirst === bLast && aLast === bFirst
}

/** How a reversed pair should be described, and which side to trust. */
export interface ReversedNameVerdict {
  /** The side whose order came from a roster, when exactly one did. */
  confirmed: 'a' | 'b' | null
  /** A sentence for the review screen. */
  reason: string
}

/**
 * Explains a reversed pair, naming the record to keep when the evidence
 * picks one. With no roster on either side it says what is wrong and leaves
 * the choice alone rather than inventing a recommendation.
 */
export function explainReversedName(
  a: NamedRecord,
  b: NamedRecord,
  aFromRoster: boolean,
  bFromRoster: boolean
): ReversedNameVerdict {
  const aName = `${a.firstName} ${a.lastName}`
  const bName = `${b.firstName} ${b.lastName}`

  if (aFromRoster && !bFromRoster) {
    return {
      confirmed: 'a',
      reason: `Same name, opposite way round. A class list gives it as "${aName}", so "${bName}" has the first and last name swapped.`
    }
  }
  if (bFromRoster && !aFromRoster) {
    return {
      confirmed: 'b',
      reason: `Same name, opposite way round. A class list gives it as "${bName}", so "${aName}" has the first and last name swapped.`
    }
  }
  return {
    confirmed: null,
    reason: `Same name, opposite way round — "${aName}" and "${bName}". One of them is swapped, and nothing on record says which: both came from a sheet that only claimed the order in a column heading. Importing a class list with this person on it will settle it.`
  }
}

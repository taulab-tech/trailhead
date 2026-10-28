import {
  addEmail,
  addPhone,
  createStudent,
  findStudentIdByEmail,
  findStudentIdByNsid,
  getAllStudentsMinimal,
  findStudentsByIdLocalPart,
  getStudentById,
  updateStudent
} from './db/students'
import { suggestDuplicate } from './db/duplicates'
import { idLocalPart, normalizeName, normalizeNsid } from './normalize'
import { nameSimilarity } from './similarity'

export const FUZZY_DUPLICATE_THRESHOLD = 0.9

/** How alike two names must be before an email-form student ID may link them. */
export const ID_NAME_AGREEMENT_THRESHOLD = 0.85

/** Two student IDs belong to different people when the parts before any "@" differ. */
function idsConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && idLocalPart(a) !== idLocalPart(b)
}

/**
 * Whether two names are compatible enough to trust an ID that only matched
 * after ignoring its "@…" part. A row with no usable name can't contradict
 * anything, so it agrees.
 */
function namesAgree(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }): boolean {
  const na = normalizeName(`${a.firstName} ${a.lastName}`)
  const nb = normalizeName(`${b.firstName} ${b.lastName}`)
  if (!na || !nb || na === 'unknown' || nb === 'unknown') return true
  return nameSimilarity(na, nb) >= ID_NAME_AGREEMENT_THRESHOLD
}

export interface PersonRecord {
  firstName: string
  lastName: string
  nsid?: string | null
  emails: string[]
  phones: string[]
  college?: string | null
  discipline?: string | null
  degree?: string | null
  program?: string | null
  yearInProgram?: string | null
  enrolTerm?: 'fall' | 'winter' | null
}

export interface MatchResult {
  studentId: string
  created: boolean
}

function enrichIfBlank(studentId: string, fields: Record<string, string | null | undefined>): void {
  const current = getStudentById(studentId)
  if (!current) return
  const patch: Record<string, string | null> = {}
  const map: Record<string, keyof typeof current> = {
    nsid: 'nsid',
    college: 'college',
    discipline: 'discipline',
    degree: 'degree',
    program: 'program',
    yearInProgram: 'yearInProgram',
    enrolTerm: 'enrolTerm'
  }
  for (const [key, currentField] of Object.entries(map)) {
    const incoming = fields[key]
    const existingVal = current[currentField] as string | null
    if ((!existingVal || !existingVal.trim()) && incoming && incoming.trim()) {
      patch[key] = incoming
    }
  }
  if (Object.keys(patch).length > 0) {
    updateStudent(studentId, patch as Parameters<typeof updateStudent>[1])
  }
}

/**
 * Matches (or creates) the student for a single imported attendance row.
 * Priority: student ID exact > student ID ignoring any "@…" part (only when
 * the names agree, so "john@gmail.com" and "john@hotmail.com" never merge
 * two different Johns) > email exact > unique exact normalized-name match
 * (skipped when the IDs conflict). Anything less certain is left for the
 * fuzzy duplicate pass below rather than being auto-merged.
 */
export function matchStudent(person: PersonRecord): MatchResult {
  const normalizedNsid = normalizeNsid(person.nsid)
  const normalizedEmails = person.emails
    .map((e) => e.trim())
    .filter(Boolean)

  let studentId: string | null = null

  if (normalizedNsid) {
    studentId = findStudentIdByNsid(normalizedNsid)
    if (!studentId) {
      const sameId = findStudentsByIdLocalPart(idLocalPart(normalizedNsid)).filter((s) =>
        namesAgree(person, s)
      )
      if (sameId.length === 1) studentId = sameId[0].id
    }
  }

  if (!studentId) {
    for (const email of normalizedEmails) {
      const found = findStudentIdByEmail(email)
      if (found) {
        studentId = found
        break
      }
    }
  }

  if (!studentId) {
    const normalizedFullName = normalizeName(`${person.firstName} ${person.lastName}`)
    if (normalizedFullName) {
      const all = getAllStudentsMinimal()
      // A name match is only trusted when the IDs don't contradict it — two
      // different IDs means two different people who share a name.
      const exactMatches = all.filter(
        (s) =>
          normalizeName(`${s.firstName} ${s.lastName}`) === normalizedFullName &&
          !idsConflict(normalizedNsid, s.nsid)
      )
      if (exactMatches.length === 1) {
        studentId = exactMatches[0].id
      }
    }
  }

  if (studentId) {
    enrichIfBlank(studentId, {
      nsid: normalizedNsid,
      college: person.college,
      discipline: person.discipline,
      degree: person.degree,
      program: person.program,
      yearInProgram: person.yearInProgram,
      enrolTerm: person.enrolTerm
    })
    for (const email of normalizedEmails) addEmail(studentId, email)
    for (const phone of person.phones) addPhone(studentId, phone)
    return { studentId, created: false }
  }

  const newId = createStudent({
    firstName: person.firstName,
    lastName: person.lastName,
    nsid: normalizedNsid,
    college: person.college,
    discipline: person.discipline,
    degree: person.degree,
    program: person.program,
    yearInProgram: person.yearInProgram,
    enrolTerm: person.enrolTerm
  })
  for (const email of normalizedEmails) addEmail(newId, email)
  for (const phone of person.phones) addPhone(newId, phone)
  return { studentId: newId, created: true }
}

/**
 * Runs a fuzzy name-similarity pass comparing each `touchedId` against every
 * other student, flagging close-but-not-identical (or ambiguous exact) name
 * matches as possible duplicates for manual review/merge rather than
 * auto-merging them.
 */
export function detectFuzzyDuplicates(touchedIds: string[]): number {
  if (touchedIds.length === 0) return 0
  const all = getAllStudentsMinimal()
  const named = all.map((s) => ({ ...s, normalized: normalizeName(`${s.firstName} ${s.lastName}`) }))
  const touchedSet = new Set(touchedIds)

  let created = 0
  for (const touchedId of touchedIds) {
    const touched = named.find((s) => s.id === touchedId)
    if (!touched || !touched.normalized) continue

    for (const other of named) {
      if (other.id === touched.id) continue
      // Avoid double-work: if both are in this batch, only compare when touched.id < other.id
      if (touchedSet.has(other.id) && touched.id > other.id) continue
      // Student IDs are unique per person, so two different ones can never be a duplicate.
      if (idsConflict(touched.nsid, other.nsid)) continue

      const score = nameSimilarity(touched.normalized, other.normalized)
      if (score >= FUZZY_DUPLICATE_THRESHOLD) {
        const reason =
          score === 1
            ? `Identical name "${touched.firstName} ${touched.lastName}" but no matching student ID or email — could be the same person or two different people.`
            : `Similar name: "${touched.firstName} ${touched.lastName}" vs "${other.firstName} ${other.lastName}"`
        suggestDuplicate(touched.id, other.id, score, reason)
        created++
      }
    }
  }
  return created
}

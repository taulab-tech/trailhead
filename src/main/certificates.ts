import type {
  CertificateDefinition,
  CertificateGroup,
  CertificateProgress,
  CourseStanding,
  GroupProgress,
  RequirementProgress,
  StudentCourse
} from '../shared/types'

/**
 * How far a student is through a certificate.
 *
 * Pure arithmetic over a definition and a list of courses — no database — so
 * the rules can be read and tested on their own. The awkward parts are all
 * real rules from real certificates:
 *
 *  - A course is worth what the *catalogue* says, not what the class list
 *    says. GE 495.6 runs September to April and the registrar exports it
 *    once at 3.0 units; counting that would leave every capstone student
 *    three units short of a certificate they have finished.
 *  - "9 units of electives, at least 3 of which must be COMM" is a group
 *    inside a group. Units from the wider pool can't fill the COMM minimum,
 *    so there is a cap on how much of the 9 they can supply.
 *  - A capstone substitution only counts when its companion course is also
 *    done ("CHE 495.6 in place of GE 495.6, provided you also take GE 496.3").
 */

/** Whether a course counts yet. Audited and failed courses count for nothing. */
export function standingFor(courses: StudentCourse[]): Map<string, CourseStanding> {
  const standings = new Map<string, CourseStanding>()
  for (const course of courses) {
    const code = normalizeCourseCode(course.courseCode)
    const current = standings.get(code)
    if (course.status === 'completed') {
      standings.set(code, 'completed')
    } else if (course.status === 'in_progress' && current !== 'completed') {
      standings.set(code, 'in_progress')
    }
  }
  return standings
}

/**
 * "ge495", "GE  495" and "GE 495.6" are all the same course. The catalogue
 * writes the credit units into the code; the registrar doesn't.
 */
export function normalizeCourseCode(code: string): string {
  const match = code.trim().toUpperCase().match(/^([A-Z]{2,5})\s*(\d{3,4})/)
  return match ? `${match[1]} ${match[2]}` : code.trim().toUpperCase()
}

/** Counts a course as done, under whichever pass is running. */
type Counts = (standing: CourseStanding | undefined) => boolean

const COMPLETED_ONLY: Counts = (s) => s === 'completed'
const COMPLETED_OR_UNDERWAY: Counts = (s) => s === 'completed' || s === 'in_progress'

interface Walked {
  group: GroupProgress
  /** Every completed unit in this group and below it, before any cap. */
  rawUnits: number
}

function walkGroup(
  definition: CertificateDefinition,
  group: CertificateGroup,
  standings: Map<string, CourseStanding>,
  counts: Counts
): Walked {
  const children = definition.groups
    .filter((g) => g.parentId === group.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((child) => walkGroup(definition, child, standings, counts))

  const requirements: RequirementProgress[] = definition.requirements
    .filter((r) => r.groupId === group.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((requirement) => {
      const code = normalizeCourseCode(requirement.courseCode)
      const standing = standings.get(code)
      if (counts(standing)) {
        return {
          courseCode: requirement.courseCode,
          creditUnits: requirement.creditUnits,
          standing: standing ?? 'none',
          satisfiedBy: null
        }
      }

      // Not taken — but another course may stand in for it.
      const substitute = definition.substitutions.find((sub) => {
        if (normalizeCourseCode(sub.replacesCode) !== code) return false
        if (!counts(standings.get(normalizeCourseCode(sub.acceptedCode)))) return false
        if (!sub.alsoRequiresCode) return true
        return counts(standings.get(normalizeCourseCode(sub.alsoRequiresCode)))
      })

      return {
        courseCode: requirement.courseCode,
        creditUnits: requirement.creditUnits,
        standing: substitute ? 'completed' : (standing ?? 'none'),
        satisfiedBy: substitute?.acceptedCode ?? null
      }
    })

  const met = (r: RequirementProgress): boolean =>
    r.satisfiedBy !== null || counts(standings.get(normalizeCourseCode(r.courseCode)))

  const ownUnits = requirements.filter(met).reduce((sum, r) => sum + r.creditUnits, 0)
  const rawUnits = ownUnits + children.reduce((sum, c) => sum + c.rawUnits, 0)

  let earnedUnits: number
  let satisfied: boolean

  if (group.kind === 'required' || group.minUnits === null) {
    // Every course in the group has to be done.
    earnedUnits = ownUnits + children.reduce((sum, c) => sum + c.group.earnedUnits, 0)
    satisfied = requirements.every(met) && children.every((c) => c.group.satisfied)
  } else {
    // A number of units from the list. A child group's minimum has to come
    // from that child, so the wider pool can only supply what is left over.
    const childMinimums = children.reduce((sum, c) => sum + (c.group.minUnits ?? 0), 0)
    const headroomForOwn = Math.max(0, group.minUnits - childMinimums)
    const creditedOwn = Math.min(ownUnits, headroomForOwn)
    const creditedChildren = Math.min(
      children.reduce((sum, c) => sum + c.rawUnits, 0),
      group.minUnits - creditedOwn
    )
    earnedUnits = creditedOwn + creditedChildren
    satisfied = rawUnits >= group.minUnits && children.every((c) => c.group.satisfied)
  }

  return {
    rawUnits,
    group: {
      id: group.id,
      name: group.name,
      kind: group.kind,
      minUnits: group.minUnits,
      earnedUnits,
      satisfied,
      requirements,
      children: children.map((c) => c.group)
    }
  }
}

function runPass(
  definition: CertificateDefinition,
  standings: Map<string, CourseStanding>,
  counts: Counts
): { groups: GroupProgress[]; earnedUnits: number; complete: boolean } {
  const groups = definition.groups
    .filter((g) => g.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => walkGroup(definition, g, standings, counts).group)

  return {
    groups,
    earnedUnits: groups.reduce((sum, g) => sum + g.earnedUnits, 0),
    complete: groups.length > 0 && groups.every((g) => g.satisfied)
  }
}

/**
 * The units a certificate is out of. The stored figure wins when there is
 * one, since a few certificates state a total that isn't simply the sum of
 * their parts; otherwise it is the required courses plus each elective
 * minimum.
 */
export function totalUnitsFor(definition: CertificateDefinition): number {
  if (definition.totalUnits !== null) return definition.totalUnits

  const topLevel = definition.groups.filter((g) => g.parentId === null)
  return topLevel.reduce((sum, group) => {
    if (group.kind === 'elective' && group.minUnits !== null) return sum + group.minUnits
    const units = definition.requirements
      .filter((r) => r.groupId === group.id)
      .reduce((inner, r) => inner + r.creditUnits, 0)
    return sum + units
  }, 0)
}

/** Every course the student still needs, by code, for the required groups. */
function missingFrom(groups: GroupProgress[]): string[] {
  const missing: string[] = []
  const walk = (group: GroupProgress): void => {
    if (group.kind === 'required') {
      for (const r of group.requirements) {
        if (r.standing !== 'completed') missing.push(r.courseCode)
      }
    }
    group.children.forEach(walk)
  }
  groups.forEach(walk)
  return missing
}

/** Works out where one student stands against one certificate. */
export function certificateProgress(
  definition: CertificateDefinition,
  courses: StudentCourse[]
): CertificateProgress {
  const standings = standingFor(courses)

  const earned = runPass(definition, standings, COMPLETED_ONLY)
  // The same sum again, counting what they are part-way through, so the
  // difference is what is currently in flight.
  const projected = runPass(definition, standings, COMPLETED_OR_UNDERWAY)

  const totalUnits = totalUnitsFor(definition)

  return {
    certificateId: definition.id,
    name: definition.name,
    totalUnits,
    earnedUnits: earned.earnedUnits,
    inProgressUnits: Math.max(0, projected.earnedUnits - earned.earnedUnits),
    percent: totalUnits > 0 ? Math.round((earned.earnedUnits / totalUnits) * 100) : 0,
    complete: earned.complete,
    groups: earned.groups,
    missing: missingFrom(earned.groups)
  }
}

/**
 * A certificate's name with the part everybody already knows taken off, for
 * use in a sentence.
 *
 * All three USask certificates begin "Engineering", two of them
 * "Engineering Entrepreneurship – ", so a line like "1 CU from finishing
 * Engineering Entrepreneurship – Leading Innovative Teams" spends most of
 * its width saying nothing and wraps to two rows in a dashboard card. The
 * distinguishing half is what a reader needs.
 *
 * The full name is still what the Certificates screen shows, and what gets
 * exported — this is only for the running text beside somebody's name.
 */
export function shortCertificateName(name: string): string {
  const afterDash = name.split(/\s[–—-]\s/).pop()?.trim()
  if (afterDash && afterDash !== name.trim()) return afterDash
  return name.replace(/^Engineering\s+/i, '').trim() || name
}

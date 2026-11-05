import { getDb } from './index'
import { listStudents } from './students'
import { listStudentCourses } from './courses'
import { listCertificateDefinitions } from './certificates'
import { certificateProgress, shortCertificateName } from '../certificates'
import { CLOSE_UNITS, reachOutList } from '../reachOut'
import type { ReachOutSuggestion, RecentContact } from '../../shared/types'
import { findCategoryByName } from './categories'
import { getPendingDuplicateCount } from './duplicates'
import { parseEnrolYear, enrolDateFor } from '../enrolDate'
import type { AttendanceDate, DashboardStats, FunnelFlow, FunnelNode, FunnelStats } from '../../shared/types'


/**
 * A real or inferred date per (student, event) attendance, used to make the
 * pathway diagram direction-honest. Class rosters rarely carry a meaningful
 * per-event date, but each student's enrol year (+ term, when known) lets us
 * infer one; everything else falls back to the event's own date.
 */
export function getAttendanceDates(): AttendanceDate[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.student_id as studentId, a.event_id as eventId, e.date as eventDate,
              e.category_id as categoryId, s.year_in_program as yearInProgram, s.enrol_term as enrolTerm
       FROM attendances a
       JOIN events e ON e.id = a.event_id
       JOIN students s ON s.id = a.student_id`
    )
    .all() as {
    studentId: string
    eventId: string
    eventDate: string | null
    categoryId: string | null
    yearInProgram: string | null
    enrolTerm: string | null
  }[]

  const classCategoryId = findCategoryByName('Class')?.id ?? null
  const dates: AttendanceDate[] = []
  for (const r of rows) {
    if (r.eventDate) {
      dates.push({ studentId: r.studentId, eventId: r.eventId, date: r.eventDate })
      continue
    }
    if (!classCategoryId || r.categoryId !== classCategoryId) continue
    const year = parseEnrolYear(r.yearInProgram)
    if (!year || (r.enrolTerm !== 'fall' && r.enrolTerm !== 'winter')) continue
    dates.push({ studentId: r.studentId, eventId: r.eventId, date: enrolDateFor(year, r.enrolTerm) })
  }
  return dates
}

/**
 * Every (event, student) attendance pair, grouped by event. Shipping this
 * once lets the renderer compute any category- or event-level intersection
 * (for the interactive pathway diagram's expand/flow drill-down) locally,
 * instead of needing a bespoke query per possible click.
 */
export function getEventStudentSets(): { eventId: string; studentIds: string[] }[] {
  const db = getDb()
  const rows = db.prepare('SELECT event_id, student_id FROM attendances').all() as {
    event_id: string
    student_id: string
  }[]
  const map = new Map<string, string[]>()
  for (const r of rows) {
    if (!map.has(r.event_id)) map.set(r.event_id, [])
    map.get(r.event_id)!.push(r.student_id)
  }
  return Array.from(map.entries()).map(([eventId, studentIds]) => ({ eventId, studentIds }))
}

function groupCount(column: string): { label: string; count: number }[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ${column} as label, COUNT(*) as count FROM students
       WHERE ${column} IS NOT NULL AND trim(${column}) != ''
       GROUP BY ${column} ORDER BY count DESC LIMIT 12`
    )
    .all() as { label: string; count: number }[]
  return rows
}

/** Every calendar year with at least one dated event, for the funnel's year selector. */
export function getFunnelYears(): number[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT CAST(strftime('%Y', date) AS INTEGER) as year
       FROM events WHERE date IS NOT NULL ORDER BY year DESC`
    )
    .all() as { year: number }[]
  return rows.map((r) => r.year)
}

/** Pass a year to scope every stage to that calendar year's events only; omit for all-time. */
export function getFunnelStats(year: number | null = null): FunnelStats {
  const db = getDb()
  const categories = db
    .prepare(
      'SELECT id, name, stage_order FROM event_categories WHERE stage_order IS NOT NULL ORDER BY stage_order ASC, name ASC'
    )
    .all() as { id: string; name: string; stage_order: number }[]

  if (categories.length === 0) {
    return { stages: [], nodes: [], flows: [], fullFunnelCount: 0 }
  }

  const studentSets = new Map<string, Set<string>>()
  for (const cat of categories) {
    const rows = year
      ? (db
          .prepare(
            `SELECT DISTINCT a.student_id as id FROM attendances a
             JOIN events e ON e.id = a.event_id
             WHERE e.category_id = ? AND strftime('%Y', e.date) = ?`
          )
          .all(cat.id, String(year)) as { id: string }[])
      : (db
          .prepare(
            `SELECT DISTINCT a.student_id as id FROM attendances a
             JOIN events e ON e.id = a.event_id WHERE e.category_id = ?`
          )
          .all(cat.id) as { id: string }[])
    studentSets.set(cat.id, new Set(rows.map((r) => r.id)))
  }

  const nodes: FunnelNode[] = categories.map((cat) => ({
    categoryId: cat.id,
    categoryName: cat.name,
    stage: cat.stage_order,
    studentCount: studentSets.get(cat.id)!.size
  }))

  const stages = Array.from(new Set(categories.map((c) => c.stage_order))).sort((a, b) => a - b)

  const flows: FunnelFlow[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    const fromCats = categories.filter((c) => c.stage_order === stages[i])
    const toCats = categories.filter((c) => c.stage_order === stages[i + 1])
    for (const fromCat of fromCats) {
      const fromSet = studentSets.get(fromCat.id)!
      for (const toCat of toCats) {
        const toSet = studentSets.get(toCat.id)!
        let count = 0
        for (const id of fromSet) if (toSet.has(id)) count++
        if (count > 0) flows.push({ fromCategoryId: fromCat.id, toCategoryId: toCat.id, count })
      }
    }
  }

  const stageUnionSets = stages.map((stage) => {
    const union = new Set<string>()
    for (const cat of categories.filter((c) => c.stage_order === stage)) {
      for (const id of studentSets.get(cat.id)!) union.add(id)
    }
    return union
  })
  let fullFunnelCount = 0
  for (const id of stageUnionSets[0]) {
    if (stageUnionSets.every((set) => set.has(id))) fullFunnelCount++
  }

  return { stages, nodes, flows, fullFunnelCount }
}

export function getDashboardStats(): DashboardStats {
  const db = getDb()

  const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }).c
  const totalEvents = (db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }).c
  const totalAttendances = (
    db.prepare('SELECT COUNT(*) as c FROM attendances').get() as { c: number }
  ).c

  const repeatAttendeeCount = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM (
           SELECT student_id FROM attendances GROUP BY student_id HAVING COUNT(*) >= 2
         )`
      )
      .get() as { c: number }
  ).c

  const topEvents = db
    .prepare(
      `SELECT e.id as eventId, e.name as name, COUNT(a.id) as count
       FROM events e LEFT JOIN attendances a ON a.event_id = e.id
       GROUP BY e.id ORDER BY count DESC LIMIT 10`
    )
    .all() as { eventId: string; name: string; count: number }[]

  const eventsOverTime = db
    .prepare(
      `SELECT e.name as name, e.date as date, COUNT(a.id) as count
       FROM events e LEFT JOIN attendances a ON a.event_id = e.id
       GROUP BY e.id ORDER BY e.date IS NULL, e.date ASC`
    )
    .all() as { name: string; date: string | null; count: number }[]

  return {
    totalStudents,
    totalEvents,
    totalAttendances,
    repeatAttendeeCount,
    repeatAttendeeRate: totalStudents ? repeatAttendeeCount / totalStudents : 0,
    avgEventsPerStudent: totalStudents ? totalAttendances / totalStudents : 0,
    pendingDuplicates: getPendingDuplicateCount(),
    byCollege: groupCount('college'),
    byDiscipline: groupCount('discipline'),
    byYear: groupCount('year_in_program'),
    topEvents,
    eventsOverTime,
    funnel: getFunnelStats(),
    funnelYears: getFunnelYears()
  }
}

/** The most recent sign of a student, and what that sign was. */
interface LastSeen {
  date: string
  where: string
}

const TERM_MONTHS: Record<string, string> = {
  '01': 'Winter',
  '05': 'Spring',
  '07': 'Summer',
  '09': 'Fall'
}

/** "202509" as people say it: "Fall 2025". */
function termLabel(term: string): string | null {
  const match = term.match(/^(\d{4})(\d{2})$/)
  if (!match) return null
  const season = TERM_MONTHS[match[2]]
  return season ? `${season} ${match[1]}` : match[1]
}

/**
 * When each student was last seen, and where.
 *
 * Two sources, because the two halves of this data are kept apart: an event
 * with a date on it, and a term a student was registered in. A class list
 * carries no event date, so without the terms every class-only student
 * looks like somebody nobody has seen in years.
 */
function lastSeenByStudent(): Map<string, LastSeen> {
  const db = getDb()
  const seen = new Map<string, LastSeen>()
  const note = (id: string, date: string | null, where: string): void => {
    if (!date) return
    const current = seen.get(id)
    if (!current || date > current.date) seen.set(id, { date, where })
  }

  for (const row of db
    .prepare(
      `SELECT a.student_id AS id, e.date AS date, e.name AS name FROM attendances a
       JOIN events e ON e.id = a.event_id WHERE e.date IS NOT NULL`
    )
    .all() as { id: string; date: string; name: string }[]) {
    note(row.id, row.date, row.name)
  }

  for (const row of db
    .prepare("SELECT student_id AS id, term, course_code AS code FROM student_courses WHERE term != ''")
    .all() as { id: string; term: string; code: string }[]) {
    const label = termLabel(row.term)
    if (!label) continue
    note(row.id, `${row.term.slice(0, 4)}-${row.term.slice(4)}-01`, `${row.code}, ${label}`)
  }

  return seen
}

/**
 * Who to contact, worked out from certificate progress and how long it has
 * been since anybody saw them.
 *
 * Gathered here rather than in the rules so the rules stay testable
 * without a database behind them.
 */
export function reachOutSuggestions(): ReachOutSuggestion[] {
  const definitions = listCertificateDefinitions()
  if (definitions.length === 0) return []
  const seen = lastSeenByStudent()

  return reachOutList(
    listStudents().map((student) => ({
      student,
      certificates: definitions.map((definition) =>
        certificateProgress(definition, listStudentCourses(student.id))
      ),
      lastSeen: seen.get(student.id)?.date ?? null
    }))
  )
}

/** How many recent contacts to work out. More than anybody reads in a sitting. */
const RECENT_LIMIT = 24

/**
 * The students seen most recently, with what following up on each would be
 * worth.
 *
 * Sorted by date only. Certificate progress is computed for the handful
 * that come back rather than for everybody, because working out three
 * certificates for six hundred students to show twelve names is most of a
 * second of somebody's afternoon for nothing.
 */
export function recentContacts(limit = RECENT_LIMIT): RecentContact[] {
  const seen = [...lastSeenByStudent()]
    .sort((a, b) => b[1].date.localeCompare(a[1].date))
    .slice(0, limit)
  if (seen.length === 0) return []

  const definitions = listCertificateDefinitions()
  const byId = new Map(listStudents().map((student) => [student.id, student]))

  const contacts: RecentContact[] = []
  for (const [studentId, when] of seen) {
    const student = byId.get(studentId)
    if (!student) continue

    const courses = definitions.length > 0 ? listStudentCourses(studentId) : []
    const started = definitions
      .map((definition) => certificateProgress(definition, courses))
      .filter((progress) => progress.earnedUnits > 0)
      .sort((a, b) => b.percent - a.percent)
    const best = started[0] ?? null
    const remaining = best ? Math.max(0, best.totalUnits - best.earnedUnits) : null

    // One line anybody can check, strongest true thing first.
    const label = best ? shortCertificateName(best.name) : ''
    let promise: string
    if (best?.complete) promise = `Finished ${label}`
    else if (remaining !== null && remaining <= CLOSE_UNITS) {
      promise = `${remaining} CU from finishing ${label}`
    } else if (best) promise = `${best.percent}% through ${label}`
    else if (student.attendanceCount > 1) promise = `${student.attendanceCount} events so far`
    else promise = 'First time here'

    contacts.push({
      studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      lastSeen: when.date,
      where: when.where,
      attendanceCount: student.attendanceCount,
      certificateName: best?.name ?? null,
      percent: best?.percent ?? null,
      promise,
      promising: remaining !== null && remaining > 0 && remaining <= CLOSE_UNITS
    })
  }
  return contacts
}

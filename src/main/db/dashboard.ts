import { getDb } from './index'
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

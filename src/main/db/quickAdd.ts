import { getDb } from './index'
import { addAttendance, getStudentById } from './students'
import { findOrCreateEvent } from './events'
import { listCategories } from './categories'
import { listStudentCourses } from './courses'
import { listCertificateDefinitions } from './certificates'
import { certificateProgress } from '../certificates'
import { matchStudent, newMatchContext } from '../matching'
import { parsePastedPeople } from '../quickAddParse'
import { nextStepFor, type TrailPosition } from '../nextStep'
import { shortCertificateName } from '../certificates'
import type { Connection, QuickAddPerson, QuickAddRequest, QuickAddResult } from '../../shared/types'

/**
 * Adding people from a list typed at an event, and saying something useful
 * about each one straight away.
 *
 * The point is the feedback, not the data entry. Somebody standing at a
 * table wants to know, as they type the name, whether this is the first
 * time they have met this person or the fifth, and what to say to them —
 * which is exactly what the app knows and a sign-up sheet does not.
 *
 * Everything written here goes through the same matching the importer
 * uses, so a name typed at a table and a name on a class list land on the
 * same record.
 */

/** How many people to name as connections before it stops being readable. */
const CONNECTION_LIMIT = 4

/** The trail's stops in order, with the categories that sit at each. */
function trailStops(): { stage: number; names: string[] }[] {
  const onTrail = listCategories().filter((c) => c.stageOrder !== null)
  const stages = [...new Set(onTrail.map((c) => c.stageOrder as number))].sort((a, b) => a - b)
  return stages.map((stage) => ({
    stage,
    names: onTrail.filter((c) => c.stageOrder === stage).map((c) => c.name)
  }))
}

/** Where one student has got to on the trail. */
function trailPositionFor(studentId: string, stops: { stage: number; names: string[] }[]): TrailPosition {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT c.stage_order AS stage, c.name AS name
       FROM attendances a
       JOIN events e ON e.id = a.event_id
       JOIN event_categories c ON c.id = e.category_id
       WHERE a.student_id = ? AND c.stage_order IS NOT NULL`
    )
    .all(studentId) as { stage: number; name: string }[]

  if (rows.length === 0 || stops.length === 0) {
    return {
      furthestStage: null,
      furthestStopName: null,
      nextStopName: stops[0]?.names.join(' or ') ?? null,
      atEnd: false
    }
  }

  const furthest = rows.reduce((best, r) => (r.stage > best.stage ? r : best))
  const index = stops.findIndex((s) => s.stage === furthest.stage)
  const next = index >= 0 ? stops[index + 1] : undefined
  return {
    furthestStage: furthest.stage,
    furthestStopName: furthest.name,
    nextStopName: next ? next.names.join(' or ') : null,
    atEnd: index === stops.length - 1
  }
}

/** The people this student has shared the most events with. */
function connectionsFor(studentId: string): { connections: Connection[]; total: number } {
  const rows = getDb()
    .prepare(
      `SELECT other.student_id AS id, COUNT(*) AS shared
       FROM attendances mine
       JOIN attendances other ON other.event_id = mine.event_id AND other.student_id != mine.student_id
       WHERE mine.student_id = ?
       GROUP BY other.student_id
       ORDER BY shared DESC`
    )
    .all(studentId) as { id: string; shared: number }[]

  const connections: Connection[] = []
  for (const row of rows.slice(0, CONNECTION_LIMIT)) {
    const person = getStudentById(row.id)
    if (!person) continue
    connections.push({
      studentId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      sharedEvents: row.shared
    })
  }
  return { connections, total: rows.length }
}

/** The last time anybody saw this student, not counting today. */
function previousSighting(studentId: string, excludeEventId: string | null): { date: string; where: string } | null {
  const row = getDb()
    .prepare(
      `SELECT e.date AS date, e.name AS name
       FROM attendances a JOIN events e ON e.id = a.event_id
       WHERE a.student_id = ? AND e.date IS NOT NULL AND (? IS NULL OR e.id != ?)
       ORDER BY e.date DESC LIMIT 1`
    )
    .get(studentId, excludeEventId, excludeEventId) as { date: string; name: string } | undefined
  return row ? { date: row.date, where: row.name } : null
}

function monthsBetween(from: string, to: Date): number | null {
  const then = new Date(from)
  if (Number.isNaN(then.getTime())) return null
  return (to.getFullYear() - then.getFullYear()) * 12 + (to.getMonth() - then.getMonth())
}

/**
 * Adds everybody in the pasted text, and reports on each one.
 *
 * With `previewOnly` the same work is done inside a transaction that is
 * rolled back, so the screen can show exactly what pressing the button
 * would do — including who is new — without having done it.
 */
export function quickAdd(request: QuickAddRequest, today: Date = new Date()): QuickAddResult {
  const lines = parsePastedPeople(request.text)
  const unreadable = lines.filter((l) => l.problem !== null)
  const usable = lines.filter((l) => l.problem === null)

  const db = getDb()
  let result: QuickAddResult = {
    eventId: null,
    eventName: null,
    people: [],
    unreadable,
    newStudents: 0,
    returning: 0
  }

  const work = (): QuickAddResult => {
    const eventName = request.eventName?.trim() || null
    const eventId = eventName
      ? findOrCreateEvent(eventName, request.eventDate ?? null, null, null, request.categoryId ?? null)
      : null

    const context = newMatchContext(request.eventDate ?? today.toISOString().slice(0, 10), 'typed in')
    const stops = trailStops()
    const definitions = listCertificateDefinitions()
    const people: QuickAddPerson[] = []

    for (const line of usable) {
      // What was true before this line was applied, so "first time" and
      // "last seen" describe the person as they were when they walked in.
      const before = previousSightingLookup(line, eventId)

      const { studentId, created } = matchStudent(
        {
          firstName: line.firstName,
          lastName: line.lastName,
          emails: line.emails,
          phones: line.phones,
          nameOrderConfirmed: line.nameOrderConfirmed
        },
        context
      )

      if (eventId) addAttendance(studentId, eventId, {})
      if (line.note) appendNote(studentId, line.note, eventName, request.eventDate ?? null)

      const student = getStudentById(studentId)
      if (!student) continue

      const previous = before ?? previousSighting(studentId, eventId)
      const certificates = definitions
        .map((definition) => certificateProgress(definition, listStudentCourses(studentId)))
        .filter((progress) => progress.earnedUnits > 0)
        .sort((a, b) => b.percent - a.percent)
        .map((progress) => ({
          name: shortCertificateName(progress.name),
          percent: progress.percent,
          unitsRemaining: Math.max(0, progress.totalUnits - progress.earnedUnits),
          complete: progress.complete
        }))

      const trail = trailPositionFor(studentId, stops)
      const { connections } = connectionsFor(studentId)

      const step = nextStepFor({
        isNew: created,
        isAlumni: student.isAlumni,
        attendanceCount: student.attendanceCount,
        monthsSinceSeen: previous ? monthsBetween(previous.date, today) : null,
        trail,
        certificates: definitions.map((definition) =>
          certificateProgress(definition, listStudentCourses(studentId))
        ),
        hasPosition: !!student.position
      })

      people.push({
        studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        line,
        isNew: created,
        attendanceCount: student.attendanceCount,
        previouslySeen: previous?.date ?? null,
        previouslySeenAt: previous?.where ?? null,
        updates: context.proposed.filter((u) => u.studentId === studentId),
        certificates,
        furthestStop: trail.furthestStopName,
        connections,
        nextStep: step.action,
        nextStepBecause: step.because
      })
    }

    return {
      eventId,
      eventName,
      people,
      unreadable,
      newStudents: people.filter((p) => p.isNew).length,
      returning: people.filter((p) => !p.isNew).length
    }
  }

  if (request.previewOnly) {
    // A preview has to run the real thing to be worth trusting, so it runs
    // it and throws the writes away. The sentinel is how a deliberate
    // rollback is told apart from an actual failure.
    try {
      db.transaction(() => {
        result = work()
        throw new RollbackPreview()
      })()
    } catch (error) {
      if (!(error instanceof RollbackPreview)) throw error
    }
    return result
  }

  return db.transaction(work)()
}

class RollbackPreview extends Error {}

/**
 * Looks up the last sighting before anything is written, which is the only
 * moment it can be read: adding them to today's event makes today the last
 * sighting.
 */
function previousSightingLookup(
  line: { firstName: string; lastName: string; emails: string[] },
  eventId: string | null
): { date: string; where: string } | null {
  const existing = findExisting(line)
  return existing ? previousSighting(existing, eventId) : null
}

/** The student this line already refers to, if any, without creating one. */
function findExisting(line: { firstName: string; lastName: string; emails: string[] }): string | null {
  const db = getDb()
  for (const email of line.emails) {
    const row = db
      .prepare('SELECT student_id AS id FROM student_emails WHERE lower(email) = lower(?)')
      .get(email) as { id: string } | undefined
    if (row) return row.id
  }
  const byName = db
    .prepare('SELECT id FROM students WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?)')
    .all(line.firstName, line.lastName) as { id: string }[]
  return byName.length === 1 ? byName[0].id : null
}

/**
 * Keeps what was said about somebody, stamped with where it was said.
 *
 * Added to rather than replacing: a note from a hackathon in March is not
 * made untrue by a note from a showcase in November.
 */
function appendNote(studentId: string, note: string, eventName: string | null, date: string | null): void {
  const student = getStudentById(studentId)
  if (!student) return
  const stamp = [eventName, date].filter(Boolean).join(', ')
  const line = stamp ? `${note} (${stamp})` : note
  if (student.notes?.includes(note)) return
  getDb()
    .prepare('UPDATE students SET notes = ?, updated_at = ? WHERE id = ?')
    .run(student.notes ? `${student.notes}\n${line}` : line, new Date().toISOString(), studentId)
}

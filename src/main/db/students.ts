import { newId } from '../ids'
import { getDb } from './index'
import { normalizeEmail, normalizeNsid, normalizePhone } from '../normalize'
import type { Attendance, NewStudentInput, Student, StudentDetail } from '../../shared/types'

interface StudentRow {
  id: string
  first_name: string
  last_name: string
  nsid: string | null
  college: string | null
  discipline: string | null
  degree: string | null
  program: string | null
  year_in_program: string | null
  enrol_term: string | null
  position: string | null
  position_url: string | null
  position_found_at: string | null
  position_org: string | null
  position_since: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

function rowToStudent(row: StudentRow, emails: string[], phones: string[], attendanceCount: number): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    nsid: row.nsid,
    college: row.college,
    discipline: row.discipline,
    degree: row.degree,
    program: row.program,
    yearInProgram: row.year_in_program,
    enrolTerm: row.enrol_term === 'fall' || row.enrol_term === 'winter' ? row.enrol_term : null,
    position: row.position ?? null,
    positionUrl: row.position_url ?? null,
    positionFoundAt: row.position_found_at ?? null,
    positionOrg: row.position_org ?? null,
    positionSince: row.position_since ?? null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    emails,
    phones,
    attendanceCount
  }
}

export function getStudentEmails(studentId: string): string[] {
  const db = getDb()
  return db
    .prepare('SELECT email FROM student_emails WHERE student_id = ? ORDER BY email')
    .all(studentId)
    .map((r) => (r as { email: string }).email)
}

export function getStudentPhones(studentId: string): string[] {
  const db = getDb()
  return db
    .prepare('SELECT phone FROM student_phones WHERE student_id = ? ORDER BY phone')
    .all(studentId)
    .map((r) => (r as { phone: string }).phone)
}

function getAttendanceCount(studentId: string): number {
  const db = getDb()
  const row = db
    .prepare('SELECT COUNT(*) as c FROM attendances WHERE student_id = ?')
    .get(studentId) as { c: number }
  return row.c
}

export function getStudentById(id: string): Student | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as StudentRow | undefined
  if (!row) return null
  return rowToStudent(row, getStudentEmails(id), getStudentPhones(id), getAttendanceCount(id))
}

export function getStudentDetail(id: string): StudentDetail | null {
  const student = getStudentById(id)
  if (!student) return null
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT a.id, a.student_id, a.event_id, a.extra_fields, a.created_at,
              e.name as event_name, e.date as event_date
       FROM attendances a
       JOIN events e ON e.id = a.event_id
       WHERE a.student_id = ?
       ORDER BY e.date IS NULL, e.date ASC, e.name ASC`
    )
    .all(id) as {
    id: string
    student_id: string
    event_id: string
    extra_fields: string | null
    created_at: string
    event_name: string
    event_date: string | null
  }[]

  const attendances: Attendance[] = rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    eventId: r.event_id,
    eventName: r.event_name,
    eventDate: r.event_date,
    extraFields: r.extra_fields ? JSON.parse(r.extra_fields) : {},
    createdAt: r.created_at
  }))

  return { ...student, attendances }
}

export function listStudents(search?: string): Student[] {
  const db = getDb()
  let rows: StudentRow[]
  if (search && search.trim()) {
    const like = `%${search.trim().toLowerCase()}%`
    rows = db
      .prepare(
        `SELECT DISTINCT s.* FROM students s
         LEFT JOIN student_emails se ON se.student_id = s.id
         WHERE lower(s.first_name || ' ' || s.last_name) LIKE ?
            OR lower(s.nsid) LIKE ?
            OR lower(se.email) LIKE ?
            OR lower(coalesce(s.college,'')) LIKE ?
            OR lower(coalesce(s.discipline,'')) LIKE ?
            OR lower(coalesce(s.program,'')) LIKE ?
         ORDER BY s.last_name, s.first_name`
      )
      .all(like, like, like, like, like, like) as StudentRow[]
  } else {
    rows = db.prepare('SELECT * FROM students ORDER BY last_name, first_name').all() as StudentRow[]
  }
  return rows.map((row) =>
    rowToStudent(row, getStudentEmails(row.id), getStudentPhones(row.id), getAttendanceCount(row.id))
  )
}

export function findStudentIdByNsid(nsid: string): string | null {
  const normalized = normalizeNsid(nsid)
  if (!normalized) return null
  const db = getDb()
  const row = db.prepare('SELECT id FROM students WHERE lower(nsid) = ?').get(normalized) as
    | { id: string }
    | undefined
  return row?.id ?? null
}

/**
 * Students whose stored ID shares `localPart` — stored bare ("abc123") or as
 * an email ("abc123@…"). Used when an incoming ID only matches once the
 * "@…" part is ignored, which the caller confirms against names.
 */
export function findStudentsByIdLocalPart(localPart: string): MinimalStudent[] {
  const db = getDb()
  const escaped = localPart.replace(/[\\%_]/g, (c) => `\\${c}`)
  const rows = db
    .prepare(
      "SELECT id, first_name, last_name, nsid FROM students WHERE nsid = ? OR nsid LIKE ? ESCAPE '\\'"
    )
    .all(localPart, `${escaped}@%`) as StudentRow[]
  return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, nsid: r.nsid }))
}

export function findStudentIdByEmail(email: string): string | null {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const db = getDb()
  const row = db.prepare('SELECT student_id FROM student_emails WHERE email = ?').get(normalized) as
    | { student_id: string }
    | undefined
  return row?.student_id ?? null
}

export interface MinimalStudent {
  id: string
  firstName: string
  lastName: string
  nsid: string | null
}

export function getAllStudentsMinimal(): MinimalStudent[] {
  const db = getDb()
  const rows = db.prepare('SELECT id, first_name, last_name, nsid FROM students').all() as StudentRow[]
  return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, nsid: r.nsid }))
}

export function createStudent(input: NewStudentInput): string {
  const db = getDb()
  const id = newId()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO students
      (id, first_name, last_name, nsid, college, discipline, degree, program, year_in_program, enrol_term, notes, created_at, updated_at)
     VALUES (@id, @firstName, @lastName, @nsid, @college, @discipline, @degree, @program, @yearInProgram, @enrolTerm, @notes, @createdAt, @updatedAt)`
  ).run({
    id,
    firstName: input.firstName,
    lastName: input.lastName,
    nsid: normalizeNsid(input.nsid) ?? null,
    college: input.college ?? null,
    discipline: input.discipline ?? null,
    degree: input.degree ?? null,
    program: input.program ?? null,
    yearInProgram: input.yearInProgram ?? null,
    enrolTerm: input.enrolTerm ?? null,
    notes: null,
    createdAt: now,
    updatedAt: now
  })
  if (input.email) addEmail(id, input.email)
  if (input.phone) addPhone(id, input.phone)
  return id
}

export function updateStudent(
  id: string,
  fields: Partial<{
    firstName: string
    lastName: string
    nsid: string | null
    college: string | null
    discipline: string | null
    degree: string | null
    program: string | null
    yearInProgram: string | null
    enrolTerm: 'fall' | 'winter' | null
    position: string | null
    positionUrl: string | null
    positionFoundAt: string | null
    positionOrg: string | null
    positionSince: string | null
    notes: string | null
  }>
): void {
  const db = getDb()
  const current = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as StudentRow | undefined
  if (!current) throw new Error(`Student ${id} not found`)
  const merged = {
    firstName: fields.firstName ?? current.first_name,
    lastName: fields.lastName ?? current.last_name,
    nsid: fields.nsid !== undefined ? normalizeNsid(fields.nsid) : current.nsid,
    college: fields.college !== undefined ? fields.college : current.college,
    discipline: fields.discipline !== undefined ? fields.discipline : current.discipline,
    degree: fields.degree !== undefined ? fields.degree : current.degree,
    program: fields.program !== undefined ? fields.program : current.program,
    yearInProgram:
      fields.yearInProgram !== undefined ? fields.yearInProgram : current.year_in_program,
    enrolTerm: fields.enrolTerm !== undefined ? fields.enrolTerm : current.enrol_term,
    position: fields.position !== undefined ? fields.position : current.position,
    positionUrl: fields.positionUrl !== undefined ? fields.positionUrl : current.position_url,
    positionFoundAt: fields.positionFoundAt !== undefined ? fields.positionFoundAt : current.position_found_at,
    positionOrg: fields.positionOrg !== undefined ? fields.positionOrg : current.position_org,
    positionSince: fields.positionSince !== undefined ? fields.positionSince : current.position_since,
    notes: fields.notes !== undefined ? fields.notes : current.notes,
    updatedAt: new Date().toISOString(),
    id
  }
  db.prepare(
    `UPDATE students SET first_name=@firstName, last_name=@lastName, nsid=@nsid, college=@college,
       discipline=@discipline, degree=@degree, program=@program, year_in_program=@yearInProgram,
       enrol_term=@enrolTerm, position=@position, position_url=@positionUrl,
       position_found_at=@positionFoundAt, position_org=@positionOrg, position_since=@positionSince,
       notes=@notes, updated_at=@updatedAt WHERE id=@id`
  ).run(merged)
}

export function addEmail(studentId: string, email: string): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const db = getDb()
  const existing = db.prepare('SELECT student_id FROM student_emails WHERE email = ?').get(normalized) as
    | { student_id: string }
    | undefined
  if (existing) return existing.student_id === studentId
  db.prepare('INSERT INTO student_emails (id, student_id, email) VALUES (?, ?, ?)').run(
    newId(),
    studentId,
    normalized
  )
  return true
}

export function addPhone(studentId: string, phone: string): void {
  const normalized = normalizePhone(phone)
  if (!normalized) return
  const db = getDb()
  db.prepare(
    'INSERT OR IGNORE INTO student_phones (id, student_id, phone) VALUES (?, ?, ?)'
  ).run(newId(), studentId, normalized)
}

export function addAttendance(
  studentId: string,
  eventId: string,
  extraFields: Record<string, string> = {}
): 'created' | 'exists' {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM attendances WHERE student_id = ? AND event_id = ?')
    .get(studentId, eventId)
  if (existing) return 'exists'
  db.prepare(
    'INSERT INTO attendances (id, student_id, event_id, extra_fields, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(newId(), studentId, eventId, JSON.stringify(extraFields), new Date().toISOString())
  return 'created'
}

export function removeAttendance(attendanceId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM attendances WHERE id = ?').run(attendanceId)
}

export function deleteStudent(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM students WHERE id = ?').run(id)
}

/**
 * Merges `mergeId` into `keepId`: moves emails, phones and attendances over
 * (skipping ones that already exist on keepId), fills in any blank fields on
 * keepId from mergeId, deletes mergeId, and clears duplicate flags that involved mergeId.
 */
export function mergeStudents(keepId: string, mergeId: string): void {
  if (keepId === mergeId) return
  const db = getDb()
  const keep = getStudentById(keepId)
  const merge = getStudentById(mergeId)
  if (!keep || !merge) throw new Error('Both students must exist to merge')

  const tx = db.transaction(() => {
    // NSIDs are unique, so release mergeId's before it can be copied onto keepId.
    db.prepare('UPDATE students SET nsid = NULL WHERE id = ?').run(mergeId)

    // Fill in blanks on the surviving record.
    updateStudent(keepId, {
      nsid: keep.nsid ?? merge.nsid ?? undefined,
      college: keep.college ?? merge.college ?? undefined,
      discipline: keep.discipline ?? merge.discipline ?? undefined,
      degree: keep.degree ?? merge.degree ?? undefined,
      program: keep.program ?? merge.program ?? undefined,
      yearInProgram: keep.yearInProgram ?? merge.yearInProgram ?? undefined,
      enrolTerm: keep.enrolTerm ?? merge.enrolTerm ?? undefined,
      ...(keep.position || !merge.position
        ? {}
        : {
            position: merge.position,
            positionUrl: merge.positionUrl,
            positionFoundAt: merge.positionFoundAt,
            positionOrg: merge.positionOrg,
            positionSince: merge.positionSince
          }),
      notes: [keep.notes, merge.notes].filter(Boolean).join(' | ') || undefined
    })

    for (const email of merge.emails) {
      db.prepare('DELETE FROM student_emails WHERE student_id = ? AND email = ?').run(mergeId, email)
      addEmail(keepId, email)
    }
    for (const phone of merge.phones) {
      db.prepare('DELETE FROM student_phones WHERE student_id = ? AND phone = ?').run(mergeId, phone)
      addPhone(keepId, phone)
    }

    const attendances = db
      .prepare('SELECT id, event_id, extra_fields FROM attendances WHERE student_id = ?')
      .all(mergeId) as { id: string; event_id: string; extra_fields: string | null }[]
    for (const a of attendances) {
      const already = db
        .prepare('SELECT id FROM attendances WHERE student_id = ? AND event_id = ?')
        .get(keepId, a.event_id)
      if (!already) {
        db.prepare('UPDATE attendances SET student_id = ? WHERE id = ?').run(keepId, a.id)
      } else {
        db.prepare('DELETE FROM attendances WHERE id = ?').run(a.id)
      }
    }

    // Only suggestions involving the removed record are now stale — keepId's
    // pending suggestions against other students still need review.
    db.prepare('DELETE FROM possible_duplicates WHERE student_a_id = ? OR student_b_id = ?').run(
      mergeId,
      mergeId
    )

    db.prepare('DELETE FROM students WHERE id = ?').run(mergeId)
  })
  tx()
}

import { newId } from '../ids'
import { getDb } from './index'
import type { CourseStatus, StudentCourse } from '../../shared/types'

/**
 * What each student has taken, and how it went.
 *
 * One row per student per course per term, so a course repeated in a later
 * term is its own record and re-importing the same class list updates the
 * row rather than adding another.
 */

interface CourseRow {
  id: string
  student_id: string
  course_code: string
  term: string
  term_label: string | null
  credit_units: number | null
  grade: string | null
  reg_status: string | null
  status: string
  source_file: string | null
  created_at: string
  updated_at: string
}

function toCourse(row: CourseRow): StudentCourse {
  return {
    id: row.id,
    studentId: row.student_id,
    courseCode: row.course_code,
    term: row.term || null,
    termLabel: row.term_label,
    creditUnits: row.credit_units,
    grade: row.grade,
    regStatus: row.reg_status,
    status: row.status as CourseStatus,
    sourceFile: row.source_file
  }
}

export interface RecordCourseInput {
  studentId: string
  courseCode: string
  term: string
  termLabel?: string | null
  creditUnits?: number | null
  grade?: string | null
  regStatus?: string | null
  status: CourseStatus
  sourceFile?: string | null
}

/**
 * Writes one student's standing in one course, replacing what was there for
 * that term. Re-importing a class list after grades are posted is the normal
 * way this gets used, so a later import always wins.
 */
export function recordStudentCourse(input: RecordCourseInput): void {
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO student_courses
         (id, student_id, course_code, term, term_label, credit_units, grade,
          reg_status, status, source_file, created_at, updated_at)
       VALUES
         (@id, @studentId, @courseCode, @term, @termLabel, @creditUnits, @grade,
          @regStatus, @status, @sourceFile, @now, @now)
       ON CONFLICT(student_id, course_code, term) DO UPDATE SET
         term_label   = excluded.term_label,
         credit_units = excluded.credit_units,
         grade        = excluded.grade,
         reg_status   = excluded.reg_status,
         status       = excluded.status,
         source_file  = excluded.source_file,
         updated_at   = excluded.updated_at`
    )
    .run({
      id: newId(),
      studentId: input.studentId,
      courseCode: input.courseCode,
      term: input.term,
      termLabel: input.termLabel ?? null,
      creditUnits: input.creditUnits ?? null,
      grade: input.grade ?? null,
      regStatus: input.regStatus ?? null,
      status: input.status,
      sourceFile: input.sourceFile ?? null,
      now
    })
}

/** Every course on one student's record, newest term first. */
export function listStudentCourses(studentId: string): StudentCourse[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM student_courses
       WHERE student_id = ?
       ORDER BY term DESC, course_code ASC`
    )
    .all(studentId) as CourseRow[]
  return rows.map(toCourse)
}

/** Every course code on record, with how many students have taken each. */
export function listCourseCodes(): { courseCode: string; students: number; completed: number }[] {
  return getDb()
    .prepare(
      `SELECT course_code AS courseCode,
              COUNT(DISTINCT student_id) AS students,
              COUNT(DISTINCT CASE WHEN status = 'completed' THEN student_id END) AS completed
       FROM student_courses
       GROUP BY course_code
       ORDER BY course_code ASC`
    )
    .all() as { courseCode: string; students: number; completed: number }[]
}

export function deleteStudentCourse(id: string): void {
  getDb().prepare('DELETE FROM student_courses WHERE id = ?').run(id)
}

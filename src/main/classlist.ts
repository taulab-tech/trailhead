import * as XLSX from 'xlsx'
import type { CourseStatus } from '../shared/types'

/**
 * Registrar class lists.
 *
 * These exports aren't plain rosters: above the student table sits a block of
 * label/value rows naming the course, the term and the CRN, and the table
 * itself carries each student's registration status, credit units and final
 * grade. That is the record of who actually completed which course, which is
 * what certificate progress is computed from — so it's worth reading properly
 * rather than treating the file as another attendance sheet.
 *
 *     Course Information
 *     Course Title   Capstone Design Project - GE 495 01
 *     Term           2025 Fall Term - 202509
 *     CRN            86478
 *     Duration       03/Sep/2025 - 07/Apr/2026
 *     ...
 *     Summary Class List
 *     Student Name | ID | Registration Status | Level | Credit Units | Midterm | Original Final Grade | Class
 */

/** The mark at or above which a numeric grade counts as a pass. */
export const PASS_MARK = 50

export interface ClasslistCourse {
  /** Subject and number, e.g. "GE 495". */
  code: string
  /** The course name with the code stripped off, e.g. "Capstone Design Project". */
  title: string | null
  /** Section, e.g. "01". */
  section: string | null
  /** The registrar's term stamp, e.g. "202509". Empty when the file omits it. */
  term: string
  /** The term as written, e.g. "2025 Fall Term". */
  termLabel: string | null
  crn: string | null
}

export type { CourseStatus }

export interface CourseEnrolment {
  creditUnits: number | null
  grade: string | null
  regStatus: string | null
  classYear: string | null
  status: CourseStatus
}

const HEADER_BLOCK_ROWS = 40

/** Reads the `label | value` rows that sit above the student table. */
function readHeaderBlock(ws: XLSX.WorkSheet, range: XLSX.Range, headerRow: number): Map<string, string> {
  const block = new Map<string, string>()
  const end = Math.min(headerRow - 1, range.s.r + HEADER_BLOCK_ROWS)

  for (let r = range.s.r; r <= end; r++) {
    const cellAt = (c: number): string => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      const raw = cell ? (cell.w ?? cell.v) : undefined
      return raw === undefined || raw === null ? '' : String(raw).trim()
    }
    const label = cellAt(range.s.c)
    if (!label) continue
    // The value is in the next populated cell along, since these exports pad
    // the block out to the width of the table below.
    for (let c = range.s.c + 1; c <= range.e.c; c++) {
      const value = cellAt(c)
      if (value) {
        block.set(label.toLowerCase(), value)
        break
      }
    }
  }
  return block
}

/**
 * Pulls the course code out of a title like
 * "Capstone Design Project - GE 495 01". The registrar always appends it, so
 * this is more reliable than the file name — which sometimes drops the
 * subject ("202309_86478_classlist 495.xls").
 */
function splitCourseTitle(raw: string): { code: string; title: string | null; section: string | null } | null {
  const match = raw.match(/^(.*?)[\s-]*\b([A-Za-z]{2,5})\s*(\d{3,4})(?:\s+(\d{1,3}))?\s*$/)
  if (!match) return null
  const [, name, subject, number, section] = match
  return {
    code: `${subject.toUpperCase()} ${number}`,
    title: name.replace(/[\s-]+$/, '').trim() || null,
    section: section ?? null
  }
}

/** Splits "2025 Fall Term - 202509" into its label and its stamp. */
function splitTerm(raw: string): { term: string; termLabel: string | null } {
  const match = raw.match(/^(.*?)\s*-\s*(\d{6})\s*$/)
  if (!match) return { term: '', termLabel: raw || null }
  return { term: match[2], termLabel: match[1].trim() || null }
}

/**
 * Reads the course this sheet is a roster for, or null if it isn't one.
 *
 * `fileName` is the fallback for the course code, for the handful of exports
 * whose title is missing or unparseable.
 */
export function readClasslistCourse(
  ws: XLSX.WorkSheet,
  headerRow: number,
  fileName: string,
  fallbackCode: string | null
): ClasslistCourse | null {
  const ref = ws['!ref']
  if (!ref) return null
  const range = XLSX.utils.decode_range(ref)
  if (headerRow <= range.s.r) return null // nothing above the table

  const block = readHeaderBlock(ws, range, headerRow)
  const rawTitle = block.get('course title')
  const rawTerm = block.get('term')
  // Both of these are present in every registrar export; a sheet with
  // neither is some other spreadsheet that happens to have rows above its
  // header, and is left to the ordinary import path.
  if (!rawTitle && !rawTerm) return null

  const parsedTitle = rawTitle ? splitCourseTitle(rawTitle) : null
  const code = parsedTitle?.code ?? fallbackCode
  if (!code) return null

  const { term, termLabel } = rawTerm ? splitTerm(rawTerm) : { term: '', termLabel: null }

  return {
    code,
    title: parsedTitle?.title ?? rawTitle ?? null,
    section: parsedTitle?.section ?? null,
    // Failing that, the file name is stamped with the term it was pulled for.
    term: term || (fileName.match(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(?!\d)/)?.[0] ?? ''),
    termLabel,
    crn: block.get('crn') ?? null
  }
}

/** Header names the registrar uses, lowercased, mapped to what they mean. */
const COLUMN_ROLES: Record<string, keyof Omit<CourseEnrolment, 'status'>> = {
  'credit units': 'creditUnits',
  'original final grade': 'grade',
  'final grade': 'grade',
  grade: 'grade',
  'registration status': 'regStatus',
  class: 'classYear'
}

function columnFor(headers: string[], role: string): string | undefined {
  return headers.find((h) => COLUMN_ROLES[h.toLowerCase().trim()] === role)
}

/**
 * Strips the placeholders the registrar writes where a value doesn't exist
 * yet — "Not Available" in a grade column, "Not applicable" in the year-of-
 * study column — so they never get saved as if they were real values.
 */
export function meaningfulValue(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  if (!text) return null
  return /^not (available|applicable)$/i.test(text) ? null : text
}

/**
 * Works out where a student stands in the course this row belongs to.
 *
 * The rule: a numeric mark of {@link PASS_MARK} or better, or a `P`, is a
 * pass. Registered with no mark yet is in progress. Auditing earns no credit
 * whatever the row says, so it's recorded as such and counts towards nothing.
 */
export function courseStatusFor(grade: string | null, regStatus: string | null): CourseStatus {
  const auditing = /\bau\b|audit/i.test(regStatus ?? '') || /^au$/i.test(grade ?? '')
  if (auditing) return 'audited'

  if (!grade) {
    // No mark recorded. Registered means the term is still running; anything
    // else (withdrawn, dropped, deleted) means they aren't taking it.
    return /^registered/i.test(regStatus ?? '') ? 'in_progress' : 'not_completed'
  }
  if (/^p$/i.test(grade) || /^(cr|pass)$/i.test(grade)) return 'completed'

  const mark = Number(grade)
  if (Number.isFinite(mark)) return mark >= PASS_MARK ? 'completed' : 'not_completed'

  // An unrecognised letter grade (F, W, INC, …) isn't a pass.
  return 'not_completed'
}

/** Reads the course-specific columns out of one already-parsed roster row. */
export function readCourseEnrolment(headers: string[], row: Record<string, string>): CourseEnrolment {
  const read = (role: keyof Omit<CourseEnrolment, 'status'>): string | null => {
    const column = columnFor(headers, role)
    return column ? meaningfulValue(row[column]) : null
  }

  const rawUnits = read('creditUnits')
  const units = rawUnits === null ? null : Number(rawUnits)
  const grade = read('grade')
  const regStatus = read('regStatus')

  return {
    creditUnits: units !== null && Number.isFinite(units) ? units : null,
    grade,
    regStatus,
    classYear: read('classYear'),
    status: courseStatusFor(grade, regStatus)
  }
}

/** True if this sheet's headers look like the registrar's student table. */
export function hasClasslistColumns(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase().trim())
  return lower.includes('student name') && lower.includes('registration status')
}

import * as XLSX from 'xlsx'
import { readWorkbook, workbookBaseName } from './workbooks'
import { findOrCreateEvent } from './db/events'
import { addAttendance, getStudentById } from './db/students'
import { getDb } from './db/index'
import { findCategoryByName } from './db/categories'
import { detectFuzzyDuplicates, matchStudent, newMatchContext } from './matching'
import { normalizeEmail, normalizePhone, titleCase } from './normalize'
import { enrolDateFor, parseEnrolTerm, parseEnrolYear, parseYearMonthStamp } from './enrolDate'
import {
  hasClasslistColumns,
  meaningfulValue,
  readClasslistCourse,
  readCourseEnrolment,
  type ClasslistCourse
} from './classlist'
import { recordStudentCourse } from './db/courses'
import type {
  ColumnMapping,
  FieldUpdate,
  ImportEventSummary,
  ImportPreview,
  ImportResult,
  ImportSheetRequest,
  MappableField,
  ParsedSheet,
  ParsedWorkbook,
  RowOutcome
} from '../shared/types'

function detectMapping(headers: string[], rows: Record<string, string>[] = []): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const header of headers) {
    const h = header.toLowerCase().trim()
    let field: MappableField = 'ignore'

    if (['nsid', 'id', 'student id', 'student number', 'student no', 'student #', 'student no.'].includes(h)) field = 'nsid'
    else if (h.includes('year')) field = 'yearInProgram'
    else if (h.includes('email')) field = 'email'
    else if (h.includes('phone') || h.includes('cell')) field = 'phone'
    else if (h.includes('college') && (h.includes('discipline') || h.includes('degree'))) field = 'discipline'
    else if (h.includes('first name') || h === 'first') field = 'firstName'
    else if (h.includes('last name') || h === 'last' || h.includes('surname')) field = 'lastName'
    else if (h === 'name' || h.includes('student name') || h.includes('full name')) field = 'fullName'
    else if (h.includes('college')) field = 'college'
    else if (h.includes('degree')) field = 'degree'
    else if (h.includes('discipline') || h.includes('major')) field = 'discipline'
    else if (h.includes('linkedin')) field = 'positionUrl'
    // "affiliate company" is what the alumni tracker calls the employer.
    else if (h.includes('organisation') || h.includes('organization') || h.includes('affiliate company'))
      field = 'positionOrg'
    else if (h.includes('position') || h.includes('job title')) field = 'position'
    else if (h.includes('cohort')) field = 'cohortYear'
    else if (h.includes('program')) field = 'program'

    mapping[header] = field
  }

  // A bare "ID" header is often just a spreadsheet row counter (1, 2, 3, …),
  // not a student identifier — treating it as NSID would link unrelated
  // students across sheets that happen to share row numbers.
  for (const header of headers) {
    if (header.toLowerCase().trim() !== 'id' || mapping[header] !== 'nsid') continue
    if (looksLikeRowNumbers(rows.map((r) => r[header] ?? ''))) mapping[header] = 'ignore'
  }

  // Cohort trackers sometimes carry the enrol year in a column with no
  // header text at all (a bare "2021"/"2022"/… column next to an unlabeled
  // index column) — nothing in the header name signals what it is, so the
  // loop above leaves it as 'ignore' and commitImport's year-split never
  // triggers. If no column was already recognized as the year column, sniff
  // actual cell values instead: a column whose values are almost all bare
  // 4-digit years is treated as the year column.
  if (rows.length > 0 && !Object.values(mapping).includes('yearInProgram')) {
    for (const header of headers) {
      if (mapping[header] !== 'ignore') continue
      if (looksLikeYearColumn(rows.map((r) => r[header] ?? ''))) {
        mapping[header] = 'yearInProgram'
        break
      }
    }
  }

  return mapping
}

/** True if a column's values are all small whole numbers (1–9999), i.e. a row counter rather than an ID. */
function looksLikeRowNumbers(values: string[]): boolean {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== '')
  if (nonEmpty.length < 2) return false
  return nonEmpty.every((v) => /^\d{1,4}$/.test(v))
}

/** True if a column's values are almost entirely bare 4-digit years (e.g. "2021", "2022"). */
function looksLikeYearColumn(values: string[]): boolean {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== '')
  if (nonEmpty.length < 2) return false
  const yearLike = nonEmpty.filter((v) => /^(19|20)\d{2}$/.test(v))
  return yearLike.length / nonEmpty.length >= 0.9
}

/**
 * Surfaces the same year-split commitImport will actually perform, so the
 * import staging screen can tell the user up front ("will split into 5
 * events by year") instead of only revealing it after they've already
 * clicked Import — a single mixed-year sheet otherwise looks identical to a
 * plain one-event sheet at this stage.
 */
function yearSplitPreview(
  headers: string[],
  rows: Record<string, string>[],
  mapping: ColumnMapping
): { column: string; years: number[] } | null {
  const yearCol = headers.find((h) => mapping[h] === 'yearInProgram')
  if (!yearCol) return null
  const years = new Set<number>()
  for (const row of rows) {
    const year = parseEnrolYear(row[yearCol])
    if (year) years.add(year)
  }
  if (years.size < 2) return null
  return { column: yearCol, years: Array.from(years).sort((a, b) => a - b) }
}

const MAX_HEADER_SCAN_ROWS = 40

/**
 * Registrar/SIS exports often prepend several metadata rows above the real
 * column-header row — course title, term, CRN, enrollment counts, a
 * "Summary Class List" label, etc. — each of which has only one or two
 * populated cells (a label and a value). The real header row stands out as
 * the first row whose cells actually match fields we know how to import
 * (name, email, ID, …); if nothing scans as a header, row 1 is kept as the
 * fallback so already-working plain sheets are unaffected.
 */
function findHeaderRow(ws: XLSX.WorkSheet, range: XLSX.Range): number {
  let bestRow = range.s.r
  let bestScore = -1
  const scanEnd = Math.min(range.e.r, range.s.r + MAX_HEADER_SCAN_ROWS)

  for (let r = range.s.r; r <= scanEnd; r++) {
    const cells: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      const raw = cell ? cell.w ?? cell.v : undefined
      const text = raw === undefined || raw === null ? '' : String(raw).trim()
      if (text) cells.push(text)
    }
    if (cells.length === 0) continue

    const recognized = Object.values(detectMapping(cells)).filter((f) => f !== 'ignore').length
    if (recognized === 0) continue

    const score = recognized * 10 + cells.length
    if (score > bestScore) {
      bestScore = score
      bestRow = r
    }
  }
  return bestRow
}

function sheetHeaders(ws: XLSX.WorkSheet, range: XLSX.Range, headerRow: number): string[] {
  const headers: string[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })]
    const raw = cell ? cell.w ?? cell.v : undefined
    const value = raw === undefined || raw === null ? '' : String(raw).trim()
    headers.push(value === '' ? `Column ${c - range.s.c + 1}` : value)
  }
  return headers
}

/**
 * A cell can display one thing and link to another. The contact trackers
 * are full of LinkedIn cells reading "Delaney Bonish | LinkedIn" with the
 * profile address hidden in the hyperlink, so the useful value is the
 * target, not the text.
 *
 * Only LinkedIn profile links are taken this way. A cell that happens to
 * be hyperlinked to anything else keeps the text somebody typed, which is
 * what every other column wants.
 */
function hyperlinkedProfile(ws: XLSX.WorkSheet, row: number, column: number): string | null {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined
  const target = cell?.l?.Target
  if (!target) return null
  return /^https?:\/\/[a-z.]*linkedin\.com\/(in|pub)\//i.test(target) ? target : null
}

function sheetRows(ws: XLSX.WorkSheet, headers: string[], headerRow: number): Record<string, string>[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: headers,
    range: headerRow + 1,
    defval: ''
  })
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null
  return rows
    .map((row, i) => {
      const out: Record<string, string> = {}
      headers.forEach((h, column) => {
        const link = range ? hyperlinkedProfile(ws, headerRow + 1 + i, range.s.c + column) : null
        const v = row[h]
        out[h] = link ?? (v === undefined || v === null ? '' : String(v).trim())
      })
      return out
    })
    .filter((r) => Object.values(r).some((v) => v !== ''))
}

/** Locates the real header row (see findHeaderRow) and parses headers + data rows relative to it. */
function parseSheet(ws: XLSX.WorkSheet): { headers: string[]; rows: Record<string, string>[] } {
  const ref = ws['!ref']
  if (!ref) return { headers: [], rows: [] }
  const range = XLSX.utils.decode_range(ref)
  const headerRow = findHeaderRow(ws, range)
  const headers = sheetHeaders(ws, range, headerRow)
  const rows = sheetRows(ws, headers, headerRow)
  return { headers, rows }
}

/** The id of the user's group with this name, if they have one — guesses never invent groups. */
function categoryId(name: string): string | null {
  return findCategoryByName(name)?.id ?? null
}

/** Best-effort guess at which funnel category a sheet belongs to, based on its name. */
function guessCategory(eventName: string, sheetName: string, fileName: string): string | null {
  const text = `${eventName} ${sheetName}`.toLowerCase()

  if (text.includes('hackathon')) return categoryId('Hackathon')
  if (/\b(inspiration|speaker|fireside|talk|seminar)\b/.test(text)) return categoryId('Inspiration Event')
  if (/\b(social|holiday|mixer|meet.?and.?greet)\b/.test(text)) return categoryId('Social')
  if (/\b(incubator|accelerator)\b/.test(text)) return categoryId('Program')
  // Bare course-code sheets (e.g. "431", "450") are class rosters.
  if (/^\d{3,4}$/.test(sheetName.trim())) return categoryId('Class')
  // Registrar "…classlist [SUBJ] <code>.xls" exports are always course rosters,
  // even when the sheet tab itself is just a generic "Class List Summary" label.
  if (classlistCourseCode(fileName)) return categoryId('Class')

  return null
}

/**
 * Registrar class-list exports are named like
 * "<yearmonth>_<CRN>_classlist[ SUBJ] <code>.xls" — the course number is
 * always the last number before the extension, optionally preceded by a
 * subject code ("CMPT 370", "GE490") — while the sheet tab itself carries no
 * course identity at all (just "Class List Summary"). When this pattern
 * matches, the filename is the authoritative source for both category and
 * event name. Returns e.g. "CMPT 370", or just "370" with no subject.
 */
function classlistCourseCode(fileName: string): string | null {
  const course = parseClasslistFileName(fileName)
  if (!course) return null
  return course.subject ? `${course.subject} ${course.number}` : course.number
}

function parseClasslistFileName(fileName: string): { subject: string | null; number: string } | null {
  const match = fileName.match(/classlist[\s_-]*(?:([a-z]{2,5})[\s_-]*)?(\d{3,4})\D*$/i)
  if (!match) return null
  return { subject: match[1] ? match[1].toUpperCase() : null, number: match[2] }
}

/**
 * Registrar exports aren't consistent about including the subject: the same
 * course arrives as "…classlist GE 495.xls" one term and "…classlist 495.xls"
 * the next, which would split it into "GE 495 2022" and "495 2023". When
 * every class-list event for a course number that does carry a subject
 * agrees on it, subject-less ones are renamed to match ("495 2023" →
 * "GE 495 2023"); if that name already exists — the same offering imported
 * under both names — the two events are merged. Numbers shared by several
 * subjects (CMPT 370 and MATH 370) are ambiguous and left alone, as are
 * events the user has renamed. Idempotent; runs on startup and after imports.
 */
export function harmonizeClasslistEventNames(): number {
  const db = getDb()
  const events = db
    .prepare("SELECT id, name, source_file, category_id FROM events WHERE source_file LIKE '%classlist%'")
    .all() as { id: string; name: string; source_file: string; category_id: string | null }[]

  const subjectsByNumber = new Map<string, Set<string>>()
  const bare: { id: string; name: string; number: string; categoryId: string | null }[] = []
  for (const e of events) {
    const course = parseClasslistFileName(e.source_file)
    if (!course) continue
    if (course.subject) {
      if (!subjectsByNumber.has(course.number)) subjectsByNumber.set(course.number, new Set())
      subjectsByNumber.get(course.number)!.add(course.subject)
    } else if (new RegExp(`^${course.number}( (19|20)\\d{2})?$`).test(e.name)) {
      bare.push({ id: e.id, name: e.name, number: course.number, categoryId: e.category_id })
    }
  }

  const findByName = db.prepare('SELECT id, category_id FROM events WHERE lower(name) = lower(?) AND id != ?')
  const rename = db.prepare('UPDATE events SET name = ? WHERE id = ?')
  const moveAttendances = db.prepare(
    `UPDATE attendances SET event_id = ? WHERE event_id = ?
       AND student_id NOT IN (SELECT student_id FROM attendances WHERE event_id = ?)`
  )
  const fillCategory = db.prepare('UPDATE events SET category_id = ? WHERE id = ? AND category_id IS NULL')
  const deleteEvent = db.prepare('DELETE FROM events WHERE id = ?')

  let changed = 0
  const tx = db.transaction(() => {
    for (const e of bare) {
      const subjects = subjectsByNumber.get(e.number)
      if (!subjects || subjects.size !== 1) continue
      const target = `${[...subjects][0]} ${e.name}`
      const existing = findByName.get(target, e.id) as { id: string; category_id: string | null } | undefined
      if (existing) {
        moveAttendances.run(existing.id, e.id, existing.id)
        if (e.categoryId) fillCategory.run(e.categoryId, existing.id)
        deleteEvent.run(e.id)
      } else {
        rename.run(target, e.id)
      }
      changed++
    }
  })
  tx()
  return changed
}

/**
 * Event-signup exports are often named "<MM_DD_YYYY> <Event Name>.xlsx"
 * (e.g. "03_15_2026 Agtech Hackathon.xlsx") — an exact date stamp prefix
 * followed by the real event name, with the sheet tab itself usually just a
 * generic "Sheet1". Anchored to the start of the filename so it can't
 * collide with the registrar "<yearmonth>_<CRN>_classlist…" convention,
 * which never starts with a valid month.
 */
function parseFileNameDateAndName(fileName: string): { date: string; name: string } | null {
  const base = fileName.replace(/\.[^.]+$/, '')
  const match = base.match(/^(0[1-9]|1[0-2])[_.\-/](0[1-9]|[12]\d|3[01])[_.\-/](\d{4})[\s_-]+(.+)$/)
  if (!match) return null
  const [, mm, dd, yyyy, rest] = match
  return { date: `${yyyy}-${mm}-${dd}`, name: rest.trim() }
}

/**
 * Best-effort guess at the event's date from the sheet/file/event name. An
 * explicit "MM_DD_YYYY" filename stamp is the most precise signal available
 * and wins outright. Otherwise an explicit "Fall 2024"/"Winter 2024" marker
 * is tried first, falling back to a registrar-style "202209" year-month
 * stamp commonly found in export filenames.
 */
function guessDate(eventName: string, sheetName: string, fileName: string): string | null {
  const exact = parseFileNameDateAndName(fileName)
  if (exact) return exact.date

  const text = `${eventName} ${sheetName} ${fileName}`

  const year = parseEnrolYear(text)
  const term = parseEnrolTerm(text)
  if (year && term) return enrolDateFor(year, term)

  const stamp = parseYearMonthStamp(text)
  if (stamp) return enrolDateFor(stamp.year, stamp.term)

  return null
}

function deriveEventName(sheetName: string, fileName: string): string {
  const courseCode = classlistCourseCode(fileName)
  if (courseCode) {
    // Include the term year so "CMPT 370" from three different terms doesn't
    // collapse into one merged event — findOrCreateEvent matches by exact
    // name, so distinct offerings need distinct names.
    const stamp = parseYearMonthStamp(fileName)
    return stamp ? `${courseCode} ${stamp.year}` : courseCode
  }

  const dated = parseFileNameDateAndName(fileName)
  if (dated) {
    // Same reasoning as the course case above: an annually-recurring
    // event name ("Agtech Hackathon" in 2024, 2025, 2026, …) would otherwise
    // collapse every year into one merged event.
    return `${dated.name} ${dated.date.slice(0, 4)}`
  }

  if (/^sheet\s*\d*$/i.test(sheetName.trim())) {
    const base = fileName.replace(/\.[^.]+$/, '')
    const parenMatch = base.match(/\(([^)]+)\)/)
    // Only trust parenthetical content as the name if it's not just a
    // duplicate-download marker like "(1)" or "(2)".
    if (parenMatch && !/^\d+$/.test(parenMatch[1].trim())) {
      return parenMatch[1].trim()
    }
    return base.replace(/\s*\(\d+\)\s*$/, '').trim()
  }
  return sheetName.trim()
}

/**
 * A LinkedIn column holds anything from a full URL to a bare handle to the
 * person's name as the link text. Only something that is actually a profile
 * address is worth keeping.
 */
function linkedInUrl(raw: string | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const match = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s"'<>,)]+/i)
  if (!match) return null
  const url = match[0].replace(/[.,;]+$/, '')
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** "202509" as a date, so a class list can be dated by its term. */
function termDate(term: string): string | null {
  const match = term.match(/^(\d{4})(\d{2})$/)
  return match ? `${match[1]}-${match[2]}-01` : null
}

/**
 * Reads the course a sheet is a roster for, or null if it isn't one.
 *
 * Both halves have to agree: the block above the table has to name a course,
 * and the table itself has to have the registrar's columns. A sheet with
 * only one of those is some other spreadsheet and goes down the ordinary
 * attendance path.
 */
function classlistCourseFor(
  ws: XLSX.WorkSheet,
  headers: string[],
  fileName: string
): ClasslistCourse | null {
  if (!hasClasslistColumns(headers)) return null
  const ref = ws['!ref']
  if (!ref) return null
  const range = XLSX.utils.decode_range(ref)
  return readClasslistCourse(ws, findHeaderRow(ws, range), fileName, classlistCourseCode(fileName))
}

/**
 * On a class list the "Class" column is the student's year of study
 * ("Fourth Year"), which the generic header matching has no way to know —
 * the word on its own means too many things.
 */
function applyClasslistMapping(headers: string[], mapping: ColumnMapping): void {
  if (Object.values(mapping).includes('yearInProgram')) return
  const classColumn = headers.find((h) => h.toLowerCase().trim() === 'class')
  if (classColumn) mapping[classColumn] = 'yearInProgram'
}

export function parseWorkbookForPreview(filePath: string): ParsedWorkbook {
  const fileName = workbookBaseName(filePath)
  const workbook = readWorkbook(filePath)
  const sheets: ParsedSheet[] = []

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const { headers, rows } = parseSheet(ws)
    if (headers.length === 0) continue

    const suggestedEventName = deriveEventName(sheetName, fileName)
    const suggestedCategoryId = guessCategory(suggestedEventName, sheetName, fileName)
    const course = classlistCourseFor(ws, headers, fileName)
    const suggestedMapping = detectMapping(headers, rows)
    if (course) applyClasslistMapping(headers, suggestedMapping)
    sheets.push({
      sheetName,
      suggestedEventName,
      suggestedDate: guessDate(suggestedEventName, sheetName, fileName),
      suggestedCategoryId,
      headers,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
      rows,
      suggestedMapping,
      yearSplitPreview: yearSplitPreview(headers, rows, suggestedMapping),
      course: course && {
        code: course.code,
        title: course.title,
        term: course.term || null,
        termLabel: course.termLabel
      }
    })
  }

  return { fileName, filePath, sheets }
}

/** Thrown at the end of a dry run so the transaction rolls every write back. */
class DryRunRollback extends Error {}

export function commitImport(request: ImportSheetRequest): ImportResult {
  return runSheetImport(request, false).result
}

/**
 * Runs the real import for `request` and then rolls it back, reporting what
 * would happen to each row — so the preview always agrees with the import.
 */
export function previewImport(request: ImportSheetRequest): ImportPreview {
  const { result, rowOutcomes, proposed } = runSheetImport(request, true)
  return {
    rows: rowOutcomes,
    newStudents: result.newStudents,
    matchedExisting: result.matchedExisting,
    skippedBlankRows: result.skippedBlankRows,
    newDuplicateSuggestions: result.newDuplicateSuggestions,
    updates: proposed,
    blanksFilled: result.blanksFilled
  }
}

function runSheetImport(
  request: ImportSheetRequest,
  dryRun: boolean
): { result: ImportResult; rowOutcomes: RowOutcome[]; proposed: FieldUpdate[] } {
  // Rows edited on the review screen are imported as given; otherwise the
  // sheet is read fresh from the file. The mapping always lists every header.
  let headers: string[]
  let rows: Record<string, string>[]
  let worksheet: XLSX.WorkSheet | undefined
  if (request.rows) {
    headers = Object.keys(request.mapping)
    rows = request.rows
    // The rows came from the review screen, but the course still has to be
    // read off the sheet itself. Losing the file here only costs the course
    // record, so it isn't worth failing the import over.
    try {
      worksheet = readWorkbook(request.filePath).Sheets[request.sheetName]
    } catch {
      worksheet = undefined
    }
  } else {
    const workbook = readWorkbook(request.filePath)
    const ws = workbook.Sheets[request.sheetName]
    if (!ws) throw new Error(`Sheet "${request.sheetName}" not found in ${request.fileName}`)
    worksheet = ws
    ;({ headers, rows } = parseSheet(ws))
  }

  const course = worksheet ? classlistCourseFor(worksheet, headers, request.fileName) : null

  // When this sheet's data was true. A class list is dated by its term; any
  // other roster by the event's date. Without one, nothing already on record
  // can be shown to be out of date, so nothing is replaced.
  const observedAt = course ? termDate(course.term) ?? request.eventDate : request.eventDate
  const context = newMatchContext(
    observedAt,
    request.fileName,
    new Set(request.rejectedUpdates ?? [])
  )

  const emailColumns = headers.filter((h) => request.mapping[h] === 'email')
  const phoneColumns = headers.filter((h) => request.mapping[h] === 'phone')
  const firstNameCol = headers.find((h) => request.mapping[h] === 'firstName')
  const lastNameCol = headers.find((h) => request.mapping[h] === 'lastName')
  const fullNameCol = headers.find((h) => request.mapping[h] === 'fullName')
  const nsidCol = headers.find((h) => request.mapping[h] === 'nsid')
  const collegeCol = headers.find((h) => request.mapping[h] === 'college')
  const disciplineCol = headers.find((h) => request.mapping[h] === 'discipline')
  const degreeCol = headers.find((h) => request.mapping[h] === 'degree')
  const programCol = headers.find((h) => request.mapping[h] === 'program')
  const yearCol = headers.find((h) => request.mapping[h] === 'yearInProgram')
  const cohortCol = headers.find((h) => request.mapping[h] === 'cohortYear')
  const positionCol = headers.find((h) => request.mapping[h] === 'position')
  const positionOrgCol = headers.find((h) => request.mapping[h] === 'positionOrg')
  const positionUrlCol = headers.find((h) => request.mapping[h] === 'positionUrl')
  const ignoredColumns = headers.filter((h) => request.mapping[h] === 'ignore')

  // Rosters with a mapped year column often get exported as one sheet
  // spanning several cohorts (a "831" class export with a mixed 2020-2025
  // Enrol Year column, or a program cohort tracker listing every year's
  // members in one sheet). Split those into one event per distinct year
  // found in that column ("831 2024", "831 2025", …) instead
  // of dumping every cohort into a single event. This isn't limited to any
  // one category — rows whose year cell doesn't parse as a real calendar
  // year just fall back to the single sheet-level event below, so enabling
  // it broadly is safe. Each split year is dated to its Fall/Winter term.
  const splitByYear = !!yearCol
  const eventSummaries = new Map<string, ImportEventSummary>()
  const eventIds = new Map<string, string>()

  function dateForSplitYear(year: number, rawYear: string): string {
    const term = parseEnrolTerm(rawYear) ?? 'fall'
    return enrolDateFor(year, term)
  }

  function eventIdForRow(rawYear: string | null): { eventId: string; eventName: string } {
    if (splitByYear && rawYear) {
      const year = parseEnrolYear(rawYear)
      if (year) {
        const name = `${request.eventName} ${year}`.trim()
        let id = eventIds.get(name)
        if (!id) {
          id = findOrCreateEvent(
            name,
            dateForSplitYear(year, rawYear),
            request.fileName,
            request.sheetName,
            request.categoryId
          )
          eventIds.set(name, id)
        }
        return { eventId: id, eventName: name }
      }
    }
    let id = eventIds.get(request.eventName)
    if (!id) {
      id = findOrCreateEvent(
        request.eventName,
        request.eventDate,
        request.fileName,
        request.sheetName,
        request.categoryId
      )
      eventIds.set(request.eventName, id)
    }
    return { eventId: id, eventName: request.eventName }
  }

  let rowsProcessed = 0
  let newStudents = 0
  let matchedExisting = 0
  let skippedBlankRows = 0
  const touchedIds = new Set<string>()
  const rowOutcomes: RowOutcome[] = []
  // Students created by this sheet, by the row that created them, so a later
  // row for the same person reads as a repeat rather than an existing record.
  const createdByRow = new Map<string, number>()

  // One transaction for the whole sheet: a failure partway through rolls back
  // every student/event/attendance it touched instead of leaving half a
  // roster imported (and it's far faster than autocommitting each row).
  const runImport = getDb().transaction((): number => {
    for (const [rowIndex, row] of rows.entries()) {
      let firstName = firstNameCol ? row[firstNameCol] : ''
      let lastName = lastNameCol ? row[lastNameCol] : ''
      if (!firstName && !lastName && fullNameCol && row[fullNameCol]) {
        const raw = row[fullNameCol].trim()
        if (raw.includes(',')) {
          // "Last, First" format (common in official roster exports)
          const [last, first] = raw.split(',').map((s) => s.trim())
          lastName = last ?? ''
          firstName = first ?? ''
        } else {
          const parts = raw.split(/\s+/)
          firstName = parts[0] ?? ''
          lastName = parts.slice(1).join(' ') ?? ''
        }
      }
      firstName = titleCase(firstName)
      lastName = titleCase(lastName)

      const emails = emailColumns
        .map((c) => normalizeEmail(row[c]))
        .filter((e): e is string => !!e)
      const phones = phoneColumns
        .map((c) => normalizePhone(row[c]))
        .filter((p): p is string => !!p)

      if (!firstName && !lastName && emails.length === 0) {
        skippedBlankRows++
        rowOutcomes.push({ status: 'skipped' })
        continue
      }

      const extraFields: Record<string, string> = {}
      for (const col of ignoredColumns) {
        if (row[col]) extraFields[col] = row[col]
      }
      // The year-of-study answer is kept with the attendance as well as on
      // the student record. On its own the record says "2nd year" with no
      // date attached, which is unusable a year later; here it is pinned to
      // the event it was given at, which is what makes it possible to say
      // what year they are in now.
      if (yearCol && row[yearCol]) extraFields[yearCol] = row[yearCol]

      const { studentId, created } = matchStudent({
        firstName: firstName || '(Unknown)',
        lastName: lastName || '',
        nsid: nsidCol ? row[nsidCol] : null,
        emails,
        phones,
        college: collegeCol ? row[collegeCol] : null,
        discipline: disciplineCol ? row[disciplineCol] : null,
        degree: degreeCol ? row[degreeCol] : null,
        program: programCol ? row[programCol] : null,
        // Registrar exports write "Not Available" where a student's year
        // isn't known; that must not land on the record as if it were one.
        yearInProgram: yearCol ? meaningfulValue(row[yearCol]) : null,
        position: positionCol ? meaningfulValue(row[positionCol]) : null,
        positionOrg: positionOrgCol ? meaningfulValue(row[positionOrgCol]) : null,
        positionUrl: positionUrlCol ? linkedInUrl(row[positionUrlCol]) : null,
        enrolTerm: yearCol ? parseEnrolTerm(row[yearCol]) : null,
        isAlumni: request.markAsAlumni === true,
        // On a cohort list the year column is the year they came through,
        // not the year of study they were in — the alumni tracker keeps it
        // in a column with no heading at all, next to the row numbers.
        cohortYear: cohortCol
          ? parseEnrolYear(row[cohortCol])
          : request.markAsAlumni && yearCol
            ? parseEnrolYear(row[yearCol])
            : null
      }, context)

      const { eventId, eventName } = eventIdForRow(yearCol ? row[yearCol] : null)
      addAttendance(studentId, eventId, extraFields)
      if (course) {
        const enrolment = readCourseEnrolment(headers, row)
        recordStudentCourse({
          studentId,
          courseCode: course.code,
          term: course.term,
          termLabel: course.termLabel,
          creditUnits: enrolment.creditUnits,
          grade: enrolment.grade,
          regStatus: enrolment.regStatus,
          status: enrolment.status,
          classYear: enrolment.classYear,
          sourceFile: request.fileName
        })
      }
      touchedIds.add(studentId)
      rowsProcessed++

      let summary = eventSummaries.get(eventId)
      if (!summary) {
        summary = { eventId, eventName, rowsProcessed: 0, newStudents: 0, matchedExisting: 0 }
        eventSummaries.set(eventId, summary)
      }
      summary.rowsProcessed++
      if (created) {
        newStudents++
        summary.newStudents++
        createdByRow.set(studentId, rowIndex)
        rowOutcomes.push({ status: 'new' })
      } else {
        matchedExisting++
        summary.matchedExisting++
        const repeatOf = createdByRow.get(studentId)
        if (repeatOf !== undefined) {
          rowOutcomes.push({ status: 'repeat', repeatOfRow: repeatOf })
        } else if (dryRun) {
          const s = getStudentById(studentId)
          rowOutcomes.push({ status: 'existing', matchedName: s ? `${s.firstName} ${s.lastName}`.trim() : undefined })
        } else {
          rowOutcomes.push({ status: 'existing' })
        }
      }
    }

    const flagged = detectFuzzyDuplicates(Array.from(touchedIds))
    if (harmonizeClasslistEventNames() > 0) {
      const nameOf = getDb().prepare('SELECT name FROM events WHERE id = ?')
      for (const summary of eventSummaries.values()) {
        const row = nameOf.get(summary.eventId) as { name: string } | undefined
        if (row) summary.eventName = row.name
      }
    }
    if (dryRun) {
      newDuplicateSuggestions = flagged
      throw new DryRunRollback()
    }
    return flagged
  })

  let newDuplicateSuggestions = 0
  try {
    newDuplicateSuggestions = runImport()
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err
  }

  return {
    result: {
      events: Array.from(eventSummaries.values()),
      rowsProcessed,
      newStudents,
      matchedExisting,
      newDuplicateSuggestions,
      skippedBlankRows,
      newStudentIds: dryRun ? [] : [...createdByRow.keys()],
      updatedFields: context.updatesApplied,
      blanksFilled: context.blanksFilled
    },
    rowOutcomes,
    proposed: context.proposed
  }
}

import path from 'path'
import * as XLSX from 'xlsx'
import { findOrCreateEvent } from './db/events'
import { addAttendance } from './db/students'
import { DEFAULT_CATEGORIES } from './db/index'
import { detectFuzzyDuplicates, matchStudent } from './matching'
import { normalizeEmail, normalizePhone, titleCase } from './normalize'
import { enrolDateFor, parseEnrolTerm, parseEnrolYear, parseYearMonthStamp } from './enrolDate'
import type {
  ColumnMapping,
  ImportEventSummary,
  ImportResult,
  ImportSheetRequest,
  MappableField,
  ParsedSheet,
  ParsedWorkbook
} from '../shared/types'

function readWorkbook(filePath: string): XLSX.WorkBook {
  return XLSX.readFile(filePath, { cellDates: false })
}

function detectMapping(headers: string[], rows: Record<string, string>[] = []): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const header of headers) {
    const h = header.toLowerCase().trim()
    let field: MappableField = 'ignore'

    if (h === 'nsid' || h === 'id' || h === 'student id') field = 'nsid'
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
    else if (h.includes('program')) field = 'program'

    mapping[header] = field
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

function sheetRows(ws: XLSX.WorkSheet, headers: string[], headerRow: number): Record<string, string>[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    header: headers,
    range: headerRow + 1,
    defval: ''
  })
  return rows
    .map((row) => {
      const out: Record<string, string> = {}
      for (const h of headers) {
        const v = row[h]
        out[h] = v === undefined || v === null ? '' : String(v).trim()
      }
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

function categoryId(name: string): string {
  return DEFAULT_CATEGORIES.find((c) => c.name === name)!.id
}

/** Best-effort guess at which funnel category a sheet belongs to, based on its name. */
function guessCategory(eventName: string, sheetName: string, fileName: string): string | null {
  const text = `${eventName} ${sheetName}`.toLowerCase()

  if (text.includes('hackathon')) return categoryId('Hackathon')
  if (/\b(inspiration|speaker|fireside|talk|seminar)\b/.test(text)) return categoryId('Inspiration Event')
  if (/\b(social|holiday|mixer|meet.?and.?greet)\b/.test(text)) return categoryId('Social')
  if (/\b(incubator|tic|sigma)\b/.test(text)) return categoryId('SIGMA')
  // Bare course-code sheets (e.g. "431", "450") are the SIGMA-affiliated classes.
  if (/^\d{3,4}$/.test(sheetName.trim())) return categoryId('Class')
  // Registrar "…classlist [GE] <code>.xls" exports are always GE course rosters,
  // even when the sheet tab itself is just a generic "Class List Summary" label.
  if (classlistCourseCode(fileName)) return categoryId('Class')

  return null
}

/**
 * Registrar class-list exports for SIGMA-affiliated GE courses are named
 * "<yearmonth>_<CRN>_classlist[ GE] <code>.xls" — the course code is always
 * the last number before the extension, whether or not "GE" literally
 * appears — while the sheet tab itself carries no course identity at all
 * (just "Class List Summary"). When this pattern matches, the filename is
 * the authoritative source for both category and event name.
 */
function classlistCourseCode(fileName: string): string | null {
  const match = fileName.match(/classlist\D*(\d{3,4})\D*$/i)
  return match ? match[1] : null
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
 * and wins outright. Otherwise, SIGMA-program events always land on June
 * 1st of whatever year is found — SIGMA doesn't run on the Fall/Winter
 * class-term calendar the other categories do, so that rule doesn't apply
 * to it. Everything else tries an explicit "Fall 2024"/"Winter 2024" marker
 * first, falling back to a registrar-style "202209" year-month stamp
 * commonly found in export filenames.
 */
function guessDate(
  eventName: string,
  sheetName: string,
  fileName: string,
  resolvedCategoryId: string | null
): string | null {
  const exact = parseFileNameDateAndName(fileName)
  if (exact) return exact.date

  const text = `${eventName} ${sheetName} ${fileName}`

  if (resolvedCategoryId === categoryId('SIGMA')) {
    const year = parseEnrolYear(text) ?? parseYearMonthStamp(text)?.year ?? null
    return year ? `${year}-06-01` : null
  }

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
    // Include the term year so "GE831" from three different terms doesn't
    // collapse into one merged event — findOrCreateEvent matches by exact
    // name, so distinct offerings need distinct names.
    const stamp = parseYearMonthStamp(fileName)
    return stamp ? `GE${courseCode} ${stamp.year}` : `GE${courseCode}`
  }

  const dated = parseFileNameDateAndName(fileName)
  if (dated) {
    // Same reasoning as the GE-course case above: an annually-recurring
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

export function parseWorkbookForPreview(filePath: string): ParsedWorkbook {
  const fileName = path.basename(filePath)
  const workbook = readWorkbook(filePath)
  const sheets: ParsedSheet[] = []

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const { headers, rows } = parseSheet(ws)
    if (headers.length === 0) continue

    const suggestedEventName = deriveEventName(sheetName, fileName)
    const suggestedCategoryId = guessCategory(suggestedEventName, sheetName, fileName)
    const suggestedMapping = detectMapping(headers, rows)
    sheets.push({
      sheetName,
      suggestedEventName,
      suggestedDate: guessDate(suggestedEventName, sheetName, fileName, suggestedCategoryId),
      suggestedCategoryId,
      headers,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
      suggestedMapping,
      yearSplitPreview: yearSplitPreview(headers, rows, suggestedMapping)
    })
  }

  return { fileName, filePath, sheets }
}

export function commitImport(request: ImportSheetRequest): ImportResult {
  const workbook = readWorkbook(request.filePath)
  const ws = workbook.Sheets[request.sheetName]
  if (!ws) throw new Error(`Sheet "${request.sheetName}" not found in ${request.fileName}`)
  const { headers, rows } = parseSheet(ws)

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
  const ignoredColumns = headers.filter((h) => request.mapping[h] === 'ignore')

  // Rosters with a mapped year column often get exported as one sheet
  // spanning several cohorts (a "831" class export with a mixed 2020-2025
  // Enrol Year column, or a SIGMA cohort tracker listing every year's
  // members in one sheet). Split those into one event per distinct year
  // found in that column ("831 2024", "831 2025", "SIGMA 2024", …) instead
  // of dumping every cohort into a single event. This isn't limited to any
  // one category — rows whose year cell doesn't parse as a real calendar
  // year just fall back to the single sheet-level event below, so enabling
  // it broadly is safe. Only the *date* assigned to each split year differs
  // by category (SIGMA → June 1st; everything else → Fall/Winter term).
  const splitByYear = !!yearCol
  const eventSummaries = new Map<string, ImportEventSummary>()
  const eventIds = new Map<string, string>()

  function dateForSplitYear(year: number, rawYear: string): string {
    if (request.categoryId === categoryId('SIGMA')) return `${year}-06-01`
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

  for (const row of rows) {
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
      continue
    }

    const extraFields: Record<string, string> = {}
    for (const col of ignoredColumns) {
      if (row[col]) extraFields[col] = row[col]
    }

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
      yearInProgram: yearCol ? row[yearCol] : null,
      enrolTerm: yearCol ? parseEnrolTerm(row[yearCol]) : null
    })

    const { eventId, eventName } = eventIdForRow(yearCol ? row[yearCol] : null)
    addAttendance(studentId, eventId, extraFields)
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
    } else {
      matchedExisting++
      summary.matchedExisting++
    }
  }

  const newDuplicateSuggestions = detectFuzzyDuplicates(Array.from(touchedIds))

  return {
    events: Array.from(eventSummaries.values()),
    rowsProcessed,
    newStudents,
    matchedExisting,
    newDuplicateSuggestions,
    skippedBlankRows
  }
}

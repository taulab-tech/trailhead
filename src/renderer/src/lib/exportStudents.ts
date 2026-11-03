import * as XLSX from 'xlsx'
import type { Student, StudentCertificate } from '../../../shared/types'

/**
 * Exporting the student list as a spreadsheet.
 *
 * Built in the page and handed straight to the browser, which is what keeps
 * the promise the rest of the app makes: the data never goes near a server,
 * not even to be formatted. The same code runs in the desktop build, where
 * Chromium saves the file the same way.
 *
 * What goes in is what is on screen — the current filter and sort — because
 * the point of the button is usually "send me this list", and a file that
 * quietly held more or fewer people than the table would be worse than none.
 */

export type ExportKind = 'students' | 'alumni'

/** Certificate progress for each student, by student id. */
export type ProgressByStudent = Map<string, StudentCertificate[]>

const SHARED_COLUMNS = [
  'First name',
  'Last name',
  'Student ID',
  'Email',
  'Phone',
  'College',
  'Discipline / Major',
  'Degree',
  'Program'
]

const STUDENT_COLUMNS = ['Year (estimated)', 'Year worked out from']
const ALUMNI_COLUMNS = ['Cohort year', 'Position', 'Organisation', 'Position since', 'LinkedIn']

function headingsFor(kind: ExportKind, certificateNames: string[]): string[] {
  return [
    ...SHARED_COLUMNS,
    ...(kind === 'alumni' ? ALUMNI_COLUMNS : STUDENT_COLUMNS),
    'Events attended',
    ...certificateNames.flatMap((name) => [`${name} (CU)`, `${name} (%)`])
  ]
}

function rowFor(
  student: Student,
  kind: ExportKind,
  certificateNames: string[],
  progress: StudentCertificate[] | undefined
): Record<string, string | number> {
  const row: Record<string, string | number> = {
    'First name': student.firstName,
    'Last name': student.lastName,
    'Student ID': student.nsid ?? '',
    Email: student.emails.join(', '),
    Phone: student.phones.join(', '),
    College: student.college ?? '',
    'Discipline / Major': student.discipline ?? '',
    Degree: student.degree ?? '',
    Program: student.program ?? ''
  }

  if (kind === 'alumni') {
    row['Cohort year'] = student.cohortYear ?? ''
    row.Position = student.position ?? ''
    row.Organisation = student.positionOrg ?? ''
    row['Position since'] = student.positionSince ?? ''
    row.LinkedIn = student.positionUrl ?? ''
  } else {
    row['Year (estimated)'] = student.currentYear.label
    // Without this the estimate reads as a fact. With it, whoever opens the
    // file can see how old the thing it was worked out from is.
    row['Year worked out from'] = student.currentYear.basis ?? ''
  }

  row['Events attended'] = student.attendanceCount

  for (const name of certificateNames) {
    const found = progress?.find((c) => c.name === name)
    row[`${name} (CU)`] = found ? `${found.earnedUnits} / ${found.totalUnits}` : ''
    row[`${name} (%)`] = found ? found.percent : ''
  }

  return row
}

export interface ExportOptions {
  students: Student[]
  kind: ExportKind
  certificateNames: string[]
  progress: ProgressByStudent
}

/**
 * The workbook itself, separate from saving it, so what ends up in the file
 * can be checked without a filesystem anywhere near it.
 */
export function buildStudentsWorkbook({
  students,
  kind,
  certificateNames,
  progress
}: ExportOptions): XLSX.WorkBook {
  const headings = headingsFor(kind, certificateNames)

  // Headings first, rows under them, so an empty list still produces a
  // usable file rather than a blank one.
  const sheet = XLSX.utils.aoa_to_sheet([headings])
  XLSX.utils.sheet_add_json(
    sheet,
    students.map((s) => rowFor(s, kind, certificateNames, progress.get(s.id))),
    { header: headings, skipHeader: true, origin: 'A2' }
  )
  sheet['!cols'] = headings.map((heading) => ({ wch: Math.min(Math.max(heading.length + 2, 12), 40) }))
  sheet['!freeze'] = { xSplit: '0', ySplit: '1' }

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, kind === 'alumni' ? 'Alumni' : 'Students')
  return book
}

/** Builds the workbook and hands it to the browser to save. Returns the file name. */
export function exportStudentsToExcel(options: ExportOptions): string {
  const fileName = `trailhead-${options.kind}-${new Date().toISOString().slice(0, 10)}.xlsx`
  // Under Node this writes to disk; in a page it goes through the browser's
  // download, which is what both builds want.
  XLSX.writeFile(buildStudentsWorkbook(options), fileName, { compression: true })
  return fileName
}

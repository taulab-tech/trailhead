import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-alumni-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { commitImport, parseWorkbookForPreview } from '../src/main/importer'
import { createStudent, getStudentById, listStudents, updateStudent } from '../src/main/db/students'
import { buildStudentsWorkbook } from '../src/renderer/src/lib/exportStudents'
import * as XLSX from 'xlsx'

setWorkbookReader(desktopWorkbookReader)
openDb()

beforeEach(() => wipeDatabase())

let fileCount = 0

function sheet(headers: string[], rows: string[][]): string {
  const file = path.join(tmpDir, `sheet-${++fileCount}.csv`)
  fs.writeFileSync(file, [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'))
  return file
}

function importSheet(file: string, options: { eventName: string; date: string | null; alumni?: boolean }) {
  const parsed = parseWorkbookForPreview(file)
  const s = parsed.sheets[0]
  return commitImport({
    filePath: file,
    fileName: parsed.fileName,
    sheetName: s.sheetName,
    eventName: options.eventName,
    eventDate: options.date,
    categoryId: null,
    mapping: s.suggestedMapping,
    markAsAlumni: options.alumni
  })
}

function student(lastName: string) {
  const found = listStudents().find((s) => s.lastName === lastName)
  assert.ok(found, `no student called ${lastName}`)
  return found
}

/* ------------------------------ the flag -------------------------------- */

test('a student is not an alum by default', () => {
  const id = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  assert.equal(getStudentById(id)!.isAlumni, false)
  assert.equal(getStudentById(id)!.cohortYear, null)
})

test('somebody can be marked as an alum by hand', () => {
  const id = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  updateStudent(id, { isAlumni: true, cohortYear: 2023 })

  const after = getStudentById(id)!
  assert.equal(after.isAlumni, true)
  assert.equal(after.cohortYear, 2023)
})

/* ---------------------------- importing them ---------------------------- */

test('a cohort list marks everyone on it as an alum', () => {
  importSheet(
    sheet(
      ['first name', 'last name', 'Cohort', 'preferred email'],
      [
        ['Priya', 'Raman', '2023', 'priya@example.com'],
        ['Marcus', 'Webb', '2024', 'marcus@example.com']
      ]
    ),
    { eventName: 'SIGMA alumni', date: '2025-06-01', alumni: true }
  )

  assert.equal(student('Raman').isAlumni, true)
  assert.equal(student('Raman').cohortYear, 2023)
  assert.equal(student('Webb').cohortYear, 2024)
})

test('an ordinary roster leaves everyone as a student', () => {
  importSheet(sheet(['First Name', 'Last Name'], [['Priya', 'Raman']]), {
    eventName: 'Hackathon',
    date: '2026-01-17'
  })
  assert.equal(student('Raman').isAlumni, false)
})

test('the same person on a roster and a cohort list is one record, marked', () => {
  importSheet(sheet(['First Name', 'Last Name', 'NSID'], [['Priya', 'Raman', 'prm501']]), {
    eventName: 'Hackathon 2019',
    date: '2019-01-17'
  })
  importSheet(sheet(['first name', 'last name', 'NSID', 'Cohort'], [['Priya', 'Raman', 'prm501', '2023']]), {
    eventName: 'SIGMA alumni',
    date: '2025-06-01',
    alumni: true
  })

  // The whole point of one table: their hackathon is still on their record.
  assert.equal(listStudents().length, 1)
  assert.equal(student('Raman').isAlumni, true)
  assert.equal(student('Raman').cohortYear, 2023)
  assert.equal(student('Raman').attendanceCount, 2)
})

test('a later roster does not take away alumni status', () => {
  importSheet(sheet(['first name', 'last name', 'NSID', 'Cohort'], [['Priya', 'Raman', 'prm501', '2023']]), {
    eventName: 'SIGMA alumni',
    date: '2023-06-01',
    alumni: true
  })
  importSheet(sheet(['First Name', 'Last Name', 'NSID'], [['Priya', 'Raman', 'prm501']]), {
    eventName: 'Mining Hackathon',
    date: '2026-01-17'
  })

  assert.equal(student('Raman').isAlumni, true, 'still an alum')
  assert.equal(student('Raman').cohortYear, 2023)
})

test('a cohort year already on record is not overwritten by another list', () => {
  importSheet(sheet(['first name', 'last name', 'NSID', 'Cohort'], [['Priya', 'Raman', 'prm501', '2023']]), {
    eventName: 'First list',
    date: '2023-06-01',
    alumni: true
  })
  importSheet(sheet(['first name', 'last name', 'NSID', 'Cohort'], [['Priya', 'Raman', 'prm501', '2025']]), {
    eventName: 'Second list',
    date: '2026-06-01',
    alumni: true
  })

  assert.equal(student('Raman').cohortYear, 2023, 'the year they came through does not change')
})

test('a cohort column is recognised without being mapped by hand', () => {
  const file = sheet(['first name', 'last name', 'Cohort'], [['Priya', 'Raman', '2023']])
  const parsed = parseWorkbookForPreview(file)
  assert.equal(parsed.sheets[0].suggestedMapping['Cohort'], 'cohortYear')
})

test('on a cohort list the bare year column is the cohort', () => {
  // The real alumni tracker keeps the year in an unheaded column beside the
  // row numbers, which the generic matching reads as a year of study.
  const file = sheet(
    ['', '', 'first name', 'last name', 'NSID'],
    [
      ['1', '2021', 'Priya', 'Raman', 'prm501'],
      ['2', '2024', 'Marcus', 'Webb', 'mrw502']
    ]
  )
  importSheet(file, { eventName: 'SIGMA alumni', date: '2025-06-01', alumni: true })

  assert.equal(student('Raman').cohortYear, 2021)
  assert.equal(student('Webb').cohortYear, 2024)
})

test('that same column stays the year of study on an ordinary roster', () => {
  const file = sheet(['First Name', 'Last Name', 'Year'], [['Priya', 'Raman', '2nd year']])
  importSheet(file, { eventName: 'Hackathon', date: '2026-01-17' })
  assert.equal(student('Raman').cohortYear, null)
  assert.equal(student('Raman').yearInProgram, '2nd year')
})

/* ------------------------------ two views ------------------------------- */

test('students and alumni split cleanly, and add back up', () => {
  importSheet(
    sheet(
      ['First Name', 'Last Name'],
      [
        ['Priya', 'Raman'],
        ['Marcus', 'Webb'],
        ['Dev', 'Okonkwo']
      ]
    ),
    { eventName: 'Hackathon', date: '2026-01-17' }
  )
  updateStudent(student('Raman').id, { isAlumni: true, cohortYear: 2023 })

  const all = listStudents()
  const alumni = all.filter((s) => s.isAlumni)
  const current = all.filter((s) => !s.isAlumni)

  assert.equal(alumni.length, 1)
  assert.equal(current.length, 2)
  assert.equal(alumni.length + current.length, all.length)
})

/* ------------------------------ the export ------------------------------ */

/** Reads a built workbook back as rows, the way a spreadsheet app would. */
function readBack(book: XLSX.WorkBook): { sheetName: string; rows: Record<string, unknown>[] } {
  const sheetName = book.SheetNames[0]
  return { sheetName, rows: XLSX.utils.sheet_to_json(book.Sheets[sheetName]) }
}

test('the students export carries contact details, the estimated year and its basis', () => {
  importSheet(
    sheet(
      ['First Name', 'Last Name', 'NSID', 'College', 'Email'],
      [['Priya', 'Raman', 'prm501', 'EN', 'priya@example.com']]
    ),
    { eventName: 'Hackathon', date: '2026-01-17' }
  )

  const { sheetName, rows } = readBack(
    buildStudentsWorkbook({
      students: listStudents(),
      kind: 'students',
      certificateNames: [],
      progress: new Map()
    })
  )

  assert.equal(sheetName, 'Students')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]['First name'], 'Priya')
  assert.equal(rows[0]['Student ID'], 'prm501')
  assert.equal(rows[0].Email, 'priya@example.com')
  assert.equal(rows[0].College, 'EN')
  assert.equal(rows[0]['Events attended'], 1)
  assert.ok(rows[0]['Year (estimated)'], 'the estimate is there')
})

test('the alumni export carries the cohort instead of a year of study', () => {
  const id = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  updateStudent(id, { isAlumni: true, cohortYear: 2021, position: 'Engineer', positionOrg: 'Northwind' })

  const { sheetName, rows } = readBack(
    buildStudentsWorkbook({
      students: listStudents().filter((s) => s.isAlumni),
      kind: 'alumni',
      certificateNames: [],
      progress: new Map()
    })
  )

  assert.equal(sheetName, 'Alumni')
  assert.equal(rows[0]['Cohort year'], 2021)
  assert.equal(rows[0].Position, 'Engineer')
  assert.equal(rows[0].Organisation, 'Northwind')
  assert.equal(rows[0]['Year (estimated)'], undefined, 'not a column on the alumni sheet')
})

test('a column per certificate shows credit units and percent', () => {
  const id = createStudent({ firstName: 'Priya', lastName: 'Raman' })

  const { rows } = readBack(
    buildStudentsWorkbook({
      students: listStudents(),
      kind: 'students',
      certificateNames: ['Engineering Innovation'],
      progress: new Map([
        [
          id,
          [
            {
              certificateId: 'c1',
              name: 'Engineering Innovation',
              totalUnits: 26,
              earnedUnits: 12,
              inProgressUnits: 0,
              percent: 46,
              complete: false,
              groups: [],
              missing: [],
              declared: false
            }
          ]
        ]
      ])
    })
  )

  assert.equal(rows[0]['Engineering Innovation (CU)'], '12 / 26')
  assert.equal(rows[0]['Engineering Innovation (%)'], 46)
})

test('exporting nobody still produces a file with its headings', () => {
  const book = buildStudentsWorkbook({
    students: [],
    kind: 'students',
    certificateNames: [],
    progress: new Map()
  })
  const sheetRef = book.Sheets[book.SheetNames[0]]
  const headings = XLSX.utils.sheet_to_json<string[]>(sheetRef, { header: 1 })[0]

  assert.ok(headings.includes('First name'))
  assert.ok(headings.includes('Year (estimated)'))
  assert.equal(readBack(book).rows.length, 0)
})

test('the export is whatever list it is given, in that order', () => {
  importSheet(
    sheet(
      ['First Name', 'Last Name'],
      [
        ['Priya', 'Raman'],
        ['Marcus', 'Webb'],
        ['Dev', 'Okonkwo']
      ]
    ),
    { eventName: 'Hackathon', date: '2026-01-17' }
  )
  const chosen = listStudents().filter((s) => s.lastName !== 'Webb')

  const { rows } = readBack(
    buildStudentsWorkbook({ students: chosen, kind: 'students', certificateNames: [], progress: new Map() })
  )
  assert.deepEqual(
    rows.map((r) => r['Last name']),
    chosen.map((s) => s.lastName)
  )
})

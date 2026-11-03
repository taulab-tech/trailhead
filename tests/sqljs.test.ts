import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import * as XLSX from 'xlsx'

import { configureSqlJs, openWebDatabase, type WebDatabase } from '../src/web/sqljs'
import { getDb, initializeDatabase, looksLikeTrailheadDb, setDbDriver, wipeDatabase } from '../src/main/db'
import {
  createStudent,
  getStudentById,
  listStudents,
  mergeStudents,
  updateStudent
} from '../src/main/db/students'
import { listEvents } from '../src/main/db/events'
import { getDashboardStats } from '../src/main/db/dashboard'
import { setWorkbookReader } from '../src/main/workbooks'
import { commitImport, parseWorkbookForPreview, previewImport } from '../src/main/importer'

/**
 * The sql.js adapter, exercised through the app's own queries rather than
 * hand-written SQL. If `db/` runs green here, the same code runs in a browser.
 *
 * Under Node, sql.js needs pointing at its WebAssembly; the browser build
 * points it at a bundled asset instead (see `src/web/boot.ts`).
 */
configureSqlJs((file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file))

// Spreadsheets are held in memory here, the way the web build holds the files
// someone has dropped on the page.
const workbooks = new Map<string, XLSX.WorkBook>()
setWorkbookReader({
  read: (ref) => {
    const book = workbooks.get(ref)
    if (!book) throw new Error(`No workbook registered as ${ref}`)
    return book
  },
  baseName: (ref) => ref
})

function registerSheet(name: string, rows: string[][]): string {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  workbooks.set(name, book)
  return name
}

let database: WebDatabase

beforeEach(async () => {
  database?.close()
  database = await openWebDatabase()
  setDbDriver(database)
  initializeDatabase(database)
})

test('an empty database comes up with the full schema', () => {
  assert.equal(looksLikeTrailheadDb(database), true)
  assert.deepEqual(listStudents(), [])
  assert.deepEqual(listEvents(), [])
})

test('named parameters bind by name, and positional ones by position', () => {
  // createStudent binds @firstName/@lastName/…; getStudentById binds a bare ?.
  const id = createStudent({
    firstName: 'Priya',
    lastName: 'Raman',
    nsid: 'prm501',
    college: 'EN',
    yearInProgram: 'Fourth Year'
  })

  const student = getStudentById(id)
  assert.equal(student?.firstName, 'Priya')
  assert.equal(student?.lastName, 'Raman')
  assert.equal(student?.nsid, 'prm501')
  assert.equal(student?.college, 'EN')
  assert.equal(student?.yearInProgram, 'Fourth Year')
})

test('an @ inside a string literal is not mistaken for a parameter', () => {
  const id = createStudent({ firstName: 'Marcus', lastName: 'Webb', email: 'marcus@gmail.com' })
  const found = getDb()
    .prepare("SELECT student_id AS studentId FROM student_emails WHERE email LIKE '%@gmail.com'")
    .get() as { studentId: string } | undefined
  assert.equal(found?.studentId, id)
})

test('run reports how many rows it changed', () => {
  createStudent({ firstName: 'Ada', lastName: 'Byron' })
  createStudent({ firstName: 'Grace', lastName: 'Hopper' })

  const touched = getDb().prepare("UPDATE students SET college = 'EN'").run()
  assert.equal(touched.changes, 2)

  const none = getDb().prepare("UPDATE students SET college = 'EN' WHERE last_name = 'Nobody'").run()
  assert.equal(none.changes, 0)
})

test('a transaction that throws leaves nothing behind', () => {
  createStudent({ firstName: 'Ada', lastName: 'Byron' })

  const boom = getDb().transaction(() => {
    createStudent({ firstName: 'Should', lastName: 'Vanish' })
    throw new Error('rollback please')
  })
  assert.throws(() => boom(), /rollback please/)

  assert.deepEqual(
    listStudents().map((s) => s.lastName),
    ['Byron']
  )
})

test('a nested transaction rolls back only its own work', () => {
  const outer = getDb().transaction(() => {
    createStudent({ firstName: 'Kept', lastName: 'Outer' })

    const inner = getDb().transaction(() => {
      createStudent({ firstName: 'Lost', lastName: 'Inner' })
      throw new Error('inner fails')
    })
    assert.throws(() => inner(), /inner fails/)
  })
  outer()

  assert.deepEqual(
    listStudents().map((s) => s.lastName),
    ['Outer']
  )
})

test('statements still work after the schema changes under them', () => {
  createStudent({ firstName: 'Ada', lastName: 'Byron' })
  const count = getDb().prepare('SELECT COUNT(*) AS c FROM students')
  assert.equal((count.get() as { c: number }).c, 1)

  getDb().exec('ALTER TABLE students ADD COLUMN favourite_colour TEXT')

  // The compiled statement predates the new column; it has to recompile.
  assert.equal((count.get() as { c: number }).c, 1)
})

test('a database survives being exported and reopened', async () => {
  const id = createStudent({ firstName: 'Dev', lastName: 'Okonkwo', nsid: 'dvo503' })
  updateStudent(id, { college: 'EN', discipline: 'EP' })

  const bytes = database.export()
  assert.ok(bytes.byteLength > 0)

  database.close()
  database = await openWebDatabase(bytes)
  setDbDriver(database)

  assert.equal(looksLikeTrailheadDb(database), true)
  const student = getStudentById(id)
  assert.equal(student?.nsid, 'dvo503')
  assert.equal(student?.discipline, 'EP')
})

test('merging two students moves their records across', () => {
  const keep = createStudent({ firstName: 'Chris', lastName: 'Elash' })
  const merge = createStudent({ firstName: 'Christopher', lastName: 'Elash', nsid: 'abc123' })

  mergeStudents(keep, merge)

  const remaining = listStudents()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, keep)
  assert.equal(remaining[0].nsid, 'abc123')
})

test('wiping empties every table', () => {
  createStudent({ firstName: 'Ada', lastName: 'Byron' })
  wipeDatabase()
  assert.deepEqual(listStudents(), [])
})

test('a spreadsheet imports, matches and reports the same way as on the desktop', () => {
  const ref = registerSheet('roster.xlsx', [
    ['First Name', 'Last Name', 'Email', 'NSID'],
    ['Priya', 'Raman', 'priya@example.com', 'prm501'],
    ['Marcus', 'Webb', 'alvan@example.com', 'mrw502']
  ])

  const parsed = parseWorkbookForPreview(ref)
  assert.equal(parsed.fileName, 'roster.xlsx')
  assert.equal(parsed.sheets.length, 1)
  const sheet = parsed.sheets[0]

  const request = {
    filePath: ref,
    fileName: 'roster.xlsx',
    sheetName: sheet.sheetName,
    eventName: 'Mining Hackathon',
    eventDate: '2026-01-17',
    categoryId: null,
    mapping: sheet.suggestedMapping
  }

  // The dry run must leave no trace — it relies on a rollback.
  const preview = previewImport(request)
  assert.equal(preview.newStudents, 2)
  assert.deepEqual(listStudents(), [])

  const result = commitImport(request)
  assert.equal(result.newStudents, 2)
  assert.equal(listStudents().length, 2)
  assert.equal(listEvents().length, 1)

  // Importing the same sheet again links to the existing students rather than
  // duplicating them.
  const again = commitImport(request)
  assert.equal(again.newStudents, 0)
  assert.equal(again.matchedExisting, 2)
  assert.equal(listStudents().length, 2)
})

test('the dashboard queries run end to end', () => {
  const ref = registerSheet('social.xlsx', [
    ['First Name', 'Last Name', 'Email'],
    ['Ada', 'Byron', 'ada@example.com'],
    ['Grace', 'Hopper', 'grace@example.com']
  ])
  const sheet = parseWorkbookForPreview(ref).sheets[0]
  commitImport({
    filePath: ref,
    fileName: 'social.xlsx',
    sheetName: sheet.sheetName,
    eventName: 'Holiday Social',
    eventDate: '2025-12-01',
    categoryId: null,
    mapping: sheet.suggestedMapping
  })

  const stats = getDashboardStats()
  assert.equal(stats.totalStudents, 2)
  assert.ok(stats.totalEvents >= 1)
})

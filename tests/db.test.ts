import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Must be set before the first getDb() call, which is lazy, so setting it
// here (after the hoisted imports) still takes effect.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-test-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { closeDb, getDb, wipeDatabase } from '../src/main/db'
import { createStudent, getStudentById, listStudents, mergeStudents } from '../src/main/db/students'
import { listPossibleDuplicates, suggestDuplicate } from '../src/main/db/duplicates'
import { listEvents } from '../src/main/db/events'
import { createCategory, deleteCategory, listCategories } from '../src/main/db/categories'
import { detectFuzzyDuplicates, matchStudent } from '../src/main/matching'
import { commitImport, parseWorkbookForPreview } from '../src/main/importer'
import { setSchoolEmailDomain } from '../src/main/db/settings'

beforeEach(() => {
  wipeDatabase()
  setSchoolEmailDomain(null)
})

function writeCsv(name: string, lines: string[]): string {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

function person(firstName: string, lastName: string, nsid: string | null = null) {
  return { firstName, lastName, nsid, emails: [], phones: [] }
}

test('merge succeeds when only the removed record has a student ID, and keeps it', () => {
  const keep = createStudent({ firstName: 'Chris', lastName: 'Elash' })
  const merge = createStudent({ firstName: 'Christopher', lastName: 'Elash', nsid: 'abc123' })

  mergeStudents(keep, merge)

  assert.equal(getStudentById(merge), null)
  assert.equal(getStudentById(keep)?.nsid, 'abc123')
})

test("merge keeps the surviving student's unrelated pending duplicate suggestions", () => {
  const keep = createStudent({ firstName: 'Chris', lastName: 'Elash' })
  const merge = createStudent({ firstName: 'Christopher', lastName: 'Elash' })
  const other = createStudent({ firstName: 'Kris', lastName: 'Elash' })
  suggestDuplicate(keep, merge, 0.95, 'test')
  suggestDuplicate(keep, other, 0.92, 'test')

  mergeStudents(keep, merge)

  const pending = listPossibleDuplicates('pending')
  assert.equal(pending.length, 1)
  assert.deepEqual([pending[0].studentA.id, pending[0].studentB.id].sort(), [keep, other].sort())
})

test('same name with different student IDs stays two students and is not flagged', () => {
  const first = matchStudent(person('John', 'Smith', 'jos111'))
  const second = matchStudent(person('John', 'Smith', 'jos222'))

  assert.equal(second.created, true)
  assert.notEqual(first.studentId, second.studentId)
  assert.equal(detectFuzzyDuplicates([first.studentId, second.studentId]), 0)
})

test('same name with no conflicting identifiers is still linked', () => {
  const first = matchStudent(person('Jane', 'Doe', 'jad111'))
  const second = matchStudent(person('jane', 'DOE'))

  assert.equal(second.created, false)
  assert.equal(second.studentId, first.studentId)
})

test('with a school domain set, an ID written as the school email matches the bare ID', () => {
  setSchoolEmailDomain('school.edu')
  const first = matchStudent(person('Ann', 'Lee', 'abc123'))
  const second = matchStudent(person('Annie', 'Lee', 'ABC123@mail.school.edu'))

  assert.equal(second.created, false)
  assert.equal(second.studentId, first.studentId)
})

test('without a school domain, email-style IDs are kept whole', () => {
  const student = matchStudent(person('Ann', 'Lee', 'john@gmail.com'))
  assert.equal(getStudentById(student.studentId)?.nsid, 'john@gmail.com')

  setSchoolEmailDomain('school.edu')
  assert.equal(getStudentById(student.studentId)?.nsid, 'john@gmail.com')
})

test('setting the school domain later cleans up IDs already stored as emails', () => {
  const ann = matchStudent(person('Ann', 'Lee', 'abc123@school.edu'))
  assert.equal(getStudentById(ann.studentId)?.nsid, 'abc123@school.edu')

  setSchoolEmailDomain('@School.edu ')
  assert.equal(getStudentById(ann.studentId)?.nsid, 'abc123')
})

test('an invalid school domain is rejected', () => {
  assert.throws(() => setSchoolEmailDomain('not a domain'))
})

test('placeholder student IDs like "N/A" never link different students', () => {
  const first = matchStudent(person('Ann', 'Lee', 'n/a'))
  const second = matchStudent(person('Bo', 'Park', 'N/A'))

  assert.notEqual(first.studentId, second.studentId)
  assert.equal(getStudentById(first.studentId)?.nsid, null)
})

test('opening an older database cleans up its stored student IDs', () => {
  getDb().prepare("INSERT INTO settings (key, value) VALUES ('school_email_domain', 'school.edu')").run()
  const email = createStudent({ firstName: 'Ann', lastName: 'Lee' })
  const placeholder = createStudent({ firstName: 'Bo', lastName: 'Park' })
  const set = getDb().prepare('UPDATE students SET nsid = ? WHERE id = ?')
  set.run('abc123@school.edu', email)
  set.run('n/a', placeholder)

  closeDb()
  getDb()

  assert.equal(getStudentById(email)?.nsid, 'abc123')
  assert.equal(getStudentById(placeholder)?.nsid, null)
})

test('a bare "ID" column of row numbers is not mapped to student ID', () => {
  const rowNumbers = writeCsv('rownums.csv', ['ID,First Name,Last Name', '1,Ann,Lee', '2,Bo,Park'])
  const realIds = writeCsv('realids.csv', ['ID,First Name,Last Name', 'abc123,Ann,Lee', 'def456,Bo,Park'])

  assert.equal(parseWorkbookForPreview(rowNumbers).sheets[0].suggestedMapping['ID'], 'ignore')
  assert.equal(parseWorkbookForPreview(realIds).sheets[0].suggestedMapping['ID'], 'nsid')
})

test('a failed import rolls back every row instead of leaving half a roster', () => {
  const file = writeCsv('roster.csv', ['First Name,Last Name', 'Ann,Lee', 'Bo,Park'])
  const sheet = parseWorkbookForPreview(file).sheets[0]

  // A category id that doesn't exist fails the events foreign key — after the
  // first row's student has already been created.
  assert.throws(() =>
    commitImport({
      filePath: file,
      fileName: 'roster.csv',
      sheetName: sheet.sheetName,
      eventName: 'Roster',
      eventDate: null,
      categoryId: 'no-such-category',
      mapping: sheet.suggestedMapping
    })
  )

  assert.equal(listStudents().length, 0)
  assert.equal(listEvents().length, 0)
})

test('re-importing the same sheet does not duplicate students or attendance', () => {
  const file = writeCsv('event.csv', ['First Name,Last Name,Email', 'Ann,Lee,ann@x.ca', 'Bo,Park,bo@x.ca'])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  const request = {
    filePath: file,
    fileName: 'event.csv',
    sheetName: sheet.sheetName,
    eventName: 'Mixer',
    eventDate: '2025-03-01',
    categoryId: null,
    mapping: sheet.suggestedMapping
  }

  commitImport(request)
  const second = commitImport(request)

  assert.equal(second.newStudents, 0)
  assert.equal(listStudents().length, 2)
  const count = getDb().prepare('SELECT COUNT(*) as c FROM attendances').get() as { c: number }
  assert.equal(count.c, 2)
})

test('a wiped database has no groups, and a deleted group stays deleted after reopening', () => {
  assert.equal(listCategories().length, 0)

  const other = createCategory('Other', null)
  deleteCategory(other.id)
  closeDb()
  getDb()

  assert.equal(listCategories().length, 0)
})

test('import only suggests a group the user actually has', () => {
  const file = writeCsv('03_15_2026 AgTech Hackathon.csv', ['First Name,Last Name', 'Ann,Lee'])
  assert.equal(parseWorkbookForPreview(file).sheets[0].suggestedCategoryId, null)

  const hackathon = createCategory('Hackathon', 1)
  assert.equal(parseWorkbookForPreview(file).sheets[0].suggestedCategoryId, hackathon.id)
})

test('an ungrouped mixed-year sheet is dated by its Fall/Winter term', () => {
  const file = writeCsv('cohorts.csv', ['First Name,Last Name,Year', 'Ann,Lee,2023', 'Bo,Park,2024'])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  commitImport({
    filePath: file,
    fileName: 'cohorts.csv',
    sheetName: sheet.sheetName,
    eventName: 'Cohort',
    eventDate: null,
    categoryId: null,
    mapping: sheet.suggestedMapping
  })

  const dates = listEvents().map((e) => e.date).sort()
  assert.deepEqual(dates, ['2023-09-01', '2024-09-01'])
})

test('registrar class lists are named from the file, with or without a subject code', () => {
  const withSubject = writeCsv('202209_87599_classlist CMPT 370.csv', ['First Name,Last Name', 'Ann,Lee'])
  const numberOnly = writeCsv('202301_11111_classlist 831.csv', ['First Name,Last Name', 'Ann,Lee'])

  assert.equal(parseWorkbookForPreview(withSubject).sheets[0].suggestedEventName, 'CMPT 370 2022')
  assert.equal(parseWorkbookForPreview(numberOnly).sheets[0].suggestedEventName, '831 2023')
})

test('common student-number headings are recognised as the student ID', () => {
  const file = writeCsv('roster.csv', ['Student Number,First Name,Last Name', '11223344,Ann,Lee', '55667788,Bo,Park'])
  assert.equal(parseWorkbookForPreview(file).sheets[0].suggestedMapping['Student Number'], 'nsid')
})

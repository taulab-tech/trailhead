import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-classlist-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { courseStatusFor, PASS_MARK } from '../src/main/classlist'
import { commitImport, parseWorkbookForPreview } from '../src/main/importer'
import { createStudent, getStudentDetail, listStudents, mergeStudents } from '../src/main/db/students'
import { listCourseCodes } from '../src/main/db/courses'

setWorkbookReader(desktopWorkbookReader)
openDb()

beforeEach(() => wipeDatabase())

// Invented student numbers. Nothing here comes from a real class list.
const PRIYA = '90000001'
const MARCUS = '90000002'
const DEV = '90000003'

function csvCell(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Writes a sheet shaped like a registrar class-list export: a block of
 * label/value rows naming the course, then the student table.
 */
function writeClasslist(
  name: string,
  course: { title: string; term: string; crn?: string },
  students: string[][]
): string {
  const lines = [
    'Course Information,,,,,,,',
    `Course Title,${course.title},,,,,,`,
    `Term,${course.term},,,,,,`,
    `CRN,${course.crn ?? '12345'},,,,,,`,
    'Duration,03/Sep/2025 - 07/Apr/2026,,,,,,',
    'Status,Active,,,,,,',
    ',,,,,,,',
    'Enrollment Counts,,,,,,,',
    ',Maximum,Actual,Remaining,,,,',
    'Enrolment,50,35,15,,,,',
    'Wait List,0,0,0,,,,',
    ',,,,,,,',
    'Summary Class List,,,,,,,',
    'Student Name,ID,Registration Status,Level,Credit Units,Midterm,Original Final Grade,Class',
    // "Last, First" has a comma in it, so the cells have to be quoted or
    // every column after the name shifts along by one.
    ...students.map((row) => row.map(csvCell).join(','))
  ]
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

function importSheet(file: string): void {
  const parsed = parseWorkbookForPreview(file)
  const sheet = parsed.sheets[0]
  commitImport({
    filePath: file,
    fileName: parsed.fileName,
    sheetName: sheet.sheetName,
    eventName: sheet.suggestedEventName,
    eventDate: sheet.suggestedDate,
    categoryId: sheet.suggestedCategoryId,
    mapping: sheet.suggestedMapping
  })
}

function studentNamed(lastName: string) {
  const student = listStudents().find((s) => s.lastName === lastName)
  assert.ok(student, `no student called ${lastName}`)
  return student
}

function coursesOf(lastName: string) {
  return getStudentDetail(studentNamed(lastName).id)!.courses
}

const CAPSTONE = { title: 'Capstone Design Project - GE 495 01', term: '2025 Fall Term - 202509' }

/* ------------------------------ the rules ------------------------------ */

test('a pass is a mark at or above the pass mark, or a P', () => {
  assert.equal(courseStatusFor('88', 'Registered by student'), 'completed')
  assert.equal(courseStatusFor(String(PASS_MARK), 'Registered by student'), 'completed')
  assert.equal(courseStatusFor('P', 'Registered by student'), 'completed')
})

test('a mark below the pass mark is not a pass', () => {
  assert.equal(courseStatusFor(String(PASS_MARK - 1), 'Registered by student'), 'not_completed')
  assert.equal(courseStatusFor('F', 'Registered by student'), 'not_completed')
})

test('registered with no mark yet is in progress', () => {
  assert.equal(courseStatusFor(null, 'Registered by student'), 'in_progress')
  assert.equal(courseStatusFor(null, 'Registered by staff'), 'in_progress')
})

test('no mark and no registration is not in progress', () => {
  assert.equal(courseStatusFor(null, 'Withdrawn'), 'not_completed')
  assert.equal(courseStatusFor(null, null), 'not_completed')
})

test('auditing earns no credit, whatever the mark says', () => {
  assert.equal(courseStatusFor('AU', 'Registered by student'), 'audited')
  assert.equal(courseStatusFor('88', 'Change to AU - no tuit credit'), 'audited')
  assert.equal(courseStatusFor('88', 'Audit - 50% tuition'), 'audited')
})

/* ---------------------------- the import ------------------------------- */

test('a class list records the course, the term and each mark', () => {
  importSheet(
    writeClasslist('202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '87', 'Fourth Year'],
      ['Webb, Marcus', MARCUS, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', 'P', 'Third Year']
    ])
  )

  const priya = coursesOf('Raman')
  assert.equal(priya.length, 1)
  assert.equal(priya[0].courseCode, 'GE 495')
  assert.equal(priya[0].term, '202509')
  assert.equal(priya[0].termLabel, '2025 Fall Term')
  assert.equal(priya[0].creditUnits, 3)
  assert.equal(priya[0].grade, '87')
  assert.equal(priya[0].status, 'completed')

  assert.equal(coursesOf('Webb')[0].status, 'completed')
})

test('the course code comes from the title even when the file name omits it', () => {
  importSheet(
    writeClasslist(
      '202309_90482_classlist 850.csv',
      { title: 'Adv Tech Innovation Management - GE 850 01', term: '2023 Fall Term - 202309' },
      [['Okonkwo, Dev', DEV, 'Registered by student', 'Graduate Studies Level', '3.0', 'Not Available', '87', 'Not Available']]
    )
  )
  assert.equal(coursesOf('Okonkwo')[0].courseCode, 'GE 850')
})

test('the Class column becomes the year of study, and its placeholders do not', () => {
  importSheet(
    writeClasslist('202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '87', 'Fourth Year'],
      ['Webb, Marcus', MARCUS, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '87', 'Not Available'],
      ['Okonkwo, Dev', DEV, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '87', 'Not applicable']
    ])
  )

  assert.equal(studentNamed('Raman').yearInProgram, 'Fourth Year')
  assert.equal(studentNamed('Webb').yearInProgram, null)
  assert.equal(studentNamed('Okonkwo').yearInProgram, null)
})

test('re-importing after marks are posted updates the record instead of adding another', () => {
  importSheet(
    writeClasslist('during-202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '', 'Fourth Year']
    ])
  )
  assert.equal(coursesOf('Raman')[0].status, 'in_progress')
  assert.equal(coursesOf('Raman')[0].grade, null)

  importSheet(
    writeClasslist('after-202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '91', 'Fourth Year']
    ])
  )

  const courses = coursesOf('Raman')
  assert.equal(courses.length, 1, 'the same course in the same term is one record')
  assert.equal(courses[0].grade, '91')
  assert.equal(courses[0].status, 'completed')
})

test('the same course in a later term is a separate record', () => {
  for (const [name, term] of [
    ['202409_86478_classlist GE 495.csv', '2024 Fall Term - 202409'],
    ['202509_86478_classlist GE 495.csv', '2025 Fall Term - 202509']
  ]) {
    importSheet(
      writeClasslist(name, { title: CAPSTONE.title, term }, [
        ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '87', 'Fourth Year']
      ])
    )
  }

  assert.deepEqual(
    coursesOf('Raman').map((c) => c.term),
    ['202509', '202409'],
    'newest term first'
  )
})

test('several courses build up on one student across class lists', () => {
  importSheet(
    writeClasslist(
      '202501_28806_classlist GE 431.csv',
      { title: 'Engineer Entrepreneur Capstone - GE 431 02', term: '2025 Winter Term - 202501' },
      [['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '82', 'Third Year']]
    )
  )
  importSheet(
    writeClasslist(
      '202509_88084_classlist GE 450.csv',
      { title: 'Technology Innovation Mgt - GE 450 01', term: '2025 Fall Term - 202509' },
      [['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', 'AU', 'Fourth Year']]
    )
  )

  assert.equal(listStudents().length, 1, 'the same student ID is one person')
  assert.deepEqual(
    coursesOf('Raman').map((c) => `${c.courseCode}:${c.status}`),
    ['GE 450:audited', 'GE 431:completed']
  )

  assert.deepEqual(listCourseCodes(), [
    { courseCode: 'GE 431', students: 1, completed: 1 },
    { courseCode: 'GE 450', students: 1, completed: 0 }
  ])
})

test('an ordinary roster records no courses', () => {
  const file = path.join(tmpDir, 'hackathon.csv')
  fs.writeFileSync(file, ['First Name,Last Name,Email', 'Priya,Raman,priya@example.com'].join('\n'))
  importSheet(file)
  assert.equal(coursesOf('Raman').length, 0)
})

test('merging two records brings their courses together', () => {
  importSheet(
    writeClasslist(
      '202501_28806_classlist GE 431.csv',
      { title: 'Engineer Entrepreneur Capstone - GE 431 02', term: '2025 Winter Term - 202501' },
      [['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '82', 'Third Year']]
    )
  )
  const keep = studentNamed('Raman').id

  createStudent({ firstName: 'Priya', lastName: 'Ramen' })
  importSheet(
    writeClasslist(
      '202509_88084_classlist GE 450.csv',
      { title: 'Technology Innovation Mgt - GE 450 01', term: '2025 Fall Term - 202509' },
      [['Ramen, Priya', '', 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '90', 'Fourth Year']]
    )
  )
  const other = studentNamed('Ramen').id

  mergeStudents(keep, other)

  assert.deepEqual(
    getStudentDetail(keep)!.courses.map((c) => c.courseCode),
    ['GE 450', 'GE 431']
  )
})

test('a merge clash keeps the record that has a mark', () => {
  importSheet(
    writeClasslist('a-202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Raman, Priya', PRIYA, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '91', 'Fourth Year']
    ])
  )
  const withGrade = studentNamed('Raman').id

  importSheet(
    writeClasslist('b-202509_86478_classlist GE 495.csv', CAPSTONE, [
      ['Ramen, Priya', MARCUS, 'Registered by student', 'Undergraduate Level', '3.0', 'Not Available', '', 'Fourth Year']
    ])
  )
  const withoutGrade = studentNamed('Ramen').id

  // Keep the record with no mark; the merge should still end up with 91.
  mergeStudents(withoutGrade, withGrade)

  const courses = getStudentDetail(withoutGrade)!.courses
  assert.equal(courses.length, 1)
  assert.equal(courses[0].grade, '91')
  assert.equal(courses[0].status, 'completed')
})

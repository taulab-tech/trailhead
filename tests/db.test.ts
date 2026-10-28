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
import { buildPositionQuery, isLinkedInProfile, parseLinkedInResult } from '../src/main/positionLookup'
import { updateStudent } from '../src/main/db/students'
import { migrateLegacyDataDir } from '../src/main/dataDir'
import { commitImport, harmonizeClasslistEventNames, parseWorkbookForPreview, previewImport } from '../src/main/importer'

beforeEach(() => wipeDatabase())

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

test('an ID written as an email matches the bare ID when the names agree', () => {
  const first = matchStudent(person('Ann', 'Lee', 'abc123'))
  const second = matchStudent(person('Annie', 'Lee', 'ABC123@school.edu'))
  const third = matchStudent(person('Ann', 'Lee', 'abc123@other.org'))

  assert.equal(second.created, false)
  assert.equal(second.studentId, first.studentId)
  assert.equal(third.studentId, first.studentId)
})

test('an email-form ID stored first still matches a bare ID later', () => {
  const first = matchStudent(person('Chris', 'Elash', 'cel123@school.edu'))
  const second = matchStudent(person('Christopher', 'Elash', 'cel123'))

  assert.equal(second.studentId, first.studentId)
})

test('the same email username with different names stays two students', () => {
  const smith = matchStudent(person('John', 'Smith', 'john@gmail.com'))
  const park = matchStudent(person('John', 'Park', 'john@hotmail.com'))

  assert.notEqual(smith.studentId, park.studentId)
  assert.equal(getStudentById(smith.studentId)?.nsid, 'john@gmail.com')
  assert.equal(getStudentById(park.studentId)?.nsid, 'john@hotmail.com')
})

test('placeholder student IDs like "N/A" never link different students', () => {
  const first = matchStudent(person('Ann', 'Lee', 'n/a'))
  const second = matchStudent(person('Bo', 'Park', 'N/A'))

  assert.notEqual(first.studentId, second.studentId)
  assert.equal(getStudentById(first.studentId)?.nsid, null)
})

test('opening an older database clears placeholder student IDs', () => {
  const placeholder = createStudent({ firstName: 'Bo', lastName: 'Park' })
  getDb().prepare('UPDATE students SET nsid = ? WHERE id = ?').run('n/a', placeholder)

  closeDb()
  getDb()

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

test('the import preview reports each row without saving anything', () => {
  matchStudent(person('Ann', 'Lee', 'abc123'))
  const file = writeCsv('preview.csv', [
    'Student ID,First Name,Last Name',
    'abc123,Ann,Lee',
    'zzz999,Bo,Park',
    ',,',
    'zzz999,Bo,Park'
  ])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  const request = {
    filePath: file,
    fileName: 'preview.csv',
    sheetName: sheet.sheetName,
    eventName: 'Preview',
    eventDate: '2025-01-01',
    categoryId: null,
    mapping: sheet.suggestedMapping,
    rows: [...sheet.rows, { 'Student ID': '', 'First Name': '', 'Last Name': '' }]
  }

  const preview = previewImport(request)

  assert.deepEqual(
    preview.rows.map((r) => r.status),
    ['existing', 'new', 'repeat', 'skipped']
  )
  assert.equal(preview.rows[0].matchedName, 'Ann Lee')
  assert.equal(preview.rows[2].repeatOfRow, 1)
  assert.equal(listStudents().length, 1)
  assert.equal(listEvents().length, 0)
})

test('edited and removed rows are what gets imported', () => {
  const file = writeCsv('edit.csv', ['First Name,Last Name', 'Ann,Lee', 'Bo,Prak', 'Typo,Row'])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  const [ann, bo] = sheet.rows

  commitImport({
    filePath: file,
    fileName: 'edit.csv',
    sheetName: sheet.sheetName,
    eventName: 'Edited',
    eventDate: '2025-01-01',
    categoryId: null,
    mapping: sheet.suggestedMapping,
    rows: [ann, { ...bo, 'Last Name': 'Park' }]
  })

  assert.deepEqual(
    listStudents().map((s) => `${s.firstName} ${s.lastName}`).sort(),
    ['Ann Lee', 'Bo Park']
  )
})

function importClasslist(fileName: string, students: string[][]): void {
  const file = writeCsv(fileName, ['First Name,Last Name', ...students.map((s) => s.join(','))])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  commitImport({
    filePath: file,
    fileName,
    sheetName: sheet.sheetName,
    eventName: sheet.suggestedEventName,
    eventDate: sheet.suggestedDate,
    categoryId: null,
    mapping: sheet.suggestedMapping
  })
}

const eventNames = (): string[] => listEvents().map((e) => e.name).sort()

test('a class list missing its subject borrows it from the same course, in either import order', () => {
  importClasslist('202209_86478_classlist GE 495.csv', [['Ann', 'Lee']])
  importClasslist('202309_86478_classlist 495.csv', [['Bo', 'Park']])
  assert.deepEqual(eventNames(), ['GE 495 2022', 'GE 495 2023'])

  wipeDatabase()
  importClasslist('202309_86478_classlist 495.csv', [['Bo', 'Park']])
  importClasslist('202209_86478_classlist GE 495.csv', [['Ann', 'Lee']])
  assert.deepEqual(eventNames(), ['GE 495 2022', 'GE 495 2023'])
})

test('a course number used by two subjects is left alone', () => {
  importClasslist('202209_1_classlist CMPT 370.csv', [['Ann', 'Lee']])
  importClasslist('202209_2_classlist MATH 370.csv', [['Bo', 'Park']])
  importClasslist('202309_3_classlist 370.csv', [['Cy', 'Ng']])
  assert.deepEqual(eventNames(), ['370 2023', 'CMPT 370 2022', 'MATH 370 2022'])
})

test('the same offering imported under both names merges into one event without double-counting', () => {
  importClasslist('202309_86478_classlist 495.csv', [['Ann', 'Lee'], ['Bo', 'Park']])
  // Simulate an older database where both names already exist side by side.
  getDb().prepare("UPDATE events SET name = '495 2023'").run()
  const file = writeCsv('202309_86478_classlist GE 495.csv', ['First Name,Last Name', 'Ann,Lee', 'Cy,Ng'])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  getDb().prepare("UPDATE events SET source_file = '202309_86478_classlist 495.csv'").run()
  commitImport({
    filePath: file,
    fileName: '202309_86478_classlist GE 495.csv',
    sheetName: sheet.sheetName,
    eventName: 'GE 495 2023',
    eventDate: sheet.suggestedDate,
    categoryId: null,
    mapping: sheet.suggestedMapping
  })
  harmonizeClasslistEventNames()

  assert.deepEqual(eventNames(), ['GE 495 2023'])
  const count = getDb().prepare('SELECT COUNT(*) as c FROM attendances').get() as { c: number }
  assert.equal(count.c, 3)
})

test('LinkedIn search results are read into name, headline, experience, education and location', () => {
  const [engineer, researcher, noHeadline] = [
    {
      title: 'Nadia Oyelaran - Electrical Engineer at NORTHWIND | LinkedIn',
      body: "Electrical Engineer at NORTHWIND · Experience: NORTHWIND · Education: University of Saskatchewan · Location: Saskatoon · 281 connections on LinkedIn. View Nadia Oyelaran's profile on LinkedIn, a professional community of 1 billion members.",
      href: 'https://ca.linkedin.com/in/nadia-oyelaran-1'
    },
    {
      title: 'Nadia Oyelaran - Coadjunct Researcher | LinkedIn',
      body: "Coadjunct Researcher · Hi, I'm a coadjunct physics researcher at Rutgers University New Brunswick currently working on quantum computing using superconducting qubits. · Experience: Rutgers ...",
      href: 'https://www.linkedin.com/in/nadia-oyelaran-2'
    },
    {
      title: 'Nadia Oyelaran - Catonsville, Maryland, United States | Professional ...',
      body: "Education: The Community College of Baltimore County · Location: Catonsville. View Nadia Oyelaran's profile on LinkedIn, a professional community of 1 billion members.",
      href: 'https://www.linkedin.com/in/nadia-oyelaran-3'
    }
  ].map(parseLinkedInResult)

  assert.deepEqual(
    { ...engineer, snippet: undefined },
    {
      name: 'Nadia Oyelaran',
      headline: 'Electrical Engineer at NORTHWIND',
      experience: 'NORTHWIND',
      education: 'University of Saskatchewan',
      location: 'Saskatoon',
      url: 'https://ca.linkedin.com/in/nadia-oyelaran-1',
      snippet: undefined
    }
  )
  assert.equal(researcher.headline, 'Coadjunct Researcher')
  assert.equal(researcher.experience, 'Rutgers')
  // A title that only carries a location isn't a job headline.
  assert.equal(noHeadline.headline, null)
  assert.equal(noHeadline.education, 'The Community College of Baltimore County')
})

test('a headline missing from the result title is taken from the start of the snippet', () => {
  const r = parseLinkedInResult({
    title: 'Dylan Haussecker - University of Saskatchewan | LinkedIn',
    body: 'Co-Founder and CTO @ KeenSite · Experience: University of Saskatchewan · Education: Wentworth Institute of Technology · Location: Saskatoon · 500+ connections on LinkedIn.',
    href: 'https://ca.linkedin.com/in/example'
  })
  assert.equal(r.headline, 'Co-Founder and CTO @ KeenSite')
  assert.equal(r.experience, 'University of Saskatchewan')

  // No headline anywhere: the title's organisation isn't promoted to a job title.
  const bare = parseLinkedInResult({
    title: 'Dylan Haussecker - University of Saskatchewan | LinkedIn',
    body: 'Experience: University of Saskatchewan · Education: Wentworth Institute of Technology · Location: Saskatoon',
    href: 'https://ca.linkedin.com/in/example'
  })
  assert.equal(bare.headline, null)
})

test('the LinkedIn query quotes the name and keeps extra words outside the quotes', () => {
  assert.equal(buildPositionQuery('Nadia', 'Oyelaran'), '"Nadia Oyelaran" site:linkedin.com/in')
  assert.equal(buildPositionQuery('Ann "AJ"', 'Lee', 'Saskatoon'), '"Ann AJ Lee" site:linkedin.com/in Saskatoon')
  // Typing the name into the narrowing box doesn't repeat it in the search.
  assert.equal(buildPositionQuery('Nadia', 'Oyelaran', 'nadia oyelaran'), '"Nadia Oyelaran" site:linkedin.com/in')
  assert.equal(buildPositionQuery('Nadia', 'Oyelaran', 'Nadia Saskatoon'), '"Nadia Oyelaran" site:linkedin.com/in Saskatoon')
})

test('LinkedIn profiles are recognised by link, or by title when the link is a redirect', () => {
  const profile = (title: string, href: string) => isLinkedInProfile({ title, body: '', href })
  assert.equal(profile('Nadia Oyelaran - Engineer | LinkedIn', 'https://ca.linkedin.com/in/x'), true)
  assert.equal(profile('Nadia Oyelaran - Engineer | LinkedIn', 'https://www.bing.com/ck/a?u=abc'), true)
  assert.equal(profile('Nadia Oyelaran posts', 'https://www.linkedin.com/posts/x'), false)
  assert.equal(profile('Nadia Oyelaran - Facebook', 'https://facebook.com/x'), false)
})

test('a saved position is kept when two students are merged', () => {
  const keep = createStudent({ firstName: 'Chris', lastName: 'Elash' })
  const merge = createStudent({ firstName: 'Christopher', lastName: 'Elash' })
  updateStudent(merge, {
    position: 'Engineer · NORTHWIND',
    positionUrl: 'https://www.linkedin.com/in/x',
    positionFoundAt: '2026-10-28T00:00:00.000Z'
  })

  mergeStudents(keep, merge)

  const kept = getStudentById(keep)
  assert.equal(kept?.position, 'Engineer · NORTHWIND')
  assert.equal(kept?.positionUrl, 'https://www.linkedin.com/in/x')
})

test('data from the old sigma-attendance folder is copied once, never over existing data', () => {
  const legacy = path.join(tmpDir, 'legacy')
  const current = path.join(tmpDir, 'current')
  fs.mkdirSync(path.join(legacy, 'backups'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'sigma-attendance.db'), 'old-db')
  fs.writeFileSync(path.join(legacy, 'sigma-attendance.db-wal'), 'old-wal')
  fs.writeFileSync(path.join(legacy, 'backups', 'sigma-attendance-2026-10-01.db'), 'backup')

  migrateLegacyDataDir(legacy, current)

  assert.equal(fs.readFileSync(path.join(current, 'trailhead.db'), 'utf8'), 'old-db')
  assert.equal(fs.readFileSync(path.join(current, 'trailhead.db-wal'), 'utf8'), 'old-wal')
  assert.ok(fs.existsSync(path.join(current, 'backups', 'sigma-attendance-2026-10-01.db')))
  assert.ok(fs.existsSync(path.join(legacy, 'sigma-attendance.db')), 'the old folder is left in place')

  fs.writeFileSync(path.join(current, 'trailhead.db'), 'new-data')
  migrateLegacyDataDir(legacy, current)
  assert.equal(fs.readFileSync(path.join(current, 'trailhead.db'), 'utf8'), 'new-data')
})

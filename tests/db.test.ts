import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Must be set before the first getDb() call, which is lazy, so setting it
// here (after the hoisted imports) still takes effect.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-test-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { getDb, wipeDatabase } from '../src/main/db'
import { closeDb, openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { createStudent, getStudentById, listStudents, mergeStudents } from '../src/main/db/students'
import { listPossibleDuplicates, suggestDuplicate } from '../src/main/db/duplicates'
import { listEvents } from '../src/main/db/events'
import { createCategory, deleteCategory, listCategories } from '../src/main/db/categories'
import { detectFuzzyDuplicates, matchStudent } from '../src/main/matching'
import {
  buildPositionQuery,
  configureSearchForTesting,
  isLinkedInProfile,
  lookUpPosition,
  nameMatches,
  ownPart,
  parseLinkedInResult,
  rankByInstitution
} from '../src/main/positionLookup'
import { getSettings, setInstitutionNames } from '../src/main/db/settings'
import { namesSwapped, strongMatch } from '../src/shared/positions'
import { buildJourneys, pathLinks, type Journey } from '../src/shared/journeys'
import {
  configureLookupsForTesting,
  dismissLookups,
  enqueueLookups,
  getLookupStatus,
  listLookups,
  waitForLookupsIdle
} from '../src/main/lookupQueue'
import { updateStudent } from '../src/main/db/students'
import { migrateLegacyDataDir } from '../src/main/dataDir'
import { commitImport, harmonizeClasslistEventNames, parseWorkbookForPreview, previewImport } from '../src/main/importer'

setWorkbookReader(desktopWorkbookReader)
openDb()

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
  openDb()

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
  openDb()

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
      snippet: undefined,
      institutionMatch: null
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

test('institution names are saved trimmed and de-duplicated, and can be cleared', () => {
  assert.deepEqual(setInstitutionNames([' University of Saskatchewan ', 'USask', 'usask', '']), [
    'University of Saskatchewan',
    'USask'
  ])
  assert.deepEqual(getSettings().institutionNames, ['University of Saskatchewan', 'USask'])
  setInstitutionNames([])
  assert.deepEqual(getSettings().institutionNames, [])
})

test('profiles that mention the institution are marked and listed first', () => {
  const candidate = (name: string, education: string | null, snippet = '') => ({
    name, headline: null, experience: null, education, location: null, url: `https://x/${name}`, snippet, institutionMatch: null
  })
  const ranked = rankByInstitution(
    [
      candidate('Elsewhere', 'Rutgers University'),
      candidate('Mentioned', null, 'Research Assistant at USask · Location: Saskatoon'),
      candidate('Studied', 'University of Saskatchewan')
    ],
    ['University of Saskatchewan', 'USask']
  )
  assert.deepEqual(ranked.map((c) => c.name), ['Studied', 'Mentioned', 'Elsewhere'])
  assert.deepEqual(ranked.map((c) => c.institutionMatch), ['University of Saskatchewan', 'USask', null])
  // With no institution configured, order is untouched and nothing is marked.
  assert.deepEqual(rankByInstitution(ranked, []).map((c) => c.institutionMatch), [null, null, null])
})

test('a position keeps its organisation and start month, including through a merge', () => {
  const keep = createStudent({ firstName: 'Dylan', lastName: 'Haussecker' })
  const merge = createStudent({ firstName: 'Dylan', lastName: 'H' })
  updateStudent(merge, { position: 'Co-Founder and CTO', positionOrg: 'KeenSite', positionSince: '2024-05' })

  mergeStudents(keep, merge)

  const kept = getStudentById(keep)
  assert.equal(kept?.positionOrg, 'KeenSite')
  assert.equal(kept?.positionSince, '2024-05')
})

test('positions saved as one line are split into title and organisation on open', () => {
  const cameco = createStudent({ firstName: 'Carson', lastName: 'Daly' })
  const keensite = createStudent({ firstName: 'Dylan', lastName: 'Haussecker' })
  updateStudent(cameco, { position: 'PLC Programmer at Cameco' })
  updateStudent(keensite, { position: 'CTO of KeenSite' })

  closeDb()
  openDb()

  assert.equal(getStudentById(cameco)?.position, 'PLC Programmer')
  assert.equal(getStudentById(cameco)?.positionOrg, 'Cameco')
  assert.equal(getStudentById(keensite)?.position, 'CTO of KeenSite')
  assert.equal(getStudentById(keensite)?.positionOrg, null)
})

test('a strong match needs exactly one titled profile at the institution, with the student’s last name', () => {
  const c = (name: string, headline: string | null, institutionMatch: string | null) => ({ name, headline, institutionMatch })
  assert.equal(strongMatch([c('Ann Lee', 'Engineer at X', 'USask'), c('Ann Lee', 'Nurse', null)], 'Lee')?.headline, 'Engineer at X')
  assert.equal(strongMatch([c('Ann Lee', 'Engineer', 'USask'), c('Ann Lee', 'Nurse', 'USask')], 'Lee'), null)
  assert.equal(strongMatch([c('Ann Lee', null, 'USask')], 'Lee'), null)
  assert.equal(strongMatch([c('Ann Park', 'Engineer', 'USask')], 'Lee'), null)
  assert.equal(strongMatch([c('Ann Lee', 'Engineer', null)], 'Lee'), null)
})

test('an import reports the ids of the students it created', () => {
  matchStudent(person('Ann', 'Lee', 'abc123'))
  const file = writeCsv('ids.csv', ['Student ID,First Name,Last Name', 'abc123,Ann,Lee', 'zzz999,Bo,Park'])
  const sheet = parseWorkbookForPreview(file).sheets[0]
  const result = commitImport({
    filePath: file, fileName: 'ids.csv', sheetName: sheet.sheetName, eventName: 'Ids',
    eventDate: '2025-01-01', categoryId: null, mapping: sheet.suggestedMapping
  })
  const bo = listStudents().find((s) => s.firstName === 'Bo')!
  assert.deepEqual(result.newStudentIds, [bo.id])
})

test('background lookups search queued students and save nothing until approved', async () => {
  const searched: string[] = []
  configureLookupsForTesting({
    secondsPerSearch: 0,
    search: async (first, last) => {
      searched.push(`${first} ${last}`)
      return { query: `"${first} ${last}"`, resultCount: 0, candidates: [], broadenedFrom: null, otherNamesHidden: 0, attempts: [] }
    }
  })
  try {
    const ann = createStudent({ firstName: 'Ann', lastName: 'Lee' })
    const bo = createStudent({ firstName: 'Bo', lastName: 'Park' })
    const employed = createStudent({ firstName: 'Cy', lastName: 'Ng' })
    updateStudent(employed, { position: 'Engineer' })

    // Students with a position are skipped; queueing someone twice is a no-op.
    assert.equal(enqueueLookups([ann, bo, employed, ann]), 2)
    await waitForLookupsIdle()

    assert.deepEqual(searched.sort(), ['Ann Lee', 'Bo Park'])
    assert.deepEqual(listLookups().map((i) => i.status), ['done', 'done'])
    assert.equal(getStudentById(ann)?.position, null)

    dismissLookups([ann, bo])
    assert.equal(getLookupStatus().done, 0)
  } finally {
    configureLookupsForTesting({})
  }
})

test('background lookups pause after three failed searches in a row', async () => {
  let calls = 0
  configureLookupsForTesting({
    secondsPerSearch: 0,
    search: async () => {
      calls++
      throw new Error('The search didn’t work (rate limited).')
    }
  })
  try {
    const ids = ['A', 'B', 'C', 'D', 'E'].map((n) => createStudent({ firstName: n, lastName: 'Test' }))
    enqueueLookups(ids)
    await waitForLookupsIdle()

    const status = getLookupStatus()
    assert.equal(calls, 3)
    assert.equal(status.failed, 3)
    assert.equal(status.queued, 2)
    assert.match(status.pausedReason ?? '', /rate limited/)
  } finally {
    configureLookupsForTesting({})
  }
})

test('a result that runs on into other people keeps only its own person’s details', () => {
  const r = parseLinkedInResult({
    title:
      'Tyrel Kostyk - Firmware Developer II at Bourgault Industries ...McKenzie Maduke - Resource Management Officer at Parks Canada ...Cheryl Brown - Payroll-Data Entry / Tax assistant at Baker | LinkedIn',
    body:
      'Firmware Developer II at Bourgault Industries Ltd. · Experienced Computer Engineering EIT with a demonstrated history of working on electronics ...McKenzie Maduke - Resource Management Officer at Parks Canada · Experience: Parks Canada · Education: Brandon University · Location: Whitehorse ...Cassie Lam - Senior experienced Japanese Teacher · University of Saskatchewan',
    href: 'https://ca.linkedin.com/in/example'
  })
  assert.equal(r.name, 'Tyrel Kostyk')
  assert.equal(r.headline, 'Firmware Developer II at Bourgault Industries')
  assert.equal(r.experience, null)
  assert.equal(r.education, null)
  assert.equal(r.location, null)
  assert.doesNotMatch(r.snippet, /Maduke|Parks Canada|Saskatchewan/)
  // So another person's school can't earn it a "Studied at" badge either.
  assert.equal(rankByInstitution([r], ['University of Saskatchewan'])[0].institutionMatch, null)
  // An ordinary snippet is untouched.
  assert.equal(ownPart('Engineer at X · Experience: X · Location: Saskatoon'), 'Engineer at X · Experience: X · Location: Saskatoon')
})

test('only profiles with the student’s name count, in either order and allowing short first names', () => {
  assert.equal(nameMatches('Tyrel Kostyk', 'Marlow', 'Blake'), false)
  assert.equal(nameMatches('Blake Marlow', 'Marlow', 'Blake'), true)
  assert.equal(nameMatches('Christopher Elash', 'Chris', 'Elash'), true)
  assert.equal(nameMatches('Chris Elashian', 'Chris', 'Elash'), false)
  assert.equal(nameMatches('Nadia Oyelaran', 'Nadia', 'Oyelaran'), true)
  assert.equal(nameMatches('Nadira Oyelaran', 'Nadia', 'Oyelaran'), false)
})

test('a profile shown with only a last initial matches when its address spells the full name', () => {
  assert.equal(nameMatches('Marisol O.', 'Marisol', 'Okafor', 'https://ca.linkedin.com/in/marisolokafor'), true)
  assert.equal(nameMatches('Marisol O.', 'Marisol', 'Okafor', 'https://ca.linkedin.com/in/marisol-okafor-12ab'), true)
  assert.equal(nameMatches('Marisol O.', 'Marisol', 'Okafor', 'https://ca.linkedin.com/in/marisol-oduya'), false)
  assert.equal(nameMatches('Marisol O.', 'Marisol', 'Okafor'), false)
  assert.equal(nameMatches('Lena O.', 'Marisol', 'Okafor', 'https://ca.linkedin.com/in/marisolokafor'), false)

  const r = parseLinkedInResult({
    title: 'Marisol O. - Resident Engineering Team - E&I Mining | LinkedIn',
    body: 'Marisol is a dynamic, self-motivated engineering professional with over five years of experience in the mining and consulting ...',
    href: 'https://ca.linkedin.com/in/marisolokafor'
  })
  assert.equal(r.name, 'Marisol O.')
  assert.equal(r.headline, 'Resident Engineering Team - E&I Mining')
})

test('a profile with the student’s name in reverse order is spotted, and still counts as them', () => {
  assert.equal(namesSwapped('Blake Marlow', 'Marlow', 'Blake'), true)
  assert.equal(nameMatches('Blake Marlow', 'Marlow', 'Blake'), true)
  assert.equal(namesSwapped('Marlow Blake', 'Marlow', 'Blake'), false)
  assert.equal(namesSwapped('Blake M. Marlow', 'Marlow', 'Blake'), true)
  assert.equal(namesSwapped('Lee Lee', 'Lee', 'Lee'), false)
  assert.equal(namesSwapped('Tyrel Kostyk', 'Marlow', 'Blake'), false)
})

test('when the exact name finds nobody, the reversed name and then a looser search are tried', async () => {
  const queries: string[] = []
  // Stand-in search engine: only the reversed, quoted name finds Blake's profile.
  configureSearchForTesting({
    minSecondsBetweenSearches: 0,
    search: async (query) => {
      queries.push(query)
      if (query === '"Blake Marlow" site:linkedin.com/in') {
        return [
          {
            title: 'Blake Marlow - Aerospace Engineering Graduate Student | LinkedIn',
            body: 'Aerospace Engineering Graduate Student · Education: University of Saskatchewan · Location: Saskatoon',
            href: 'https://ca.linkedin.com/in/blake-marlow'
          }
        ]
      }
      return [{ title: 'Marlow notes', body: 'Not a profile', href: 'https://example.com/marlow' }]
    }
  })
  try {
    const result = await lookUpPosition('Marlow', 'Blake')
    assert.deepEqual(queries, ['"Marlow Blake" site:linkedin.com/in', '"Blake Marlow" site:linkedin.com/in'])
    assert.equal(result.candidates[0]?.name, 'Blake Marlow')
    assert.deepEqual(
      result.attempts.map((a) => a.profilesFound),
      [0, 1]
    )

    // Nobody anywhere: every fallback is tried once, then it stops.
    queries.length = 0
    const nobody = await lookUpPosition('Zed', 'Nobody')
    assert.deepEqual(queries, [
      '"Zed Nobody" site:linkedin.com/in',
      '"Nobody Zed" site:linkedin.com/in',
      'Zed Nobody site:linkedin.com/in'
    ])
    assert.equal(nobody.candidates.length, 0)
    assert.equal(nobody.attempts.length, 3)
  } finally {
    configureSearchForTesting({})
  }
})

test('each student’s path is classified by the dates of the events they attended', () => {
  const categories = [
    { id: 'hack', name: 'Hackathon', stageOrder: 1 },
    { id: 'class', name: 'Class', stageOrder: 2 },
    { id: 'prog', name: 'Program', stageOrder: 3 },
    { id: 'social', name: 'Social', stageOrder: null }
  ]
  const events = [
    { id: 'h24', name: 'Hackathon 2024', date: '2024-03-01', categoryId: 'hack' },
    { id: 'c24', name: 'Class 2024', date: '2024-09-01', categoryId: 'class' },
    { id: 'p25', name: 'Program 2025', date: '2025-06-01', categoryId: 'prog' },
    { id: 'c22', name: 'Class 2022', date: '2022-09-01', categoryId: 'class' },
    { id: 'cx', name: 'Class (undated)', date: null, categoryId: 'class' },
    { id: 's1', name: 'Social', date: '2024-12-01', categoryId: 'social' },
    { id: 'h-same', name: 'Hackathon same day', date: '2024-09-01', categoryId: 'hack' }
  ]
  const sets = [
    { eventId: 'h24', studentIds: ['inOrder', 'skipped', 'single'] },
    { eventId: 'c24', studentIds: ['inOrder', 'tie'] },
    { eventId: 'p25', studentIds: ['inOrder', 'skipped'] },
    { eventId: 'c22', studentIds: ['backwards'] },
    { eventId: 'h-same', studentIds: ['backwards', 'tie'] },
    { eventId: 'cx', studentIds: ['unknown', 'inferred'] },
    { eventId: 's1', studentIds: ['unknown', 'offTrail'] }
  ]
  sets.push({ eventId: 'h24', studentIds: ['unknown', 'inferred'] })
  const dates = [{ studentId: 'inferred', eventId: 'cx', date: '2024-09-01' }]
  const journeys = buildJourneys(events, sets, dates, categories)
  const status = (id: string) => journeys.get(id)!.status

  assert.equal(status('inOrder'), 'in-order')
  assert.deepEqual(journeys.get('inOrder')!.path, [0, 1, 2])
  assert.equal(status('skipped'), 'skipped')
  assert.equal(status('single'), 'single')
  assert.equal(status('backwards'), 'out-of-order') // Class in 2022, then Hackathon in 2024
  assert.deepEqual(journeys.get('backwards')!.path, [1, 0])
  assert.equal(journeys.get('backwards')!.steps.find((s) => s.eventId === 'h-same')!.outOfOrder, true)
  assert.equal(status('tie'), 'in-order') // same-day Hackathon and Class isn't "out of order"
  assert.equal(status('unknown'), 'unknown') // an undated class can't be placed
  assert.equal(status('inferred'), 'in-order') // ...unless the student's term date fills it in
  assert.equal(journeys.get('inferred')!.steps.find((s) => s.eventId === 'cx')!.dateInferred, true)
  assert.equal(status('offTrail'), 'off-trail')
})

test('the overview counts each move between stops once per student', () => {
  const j = (studentId: string, path: number[]): Journey => ({ studentId, steps: [], stops: [...new Set(path)].sort(), path, status: 'in-order' })
  const links = pathLinks([j('a', [0, 1, 2]), j('b', [0, 1]), j('c', [1, 0, 1, 0]), j('d', [0])])
  const count = (from: number, to: number) => links.find((l) => l.from === from && l.to === to)?.count ?? 0
  assert.equal(count(0, 1), 3) // a, b, and c (who went 1 → 0 → 1 → 0)
  assert.equal(count(1, 2), 1)
  assert.equal(count(1, 0), 1) // c went back twice but is one student
  assert.equal(count(0, 2), 0)
})

test('an NSID and a student number for one person are not treated as two people', () => {
  // The registrar's class lists carry the student number; the contact
  // trackers carry the NSID. The same person arrives with one of each, and
  // treating that as a contradiction splits them into two records.
  const first = createStudent({ firstName: 'Marisol', lastName: 'Okafor', nsid: '90000123' })
  const { studentId, created } = matchStudent({
    firstName: 'Marisol',
    lastName: 'Okafor',
    nsid: 'mko456',
    emails: [],
    phones: []
  })

  assert.equal(created, false, 'should find the person already on file')
  assert.equal(studentId, first)
})

test('two different student numbers are still two different people', () => {
  createStudent({ firstName: 'Marisol', lastName: 'Okafor', nsid: '90000123' })
  const { created } = matchStudent({
    firstName: 'Marisol',
    lastName: 'Okafor',
    nsid: '90000999',
    emails: [],
    phones: []
  })
  assert.equal(created, true, 'one number belongs to one person')
})

test('two different NSIDs are still two different people', () => {
  createStudent({ firstName: 'Marisol', lastName: 'Okafor', nsid: 'mko456' })
  const { created } = matchStudent({
    firstName: 'Marisol',
    lastName: 'Okafor',
    nsid: 'zzz111',
    emails: [],
    phones: []
  })
  assert.equal(created, true)
})

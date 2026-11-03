import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-reimport-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { commitImport, parseWorkbookForPreview, previewImport } from '../src/main/importer'
import { listStudents, updateStudent } from '../src/main/db/students'
import { markFieldsManual } from '../src/main/db/fieldSources'
import type { ImportSheetRequest } from '../src/shared/types'

setWorkbookReader(desktopWorkbookReader)
openDb()

beforeEach(() => wipeDatabase())

let fileCount = 0

/** An ordinary event roster, dated by the event. */
function roster(rows: string[][], headers = ['First Name', 'Last Name', 'NSID', 'College', 'Program']): string {
  const file = path.join(tmpDir, `roster-${++fileCount}.csv`)
  fs.writeFileSync(file, [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'))
  return file
}

function requestFor(file: string, eventName: string, eventDate: string | null): ImportSheetRequest {
  const parsed = parseWorkbookForPreview(file)
  const sheet = parsed.sheets[0]
  return {
    filePath: file,
    fileName: parsed.fileName,
    sheetName: sheet.sheetName,
    eventName,
    eventDate,
    categoryId: null,
    mapping: sheet.suggestedMapping
  }
}

function importRoster(
  file: string,
  eventName: string,
  eventDate: string | null,
  rejectedUpdates: string[] = []
): ReturnType<typeof commitImport> {
  return commitImport({ ...requestFor(file, eventName, eventDate), rejectedUpdates })
}

function student(lastName: string) {
  const found = listStudents().find((s) => s.lastName === lastName)
  assert.ok(found, `no student called ${lastName}`)
  return found
}

/* ------------------------------ filling in ------------------------------ */

test('a blank detail is filled in without asking', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', '', '']]), 'Hackathon', '2025-01-17')
  // An empty cell is stored as an empty string rather than NULL; either way
  // there is nothing there to lose.
  assert.ok(!student('Raman').college)

  const result = importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Social', '2025-12-01')

  assert.equal(result.blanksFilled, 2)
  assert.equal(result.updatedFields, 0, 'nothing was replaced')
  assert.equal(student('Raman').college, 'EN')
  assert.equal(student('Raman').program, 'BE')
})

/* --------------------------- newer data wins ---------------------------- */

test('a newer roster refreshes a detail that has changed', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Hackathon', '2024-01-17')

  const preview = previewImport(requestFor(roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']]), 'Social', '2026-01-17'))
  assert.equal(preview.updates.length, 2)
  assert.deepEqual(
    preview.updates.map((u) => `${u.label}: ${u.from} → ${u.to}`).sort(),
    ['College: EN → GP', 'Program: BE → MENG']
  )

  importRoster(roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']]), 'Social', '2026-01-17')
  assert.equal(student('Raman').college, 'GP')
})

test('an older roster does not undo a newer one', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']]), 'Recent', '2026-01-17')
  const result = importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Old', '2021-01-17')

  assert.equal(result.updatedFields, 0)
  assert.equal(student('Raman').college, 'GP', 'the newer value stands')
})

test('an undated roster never replaces anything', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Dated', '2024-01-17')
  const result = importRoster(roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']]), 'Undated', null)

  assert.equal(result.updatedFields, 0, 'nothing can be shown to be newer')
  assert.equal(student('Raman').college, 'EN')
})

/* ------------------------------ idempotent ------------------------------ */

test('importing the same file twice changes nothing the second time', () => {
  const file = roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']])
  importRoster(file, 'Hackathon', '2025-01-17')

  const again = importRoster(file, 'Hackathon', '2025-01-17')
  assert.equal(again.blanksFilled, 0)
  assert.equal(again.updatedFields, 0)
  assert.equal(again.newStudents, 0)
  assert.equal(again.matchedExisting, 1)
})

/* ------------------------- what people type in -------------------------- */

test('a detail somebody typed in is proposed, never replaced quietly', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Hackathon', '2024-01-17')
  const id = student('Raman').id

  // As the app does when the field is edited by hand.
  updateStudent(id, { college: 'Corrected' })
  markFieldsManual(id, ['college'])

  const file = roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']])
  const preview = previewImport(requestFor(file, 'Later', '2026-01-17'))
  const proposed = preview.updates.find((u) => u.field === 'college')
  assert.ok(proposed, 'the change is offered')
  assert.equal(proposed.fromManual, true)
  assert.equal(proposed.from, 'Corrected')

  // Declining it leaves the typed-in value alone.
  importRoster(file, 'Later', '2026-01-17', [proposed.key])
  assert.equal(student('Raman').college, 'Corrected')
})

test('a typed-in detail is replaced when the user accepts the change', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Hackathon', '2024-01-17')
  const id = student('Raman').id
  updateStudent(id, { college: 'Corrected' })
  markFieldsManual(id, ['college'])

  importRoster(roster([['Priya', 'Raman', 'prm501', 'GP', 'BE']]), 'Later', '2026-01-17')
  assert.equal(student('Raman').college, 'GP')
})

/* ------------------------------- the preview ---------------------------- */

test('the preview leaves nothing behind', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Hackathon', '2024-01-17')

  previewImport(requestFor(roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']]), 'Social', '2026-01-17'))
  assert.equal(student('Raman').college, 'EN', 'the dry run rolled back')
})

test('declining every change imports the attendance and nothing else', () => {
  importRoster(roster([['Priya', 'Raman', 'prm501', 'EN', 'BE']]), 'Hackathon', '2024-01-17')

  const file = roster([['Priya', 'Raman', 'prm501', 'GP', 'MENG']])
  const keys = previewImport(requestFor(file, 'Social', '2026-01-17')).updates.map((u) => u.key)
  const result = importRoster(file, 'Social', '2026-01-17', keys)

  assert.equal(result.updatedFields, 0)
  assert.equal(result.rowsProcessed, 1, 'they still attended')
  assert.equal(student('Raman').college, 'EN')
  assert.equal(student('Raman').attendanceCount, 2)
})

test('a student met for the first time raises no proposals', () => {
  const preview = previewImport(
    requestFor(roster([['Marcus', 'Webb', 'mrw502', 'EN', 'BE']]), 'Hackathon', '2026-01-17')
  )
  assert.equal(preview.updates.length, 0)
  assert.equal(preview.newStudents, 1)
})

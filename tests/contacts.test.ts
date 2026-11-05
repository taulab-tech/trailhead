import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as XLSX from 'xlsx'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-contacts-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { commitImport, parseWorkbookForPreview } from '../src/main/importer'
import { listStudents } from '../src/main/db/students'

setWorkbookReader(desktopWorkbookReader)
openDb()
beforeEach(() => wipeDatabase())

let count = 0

/** Writes a real .xlsx so hyperlinks survive, which a CSV can't carry. */
function workbook(rows: string[][], links: Record<string, string> = {}): string {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  for (const [cell, target] of Object.entries(links)) {
    const existing = sheet[cell] as XLSX.CellObject
    sheet[cell] = { ...existing, l: { Target: target } }
  }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  const file = path.join(tmpDir, `book-${++count}.xlsx`)
  XLSX.writeFile(book, file)
  return file
}

function importFile(file: string): void {
  const parsed = parseWorkbookForPreview(file)
  const sheet = parsed.sheets[0]
  commitImport({
    filePath: file,
    fileName: parsed.fileName,
    sheetName: sheet.sheetName,
    eventName: 'Contacts',
    eventDate: '2026-01-17',
    categoryId: null,
    mapping: sheet.suggestedMapping
  })
}

function only() {
  const all = listStudents()
  assert.equal(all.length, 1, 'expected exactly one student')
  return all[0]
}

test('position, employer and LinkedIn columns are recognised', () => {
  const file = workbook([
    ['First Name', 'Last Name', 'Current Position', 'Current Organization', 'Linkedin'],
    ['Priya', 'Raman', 'Services Sales', 'Northwind', 'https://ca.linkedin.com/in/priya-raman']
  ])
  const mapping = parseWorkbookForPreview(file).sheets[0].suggestedMapping
  assert.equal(mapping['Current Position'], 'position')
  assert.equal(mapping['Current Organization'], 'positionOrg')
  assert.equal(mapping['Linkedin'], 'positionUrl')

  importFile(file)
  const student = only()
  assert.equal(student.position, 'Services Sales')
  assert.equal(student.positionOrg, 'Northwind')
  assert.equal(student.positionUrl, 'https://ca.linkedin.com/in/priya-raman')
})

test('"affiliate company" is the employer, as the alumni tracker writes it', () => {
  importFile(
    workbook([
      ['first name', 'last name', 'affiliate company  '],
      ['Priya', 'Raman', 'Aqua Challenger']
    ])
  )
  assert.equal(only().positionOrg, 'Aqua Challenger')
})

test('a LinkedIn cell that shows a name but links to a profile keeps the profile', () => {
  // How the contact trackers actually hold them: the cell reads
  // "Priya Raman | LinkedIn" and the address is in the hyperlink.
  const file = workbook(
    [
      ['First Name', 'Last Name', 'Linkedin'],
      ['Priya', 'Raman', 'Priya Raman | LinkedIn']
    ],
    { C2: 'https://ca.linkedin.com/in/priya-raman-12ab' }
  )
  importFile(file)
  assert.equal(only().positionUrl, 'https://ca.linkedin.com/in/priya-raman-12ab')
})

test('a hyperlink to anything else leaves the text alone', () => {
  const file = workbook(
    [
      ['First Name', 'Last Name', 'Email'],
      ['Priya', 'Raman', 'priya@example.com']
    ],
    { C2: 'mailto:priya@example.com' }
  )
  importFile(file)
  assert.deepEqual(only().emails, ['priya@example.com'])
})

test('a LinkedIn column with no usable address is left empty', () => {
  importFile(
    workbook([
      ['First Name', 'Last Name', 'Linkedin'],
      ['Priya', 'Raman', 'not on linkedin']
    ])
  )
  assert.equal(only().positionUrl, null)
})

test('a bare profile address is made into a full one', () => {
  importFile(
    workbook([
      ['First Name', 'Last Name', 'Linkedin'],
      ['Priya', 'Raman', 'linkedin.com/in/priya-raman']
    ])
  )
  assert.equal(only().positionUrl, 'https://linkedin.com/in/priya-raman')
})

test('a later file does not quietly replace a position already on record', () => {
  importFile(
    workbook([
      ['First Name', 'Last Name', 'NSID', 'Current Position'],
      ['Priya', 'Raman', 'prm501', 'Services Sales']
    ])
  )
  const file = workbook([
    ['First Name', 'Last Name', 'NSID', 'Current Position'],
    ['Priya', 'Raman', 'prm501', 'Something Else']
  ])
  const parsed = parseWorkbookForPreview(file)
  const sheet = parsed.sheets[0]
  const preview = commitImport({
    filePath: file,
    fileName: parsed.fileName,
    sheetName: sheet.sheetName,
    eventName: 'Later',
    eventDate: '2026-06-01',
    categoryId: null,
    mapping: sheet.suggestedMapping,
    rejectedUpdates: [`${only().id}:position`]
  })
  assert.equal(preview.updatedFields, 0)
  assert.equal(only().position, 'Services Sales')
})

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as XLSX from 'xlsx'
import { zipSync } from 'fflate'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-survey-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { setWorkbookReader } from '../src/main/workbooks'
import { desktopWorkbookReader } from '../src/main/workbooksDesktop'
import { commitImport, parseWorkbookForPreview } from '../src/main/importer'
import { listStudents } from '../src/main/db/students'
import { readWorkbookBytes, repackZip } from '../src/main/repackWorkbook'
import type { ParsedSheet } from '../src/shared/types'

setWorkbookReader(desktopWorkbookReader)
openDb()
beforeEach(() => wipeDatabase())

let count = 0

/** Writes rows as a real .xlsx and returns its path. */
function workbook(rows: (string | number)[][]): string {
  const file = path.join(tmpDir, `sheet-${++count}.xlsx`)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  XLSX.writeFile(wb, file)
  return file
}

function firstSheet(file: string): ParsedSheet {
  return parseWorkbookForPreview(file).sheets[0]
}

function mappingOf(sheet: ParsedSheet): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of sheet.headers) out[h] = sheet.suggestedMapping[h]
  return out
}

/* --------------------- questions spread across columns ------------------ */

/** The shape a survey export writes: question once, options underneath. */
const SURVEY: (string | number)[][] = [
  ['Respondent ID', 'What is your name (First & Last) ?', 'What is your NSID?', 'What is your discipline?', '', '', 'What would you like to hear about?', ''],
  ['', 'Open-Ended Response', 'Open-Ended Response', 'Mechanical', 'Civil', 'Other (please specify)', 'SIGMA', 'Hackathons'],
  ['101', 'Amara Okonkwo', 'aao111', '', 'Civil', '', 'SIGMA', 'Hackathons'],
  ['102', 'Bence Lindqvist', 'bel222', '', '', 'biomedical', '', 'Hackathons']
]

test('a question spread across columns is read as one column', () => {
  const sheet = firstSheet(workbook(SURVEY))
  assert.deepEqual(sheet.headers, [
    'Respondent ID',
    'What is your name (First & Last) ?',
    'What is your NSID?',
    'What is your discipline?',
    'What would you like to hear about?'
  ])
})

test('the answer is taken from whichever of a question’s columns was filled in', () => {
  const sheet = firstSheet(workbook(SURVEY))
  assert.equal(sheet.rows[0]['What is your discipline?'], 'Civil')
  assert.equal(sheet.rows[1]['What is your discipline?'], 'biomedical', 'the "other" box counts')
})

test('every answer to a multi-select question is kept, not just the first', () => {
  const sheet = firstSheet(workbook(SURVEY))
  assert.equal(sheet.rows[0]['What would you like to hear about?'], 'SIGMA; Hackathons')
  assert.equal(sheet.rows[1]['What would you like to hear about?'], 'Hackathons')
})

test('the row of answer options is not imported as a person', () => {
  const sheet = firstSheet(workbook(SURVEY))
  assert.equal(sheet.rows.length, 2)
  assert.equal(sheet.rows[0]['What is your name (First & Last) ?'], 'Amara Okonkwo')
})

test('a survey question is recognised from the question, not just a tidy heading', () => {
  const mapping = mappingOf(firstSheet(workbook(SURVEY)))
  assert.equal(mapping['What is your name (First & Last) ?'], 'fullName')
  assert.equal(mapping['What is your NSID?'], 'nsid')
  assert.equal(mapping['What is your discipline?'], 'discipline')
})

test('a survey imports as people rather than collapsing into one record', () => {
  const file = workbook(SURVEY)
  const sheet = firstSheet(file)
  commitImport({
    filePath: file,
    fileName: 'survey.xlsx',
    sheetName: sheet.sheetName,
    eventName: 'Survey 2026',
    eventDate: '2026-10-28',
    categoryId: null,
    mapping: sheet.suggestedMapping
  })

  const students = listStudents()
  assert.equal(students.length, 2)
  const amara = students.find((s) => s.lastName === 'Okonkwo')!
  assert.equal(amara.firstName, 'Amara')
  assert.equal(amara.nsid, 'aao111')
  assert.equal(amara.discipline, 'Civil')
})

/* --------------------- sheets that must not be grouped ------------------ */

test('unlabelled columns before the first heading stay separate columns', () => {
  // The alumni tracker keeps the enrol year in a column with no heading at
  // all, next to an unlabelled row counter. Folding those into the column
  // to their left would lose the year the app reads cohorts from.
  const sheet = firstSheet(
    workbook([
      ['', '', 'first name', 'last name'],
      ['1', '2021', 'Amara', 'Okonkwo'],
      ['2', '2022', 'Bence', 'Lindqvist']
    ])
  )
  assert.equal(sheet.headers.length, 4)
  assert.equal(sheet.rows.length, 2)
  assert.equal(mappingOf(sheet)['Column 2'], 'yearInProgram')
})

test('a gap in the headings with no labels under it is not treated as a question', () => {
  const sheet = firstSheet(
    workbook([
      ['Name', 'Email', '', 'College'],
      ['Amara Okonkwo', 'a@example.com', '', 'Engineering']
    ])
  )
  assert.equal(sheet.headers.length, 4, 'an ordinary sheet with one empty column')
  assert.equal(sheet.rows[0]['Name'], 'Amara Okonkwo')
})

/* ------------------------- spreadsheets that will not open -------------- */

/**
 * Rewrites every local file header to say its sizes are unknown, the way a
 * streaming writer does. The central directory still has the real figures,
 * so the zip is valid — our spreadsheet reader just cannot cope with it.
 */
function makeStreamedZip(entries: Record<string, Uint8Array>): Uint8Array {
  const bytes = zipSync(entries)
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      bytes[i + 6] |= 0x08 // the "sizes come later" flag
      for (const offset of [18, 22]) {
        bytes[i + offset] = 0xff
        bytes[i + offset + 1] = 0xff
        bytes[i + offset + 2] = 0xff
        bytes[i + offset + 3] = 0xff
      }
    }
  }
  return bytes
}

test('a spreadsheet whose zip streams its sizes is still read', () => {
  const plain = new Uint8Array(
    XLSX.write(
      (() => {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name'], ['Amara Okonkwo']]), 'Sheet1')
        return wb
      })(),
      { type: 'array', bookType: 'xlsx' }
    ) as ArrayBuffer
  )

  const entries: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(unzipForTest(plain))) entries[name] = data
  const streamed = makeStreamedZip(entries)

  assert.throws(() => XLSX.read(streamed, { type: 'array' }), 'the reader cannot open it as it stands')

  const book = readWorkbookBytes(streamed)
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 })
  assert.deepEqual(rows[1], ['Amara Okonkwo'])
})

test('repacking keeps every part of the file', () => {
  const entries = { 'a.txt': new TextEncoder().encode('one'), 'b/c.txt': new TextEncoder().encode('two') }
  const repacked = repackZip(zipSync(entries))
  const out = unzipForTest(repacked)
  assert.deepEqual(Object.keys(out).sort(), ['a.txt', 'b/c.txt'])
  assert.equal(new TextDecoder().decode(out['b/c.txt']), 'two')
})

test('a file that is not a zip goes straight through, unrepacked', () => {
  // The reader treats loose text as a one-column sheet. Whatever it makes
  // of it is its business; the repacking must not get involved.
  const text = new TextEncoder().encode(['Name', 'Amara Okonkwo', ''].join('\n'))
  const book = readWorkbookBytes(text)
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 })
  assert.deepEqual(rows[1], ['Amara Okonkwo'])
})

test('a zip that is broken beyond repair still reports the original complaint', () => {
  // Repacking is a second chance, not a way to swallow a real failure.
  const broken = zipSync({ 'x.txt': new TextEncoder().encode('hello') }).slice(0, 20)
  assert.throws(() => readWorkbookBytes(broken))
})

function unzipForTest(bytes: Uint8Array): Record<string, Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { unzipSync } = require('fflate') as typeof import('fflate')
  return unzipSync(bytes)
}

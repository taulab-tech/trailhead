import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-recent-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { getDb, wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { recentContacts } from '../src/main/db/dashboard'
import { installStarterCertificates } from '../src/main/db/certificates'
import { addAttendance, createStudent } from '../src/main/db/students'
import { findOrCreateEvent } from '../src/main/db/events'
import { recordStudentCourse } from '../src/main/db/courses'

openDb()

beforeEach(() => {
  wipeDatabase()
  getDb().exec('DELETE FROM certificates')
})

function attended(studentId: string, event: string, date: string): void {
  addAttendance(studentId, findOrCreateEvent(event, date, null, null), {})
}

function took(studentId: string, code: string, term: string): void {
  recordStudentCourse({ studentId, courseCode: code, term, status: 'completed' })
}

/* ------------------------------ the order ------------------------------- */

test('the most recently seen student comes first', () => {
  const older = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  const newer = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  attended(older, 'Design Night', '2026-02-10')
  attended(newer, 'Pitch Night', '2026-09-30')

  assert.deepEqual(
    recentContacts().map((c) => c.lastName),
    ['Webb', 'Raman']
  )
})

test('a term on a class list counts as a sighting, because class lists carry no event date', () => {
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  took(student, 'GE 431', '202509')

  const [contact] = recentContacts()
  assert.equal(contact.lastSeen, '2025-09-01')
  assert.equal(contact.where, 'GE 431, Fall 2025')
})

test('the latest sighting wins, whichever kind it is', () => {
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  took(student, 'GE 431', '202501')
  attended(student, 'Pitch Night', '2026-09-30')

  const [contact] = recentContacts()
  assert.equal(contact.where, 'Pitch Night')
})

test('somebody nobody has ever seen on a dated record is not listed', () => {
  createStudent({ firstName: 'Priya', lastName: 'Raman' })
  assert.deepEqual(recentContacts(), [])
})

test('the list is capped, and the cap keeps the newest', () => {
  for (let day = 1; day <= 12; day++) {
    const student = createStudent({ firstName: 'Student', lastName: `Number${day}` })
    attended(student, `Event ${day}`, `2026-09-${String(day).padStart(2, '0')}`)
  }
  const contacts = recentContacts(5)
  assert.equal(contacts.length, 5)
  assert.deepEqual(
    contacts.map((c) => c.lastName),
    ['Number12', 'Number11', 'Number10', 'Number9', 'Number8']
  )
})

/* ------------------------------ the promise ----------------------------- */

test('somebody a few units short is marked promising, and the line says why', () => {
  installStarterCertificates()
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  // 8 of the Innovation certificate's 14 units; 6 left is close enough. The
  // capstone is deliberately among them: it belongs to no other certificate,
  // so Innovation is unambiguously the one she is furthest through.
  for (const code of ['GE 495', 'GE 490', 'GE 451']) took(student, code, '202509')
  attended(student, 'Pitch Night', '2026-09-30')

  const [contact] = recentContacts()
  assert.equal(contact.promising, true)
  // Shortened for the sentence; the full name is still on the record.
  assert.equal(contact.promise, '6 CU from finishing Innovation and Entrepreneurship')
  assert.equal(contact.certificateName, 'Engineering Innovation and Entrepreneurship')
})

test('somebody part-way through gets a percentage, not a flag', () => {
  installStarterCertificates()
  const student = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  took(student, 'GE 431', '202509')
  attended(student, 'Pitch Night', '2026-09-30')

  const [contact] = recentContacts()
  assert.equal(contact.promising, false)
  assert.match(contact.promise, /^\d+% through /)
})

test('somebody who has finished is said to have finished, and is not chased', () => {
  installStarterCertificates()
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  for (const code of ['GE 431', 'GE 450', 'GE 451', 'GE 490', 'GE 495']) took(student, code, '202509')
  attended(student, 'Pitch Night', '2026-09-30')

  const [contact] = recentContacts()
  assert.equal(contact.promising, false, 'nothing left to nudge them towards')
  assert.match(contact.promise, /^Finished /)
})

test('with no certificate started the line falls back to how often they come', () => {
  installStarterCertificates()
  const returning = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  attended(returning, 'Design Night', '2026-09-01')
  attended(returning, 'Pitch Night', '2026-09-30')

  const first = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  attended(first, 'Design Night', '2026-09-01')

  const contacts = recentContacts()
  assert.equal(contacts.find((c) => c.lastName === 'Webb')!.promise, '2 events so far')
  assert.equal(contacts.find((c) => c.lastName === 'Raman')!.promise, 'First time here')
})

test('with no certificates set up at all the list still works', () => {
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  attended(student, 'Pitch Night', '2026-09-30')

  const [contact] = recentContacts()
  assert.equal(contact.certificateName, null)
  assert.equal(contact.percent, null)
  assert.equal(contact.promise, 'First time here')
})

test('promise never reorders the list', () => {
  installStarterCertificates()
  const close = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  for (const code of ['GE 431', 'GE 450', 'GE 451', 'GE 490']) took(close, code, '202409')
  attended(close, 'Design Night', '2026-01-15')

  const recent = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  attended(recent, 'Pitch Night', '2026-09-30')

  const contacts = recentContacts()
  assert.deepEqual(
    contacts.map((c) => c.lastName),
    ['Webb', 'Raman'],
    'ordered by date even though Raman is the better prospect'
  )
  assert.equal(contacts[1].promising, true)
})

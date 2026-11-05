import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-quickadd-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { getDb, wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { quickAdd } from '../src/main/db/quickAdd'
import { nextStepFor } from '../src/main/nextStep'
import { createCategory } from '../src/main/db/categories'
import { findOrCreateEvent } from '../src/main/db/events'
import { addAttendance, createStudent, listStudents, getStudentById } from '../src/main/db/students'
import { installStarterCertificates } from '../src/main/db/certificates'
import { recordStudentCourse } from '../src/main/db/courses'
import type { CertificateProgress } from '../src/shared/types'

openDb()

const TODAY = new Date('2026-11-05')

let workshops = ''
let programs = ''

beforeEach(() => {
  wipeDatabase()
  getDb().exec('DELETE FROM certificates')
  workshops = createCategory('Workshops', 1).id
  programs = createCategory('Programs', 2).id
})

const add = (text: string, event: string | null = 'Pitch Night', categoryId: string | null = programs) =>
  quickAdd({ text, eventName: event, eventDate: '2026-11-05', categoryId }, TODAY)

/* ------------------------------ adding ---------------------------------- */

test('pasted names become students attached to the event', () => {
  const result = add('Amara Okonkwo\nBence Lindqvist')

  assert.equal(result.people.length, 2)
  assert.equal(result.newStudents, 2)
  assert.equal(result.eventName, 'Pitch Night')
  assert.deepEqual(
    listStudents().map((s) => s.lastName).sort(),
    ['Lindqvist', 'Okonkwo']
  )
  assert.equal(getStudentById(result.people[0].studentId)!.attendanceCount, 1)
})

test('somebody already on record is matched, not duplicated', () => {
  createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  const result = add('Amara Okonkwo')

  assert.equal(listStudents().length, 1)
  assert.equal(result.newStudents, 0)
  assert.equal(result.returning, 1)
  assert.equal(result.people[0].isNew, false)
})

test('a line with contact details fills them in', () => {
  const result = add('Amara Okonkwo, amara@example.com, 306-555-0142')
  const student = getStudentById(result.people[0].studentId)!
  assert.deepEqual(student.emails, ['amara@example.com'])
  assert.equal(student.phones.length, 1)
})

test('a note is kept against the person, stamped with the event', () => {
  const result = add('Amara Okonkwo - wants to join a capstone team')
  const notes = getStudentById(result.people[0].studentId)!.notes ?? ''
  assert.match(notes, /wants to join a capstone team/)
  assert.match(notes, /Pitch Night/)
})

test('the same note twice does not pile up', () => {
  add('Amara Okonkwo - keen on hardware')
  add('Amara Okonkwo - keen on hardware')
  const notes = getStudentById(listStudents()[0].id)!.notes ?? ''
  assert.equal(notes.split('keen on hardware').length - 1, 1)
})

test('with no event given, people are added and nothing is attended', () => {
  const result = add('Amara Okonkwo', null, null)
  assert.equal(result.eventId, null)
  assert.equal(getStudentById(result.people[0].studentId)!.attendanceCount, 0)
})

test('a line with no name is reported rather than added', () => {
  const result = add('Amara Okonkwo\namara@example.com')
  assert.equal(result.people.length, 1)
  assert.equal(result.unreadable.length, 1)
  assert.match(result.unreadable[0].problem!, /No name/)
})

/* ------------------------------ previewing ------------------------------ */

test('a preview says what would happen and writes nothing', () => {
  const preview = quickAdd(
    { text: 'Amara Okonkwo\nBence Lindqvist', eventName: 'Pitch Night', eventDate: '2026-11-05', categoryId: programs, previewOnly: true },
    TODAY
  )

  assert.equal(preview.people.length, 2)
  assert.equal(preview.newStudents, 2)
  assert.equal(listStudents().length, 0, 'nothing was saved')
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM events WHERE name = 'Pitch Night'").get()['c'], 0)
})

test('a preview of somebody already known still reads them as returning', () => {
  createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  const preview = quickAdd(
    { text: 'Amara Okonkwo', eventName: 'Pitch Night', eventDate: '2026-11-05', categoryId: programs, previewOnly: true },
    TODAY
  )
  assert.equal(preview.people[0].isNew, false)
  assert.equal(preview.returning, 1)
})

/* ------------------------------ feedback -------------------------------- */

test('a returning face says when and where they were last seen', () => {
  const student = createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  addAttendance(student, findOrCreateEvent('Design Night', '2026-03-02', null, null, workshops), {})

  const result = add('Amara Okonkwo')
  assert.equal(result.people[0].previouslySeen, '2026-03-02')
  assert.equal(result.people[0].previouslySeenAt, 'Design Night')
  assert.equal(result.people[0].attendanceCount, 2)
})

test('a first-timer has no previous sighting to report', () => {
  const result = add('Amara Okonkwo')
  assert.equal(result.people[0].isNew, true)
  assert.equal(result.people[0].previouslySeen, null)
})

test('the people they keep turning up with are listed', () => {
  const friend = createStudent({ firstName: 'Bence', lastName: 'Lindqvist' })
  const student = createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  for (const name of ['Design Night', 'Hardware Lab']) {
    const event = findOrCreateEvent(name, '2026-03-02', null, null, workshops)
    addAttendance(student, event, {})
    addAttendance(friend, event, {})
  }

  const result = add('Amara Okonkwo')
  assert.equal(result.people[0].connections.length, 1)
  assert.equal(result.people[0].connections[0].lastName, 'Lindqvist')
  assert.equal(result.people[0].connections[0].sharedEvents, 2)
})

test('certificate progress rides along, furthest first', () => {
  installStarterCertificates()
  const student = createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  for (const code of ['GE 431', 'GE 450', 'GE 451']) {
    recordStudentCourse({ studentId: student, courseCode: code, term: '202509', status: 'completed' })
  }

  const [person] = add('Amara Okonkwo').people
  assert.ok(person.certificates.length > 0)
  assert.ok(person.certificates[0].percent >= person.certificates[person.certificates.length - 1].percent)
  assert.ok(!person.certificates[0].name.startsWith('Engineering '), 'shortened for the card')
})

test('how far along the trail they have got is reported', () => {
  const student = createStudent({ firstName: 'Amara', lastName: 'Okonkwo' })
  addAttendance(student, findOrCreateEvent('Design Night', '2026-03-02', null, null, workshops), {})

  // Added to a Programs event, which is the stop after Workshops.
  const [person] = add('Amara Okonkwo').people
  assert.equal(person.furthestStop, 'Programs')
})

/* ---------------------------- the next step ----------------------------- */

const certificate = (earned: number, total = 14, name = 'Innovation'): CertificateProgress => ({
  certificateId: 'c1',
  name,
  totalUnits: total,
  earnedUnits: earned,
  inProgressUnits: 0,
  percent: Math.round((earned / total) * 100),
  complete: earned >= total,
  groups: [],
  missing: []
})

const trail = (furthest: string | null, next: string | null, atEnd = false) => ({
  furthestStage: furthest ? 1 : null,
  furthestStopName: furthest,
  nextStopName: next,
  atEnd
})

const base = {
  isNew: false,
  isAlumni: false,
  attendanceCount: 3,
  monthsSinceSeen: 1,
  trail: trail('Workshops', 'Programs'),
  certificates: [],
  hasPosition: false
}

test('a first-timer is told what runs next', () => {
  const step = nextStepFor({ ...base, isNew: true, attendanceCount: 1 })
  assert.match(step.action, /Tell them about Programs/)
  assert.match(step.because, /First time on record/)
})

test('a certificate within reach beats moving them along the trail', () => {
  const step = nextStepFor({ ...base, certificates: [certificate(11)] })
  assert.match(step.action, /finishing Innovation/)
  assert.match(step.because, /3 CU short/)
})

test('somebody back after a long gap is caught up with first', () => {
  const step = nextStepFor({ ...base, monthsSinceSeen: 20, certificates: [certificate(3)] })
  assert.match(step.action, /Catch up/)
  assert.match(step.because, /20 months/)
})

test('otherwise they are moved to the next stop, and told why', () => {
  const step = nextStepFor(base)
  assert.equal(step.action, 'Invite them to Programs')
  assert.equal(step.because, 'They have got as far as Workshops')
})

test('at the end of the trail with nothing started, point at a certificate', () => {
  const step = nextStepFor({ ...base, trail: trail('Showcase', null, true) })
  assert.match(step.action, /Point them at a certificate/)
})

test('at the end of the trail with one on the go, keep them going', () => {
  const step = nextStepFor({ ...base, trail: trail('Showcase', null, true), certificates: [certificate(4)] })
  assert.match(step.action, /Keep them going on Innovation/)
})

test('an alum is asked to give something back, not moved along', () => {
  assert.match(nextStepFor({ ...base, isAlumni: true, hasPosition: true }).action, /speak or mentor/)
  assert.match(nextStepFor({ ...base, isAlumni: true, hasPosition: false }).action, /where they ended up/)
})

test('an alum who is nearly done with a certificate is still not chased for it', () => {
  // They have left; a nudge about credit units is no longer the thing to say.
  const step = nextStepFor({ ...base, isAlumni: true, certificates: [certificate(11)] })
  assert.doesNotMatch(step.action, /finishing/)
})

test('somebody on record who has never turned up is not called a first-timer', () => {
  // The card says "on record already"; the reason beside it must not say
  // the opposite.
  const step = nextStepFor({ ...base, isNew: false, attendanceCount: 1 })
  assert.match(step.because, /On record, but this is the first event/)
})

test('a long certificate name is shortened in the suggestion too', () => {
  const step = nextStepFor({
    ...base,
    certificates: [certificate(11, 14, 'Engineering Entrepreneurship – Leading Innovative Teams')]
  })
  assert.equal(step.action, 'Ask about finishing Leading Innovative Teams')
})

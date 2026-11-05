import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-year-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import {
  academicYearOf,
  estimateYearInProgram,
  parseEnrolmentYear,
  parseYearOfStudy,
  readEventDate,
  readTermStamp
} from '../src/main/yearInProgram'
import { addAttendance, createStudent, getStudentById, listStudents } from '../src/main/db/students'
import { findOrCreateEvent } from '../src/main/db/events'
import { recordStudentCourse } from '../src/main/db/courses'
import type { YearObservation } from '../src/shared/types'

openDb()
beforeEach(() => wipeDatabase())

/* ------------------------- reading the answers -------------------------- */

test('a year of study is read however it was written', () => {
  assert.equal(parseYearOfStudy('Fourth Year'), 4)
  assert.equal(parseYearOfStudy('fourth year'), 4)
  assert.equal(parseYearOfStudy('4th year'), 4)
  assert.equal(parseYearOfStudy('1st year'), 1)
  assert.equal(parseYearOfStudy('3'), 3)
})

test('a graduate student has no year of study', () => {
  assert.equal(parseYearOfStudy('PhD'), 'graduate')
  assert.equal(parseYearOfStudy('Masters'), 'graduate')
  assert.equal(parseYearOfStudy('MEng'), 'graduate')
})

test('placeholders and nonsense read as no answer', () => {
  assert.equal(parseYearOfStudy(''), null)
  assert.equal(parseYearOfStudy(null), null)
  assert.equal(parseYearOfStudy('Not Available'), null)
  assert.equal(parseYearOfStudy('Not applicable'), null)
})

test('someone who ticked several boxes is treated as having said nothing', () => {
  // Real answers from the event forms. There is no way to tell which they
  // meant, and a guess here quietly mislabels a real person.
  assert.equal(parseYearOfStudy('1st year | 3rd year'), null)
  assert.equal(parseYearOfStudy('2nd year | 3rd year | 4th year'), null)
})

test('a year alongside a graduate marker still reads as that year', () => {
  assert.equal(parseYearOfStudy('4th year | PhD'), 4)
})

/* ----------------------------- the calendar ----------------------------- */

test('an academic year runs September to April', () => {
  assert.equal(academicYearOf(2025, 9), 2025, 'Fall 2025')
  assert.equal(academicYearOf(2025, 12), 2025)
  assert.equal(academicYearOf(2026, 1), 2025, 'Winter 2026 is still 2025-26')
  assert.equal(academicYearOf(2026, 4), 2025)
})

test('a registrar term stamp reads as a term', () => {
  assert.deepEqual(readTermStamp('202509'), { academicYear: 2025, label: 'Fall 2025' })
  assert.deepEqual(readTermStamp('202601'), { academicYear: 2025, label: 'Winter 2026' })
  assert.equal(readTermStamp('nonsense'), null)
})

test('an event date reads as a term', () => {
  assert.deepEqual(readEventDate('2026-01-17'), { academicYear: 2025, label: 'Winter 2026' })
  assert.deepEqual(readEventDate('2025-12-01'), { academicYear: 2025, label: 'Fall 2025' })
})

/* ---------------------------- the arithmetic ---------------------------- */

const IN_2026_27 = new Date('2026-11-02')

function observed(raw: string, academicYear: number, source: YearObservation['source'] = 'classlist'): YearObservation {
  return { raw, academicYear, when: `Fall ${academicYear}`, source }
}

test('a year observed this academic year is taken as it stands', () => {
  const estimate = estimateYearInProgram([observed('Second Year', 2026)], IN_2026_27)
  assert.equal(estimate.year, 2)
  assert.equal(estimate.label, 'Year 2')
  assert.equal(estimate.current, true)
})

test('a year observed earlier is advanced by the years since', () => {
  const estimate = estimateYearInProgram([observed('Second Year', 2024)], IN_2026_27)
  assert.equal(estimate.year, 4, 'second year in 2024-25 is fourth year in 2026-27')
  assert.equal(estimate.current, false)
  assert.equal(estimate.basis, 'Second Year, Fall 2024')
})

test('the programme is four years, so a fifth would have finished', () => {
  // The registrar's "Class" column never reads beyond Fourth Year on any
  // class list on file, so there is no fifth year to be in.
  assert.equal(estimateYearInProgram([observed('Fourth Year', 2026)], IN_2026_27).year, 4)

  const oneYearOn = estimateYearInProgram([observed('Fourth Year', 2025)], IN_2026_27)
  assert.equal(oneYearOn.kind, 'likely_graduated')
  assert.equal(oneYearOn.year, null)
  assert.equal(oneYearOn.ordinal, 7)
})

test('somebody who started six years ago has finished, not stalled', () => {
  // A first year in 2020-21 is not a sixth-year student in 2026-27.
  const estimate = estimateYearInProgram([observed('First Year', 2020)], IN_2026_27)
  assert.equal(estimate.kind, 'likely_graduated')
  assert.equal(estimate.basis, 'First Year, Fall 2020')
})

test('a graduate student stays a graduate student', () => {
  const estimate = estimateYearInProgram([observed('PhD', 2021, 'event')], IN_2026_27)
  assert.equal(estimate.kind, 'graduate')
  assert.equal(estimate.label, 'Graduate student')
})

test('nothing on record reads as unknown, not as first year', () => {
  assert.equal(estimateYearInProgram([], IN_2026_27).kind, 'unknown')
  assert.equal(estimateYearInProgram([observed('Not Available', 2025)], IN_2026_27).kind, 'unknown')
})

test('the most recent observation is the one used', () => {
  const estimate = estimateYearInProgram(
    [observed('First Year', 2022), observed('Third Year', 2025)],
    IN_2026_27
  )
  assert.equal(estimate.year, 4, 'third year in 2025-26 is fourth year now')
})

test('the registrar is believed over a form answer from the same year', () => {
  const estimate = estimateYearInProgram(
    [observed('1st year', 2026, 'event'), observed('Third Year', 2026, 'classlist')],
    IN_2026_27
  )
  assert.equal(estimate.year, 3)
})

test('years sort first years first, with the unplaceable last', () => {
  const ordinals = [
    estimateYearInProgram([observed('First Year', 2026)], IN_2026_27),
    estimateYearInProgram([observed('Fourth Year', 2026)], IN_2026_27),
    estimateYearInProgram([observed('PhD', 2026)], IN_2026_27),
    estimateYearInProgram([observed('Fourth Year', 2021)], IN_2026_27),
    estimateYearInProgram([], IN_2026_27)
  ].map((e) => e.ordinal)
  assert.deepEqual(ordinals, [1, 4, 6, 7, 8])
  assert.deepEqual([...ordinals].sort((a, b) => a - b), ordinals, 'already in order')
})

/* ------------------------- against the database ------------------------- */

test('a class list gives a student a year that moves with the calendar', () => {
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  recordStudentCourse({
    studentId: student,
    courseCode: 'GE 495',
    term: '202409',
    status: 'completed',
    classYear: 'Third Year'
  })

  const estimate = getStudentById(student)!.currentYear
  // Third year in Fall 2024; this test runs in a later academic year, so the
  // estimate must be at least that, and never below it.
  assert.ok(estimate.kind === 'year' || estimate.kind === 'likely_graduated')
  if (estimate.kind === 'year') assert.ok(estimate.year! >= 3)
  assert.equal(estimate.basis, 'Third Year, Fall 2024')
})

test('an event answer counts when there is no class list', () => {
  const student = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  const event = findOrCreateEvent('Mining Hackathon', '2026-01-17', 'f.xlsx', 'Sheet1', null)
  addAttendance(student, event, { 'State your year within your program': '2nd year' })

  const estimate = getStudentById(student)!.currentYear
  assert.ok(estimate.basis?.startsWith('2nd year, Winter 2026'))
})

test('a placeholder on a class list leaves the year unknown', () => {
  const student = createStudent({ firstName: 'Dev', lastName: 'Okonkwo' })
  recordStudentCourse({
    studentId: student,
    courseCode: 'GE 850',
    term: '202509',
    status: 'completed',
    classYear: 'Not Available'
  })
  assert.equal(getStudentById(student)!.currentYear.kind, 'unknown')
})

test('a year with no date on it is not presented as current', () => {
  const estimate = estimateYearInProgram(
    [{ raw: '1st year', academicYear: 2026, when: 'date unknown', source: 'event', dated: false }],
    IN_2026_27
  )
  assert.equal(estimate.year, 1, 'still the best thing we know')
  assert.equal(estimate.current, false, 'but it may have been true years ago')
})

test('the list and the single record agree', () => {
  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  recordStudentCourse({
    studentId: student,
    courseCode: 'GE 495',
    term: '202509',
    status: 'completed',
    classYear: 'Fourth Year'
  })

  const fromList = listStudents().find((s) => s.id === student)!
  const fromRecord = getStudentById(student)!
  assert.deepEqual(fromList.currentYear, fromRecord.currentYear)
})

/* ------------------------- an enrolment year ---------------------------- */

test('a bare year in the year column is when they enrolled', () => {
  // The cohort trackers keep it that way, and the column is labelled
  // "Year in program / enroll year" because it holds both.
  assert.equal(parseEnrolmentYear('2024'), 2024)
  assert.equal(parseEnrolmentYear('Fourth Year'), null)
  assert.equal(parseEnrolmentYear('3'), null)
  assert.equal(parseEnrolmentYear('1823'), null)
})

test('an enrolment year is counted forward from itself', () => {
  // Enrolled in 2024, so third year in 2026-27 — whenever the record was
  // written down, which is the difference from a year of study.
  const estimate = estimateYearInProgram(
    [{ raw: '2024', academicYear: 2019, when: 'Fall 2019', source: 'event', dated: false }],
    IN_2026_27
  )
  assert.equal(estimate.year, 3)
  assert.equal(estimate.basis, 'enrolled 2024')
})

test('somebody who enrolled long enough ago has finished', () => {
  assert.equal(estimateYearInProgram([observed('2019', 2019, 'event')], IN_2026_27).kind, 'likely_graduated')
})

test('enrolling this year is first year', () => {
  assert.equal(estimateYearInProgram([observed('2026', 2026, 'event')], IN_2026_27).year, 1)
})

test('a dated observation beats an undated one, however old it is', () => {
  // An undated value has to be stamped with some academic year to compare
  // at all; it must not win on that account.
  const estimate = estimateYearInProgram(
    [
      { raw: '2023', academicYear: 2026, when: 'date unknown', source: 'event', dated: false },
      observed('Fourth Year', 2024)
    ],
    IN_2026_27
  )
  assert.equal(estimate.basis, 'Fourth Year, Fall 2024')
  assert.equal(estimate.kind, 'likely_graduated')
})

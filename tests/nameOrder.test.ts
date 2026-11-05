import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-nameorder-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { getDb, wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { explainReversedName, isReversedName } from '../src/main/nameOrder'
import { matchStudent, newMatchContext } from '../src/main/matching'
import { getStudentById, mergeStudents } from '../src/main/db/students'
import { nameOrderIsConfirmed } from '../src/main/db/fieldSources'
import { listPossibleDuplicates, suggestDuplicate } from '../src/main/db/duplicates'

openDb()

beforeEach(() => {
  wipeDatabase()
  getDb().exec('DELETE FROM possible_duplicates')
  getDb().exec('DELETE FROM student_field_sources')
})

/* ----------------------------- the rule --------------------------------- */

test('the same two names the opposite way round is a reversal', () => {
  assert.equal(
    isReversedName({ firstName: 'Amara', lastName: 'Okonkwo' }, { firstName: 'Okonkwo', lastName: 'Amara' }),
    true
  )
})

test('case and stray spacing do not hide a reversal', () => {
  assert.equal(
    isReversedName({ firstName: ' amara ', lastName: 'OKONKWO' }, { firstName: 'Okonkwo', lastName: 'Amara' }),
    true
  )
})

test('the same name the same way round is not a reversal', () => {
  assert.equal(
    isReversedName({ firstName: 'Amara', lastName: 'Okonkwo' }, { firstName: 'Amara', lastName: 'Okonkwo' }),
    false
  )
})

test('a near-miss spelling is a different question and stays out of this', () => {
  // That belongs in the ordinary similar-name review, where the answer is a
  // correction rather than a swap.
  assert.equal(
    isReversedName({ firstName: 'Amara', lastName: 'Okonkwo' }, { firstName: 'Okonkwa', lastName: 'Amara' }),
    false
  )
})

test('somebody whose two names are the same word has no wrong way round', () => {
  assert.equal(
    isReversedName({ firstName: 'Thomas', lastName: 'Thomas' }, { firstName: 'Thomas', lastName: 'Thomas' }),
    false
  )
})

test('a missing half is not a reversal', () => {
  assert.equal(isReversedName({ firstName: 'Amara', lastName: '' }, { firstName: '', lastName: 'Amara' }), false)
})

/* --------------------------- what it is called -------------------------- */

test('with a roster on one side, the explanation names the one to keep', () => {
  const verdict = explainReversedName(
    { firstName: 'Amara', lastName: 'Okonkwo' },
    { firstName: 'Okonkwo', lastName: 'Amara' },
    true,
    false
  )
  assert.equal(verdict.confirmed, 'a')
  assert.match(verdict.reason, /class list gives it as "Amara Okonkwo"/)
  assert.match(verdict.reason, /"Okonkwo Amara" has the first and last name swapped/)
})

test('with a roster on neither side it says so instead of guessing', () => {
  const verdict = explainReversedName(
    { firstName: 'Amara', lastName: 'Okonkwo' },
    { firstName: 'Okonkwo', lastName: 'Amara' },
    false,
    false
  )
  assert.equal(verdict.confirmed, null)
  assert.match(verdict.reason, /nothing on record says which/)
})

test('with a roster on both sides there is nothing to choose between them', () => {
  assert.equal(
    explainReversedName(
      { firstName: 'Amara', lastName: 'Okonkwo' },
      { firstName: 'Okonkwo', lastName: 'Amara' },
      true,
      true
    ).confirmed,
    null
  )
})

/* ------------------------- recording the evidence ----------------------- */

const roster = (firstName: string, lastName: string, nsid: string): string =>
  matchStudent(
    { firstName, lastName, nsid, emails: [], phones: [], nameOrderConfirmed: true },
    newMatchContext('2026-09-01', 'classlist.xls')
  ).studentId

const twoColumns = (firstName: string, lastName: string, email: string): string =>
  matchStudent(
    { firstName, lastName, emails: [email], phones: [] },
    newMatchContext('2026-09-01', 'alumni.csv')
  ).studentId

test('a comma-split name is recorded as confirmed, a two-column one is not', () => {
  assert.equal(nameOrderIsConfirmed(roster('Amara', 'Okonkwo', 'aao111')), true)
  assert.equal(nameOrderIsConfirmed(twoColumns('Okonkwo', 'Amara', 'amara@example.com')), false)
})

test('a later sheet that only claims the order does not undo a roster', () => {
  const id = roster('Amara', 'Okonkwo', 'aao111')
  matchStudent(
    { firstName: 'Amara', lastName: 'Okonkwo', nsid: 'aao111', emails: [], phones: [] },
    newMatchContext('2026-10-01', 'signup.xlsx')
  )
  assert.equal(nameOrderIsConfirmed(id), true)
})

/* ------------------------- how the pair reads --------------------------- */

test('a queued pair is explained as a reversal, with the roster side named', () => {
  const confirmed = roster('Amara', 'Okonkwo', 'aao111')
  const swapped = twoColumns('Okonkwo', 'Amara', 'amara@example.com')
  suggestDuplicate(confirmed, swapped, 1, 'Identical name — could be the same person or two different people.')

  const [pair] = listPossibleDuplicates()
  assert.equal(pair.reversedName, true)
  const side = pair.studentA.id === confirmed ? 'a' : 'b'
  assert.equal(pair.confirmedNameSide, side, 'the roster record is the one to keep')
  assert.match(pair.reason, /opposite way round/)
})

test('the stored reason is left alone for a pair that is not a reversal', () => {
  const a = twoColumns('Amara', 'Okonkwo', 'amara@example.com')
  const b = twoColumns('Amara', 'Okonkwa', 'amara2@example.com')
  suggestDuplicate(a, b, 0.9, 'Similar name: "Amara Okonkwo" vs "Amara Okonkwa"')

  const [pair] = listPossibleDuplicates()
  assert.equal(pair.reversedName, false)
  assert.equal(pair.confirmedNameSide, null)
  assert.match(pair.reason, /^Similar name/)
})

test('the roster evidence can arrive after the pair was flagged', () => {
  // The pair is queued first, with nothing to tell the two apart; the class
  // list is imported afterwards and the screen must pick it up on the spot.
  const swapped = twoColumns('Okonkwo', 'Amara', 'amara@example.com')
  const other = twoColumns('Amara', 'Okonkwo', 'a.okonkwo@example.com')
  suggestDuplicate(swapped, other, 1, 'Identical name')
  assert.equal(listPossibleDuplicates()[0].confirmedNameSide, null)

  matchStudent(
    { firstName: 'Amara', lastName: 'Okonkwo', emails: ['a.okonkwo@example.com'], phones: [], nameOrderConfirmed: true },
    newMatchContext('2026-10-01', 'classlist.xls')
  )

  const [pair] = listPossibleDuplicates()
  const side = pair.studentA.id === other ? 'a' : 'b'
  assert.equal(pair.confirmedNameSide, side)
})

/* ------------------------------ merging --------------------------------- */

test('merging onto the swapped record still ends with the name the right way round', () => {
  const confirmed = roster('Amara', 'Okonkwo', 'aao111')
  const swapped = twoColumns('Okonkwo', 'Amara', 'amara@example.com')

  mergeStudents(swapped, confirmed) // keep the swapped record, merge the roster one away

  const survivor = getStudentById(swapped)!
  assert.equal(survivor.firstName, 'Amara')
  assert.equal(survivor.lastName, 'Okonkwo')
  assert.equal(nameOrderIsConfirmed(swapped), true, 'and it is now a confirmed order itself')
})

test('merging onto the roster record leaves its name exactly as it was', () => {
  const confirmed = roster('Amara', 'Okonkwo', 'aao111')
  const swapped = twoColumns('Okonkwo', 'Amara', 'amara@example.com')

  mergeStudents(confirmed, swapped)

  const survivor = getStudentById(confirmed)!
  assert.equal(survivor.firstName, 'Amara')
  assert.equal(survivor.lastName, 'Okonkwo')
})

test('with no roster on either side, merging keeps the record that was chosen', () => {
  const a = twoColumns('Okonkwo', 'Amara', 'amara@example.com')
  const b = twoColumns('Amara', 'Okonkwo', 'a.okonkwo@example.com')

  mergeStudents(a, b)

  const survivor = getStudentById(a)!
  assert.equal(survivor.firstName, 'Okonkwo', 'nothing says it is wrong, so nothing changes it')
})

test('merging two people who are not reversals never touches the name', () => {
  const keep = roster('Amara', 'Okonkwo', 'aao111')
  const other = twoColumns('Amara', 'Okonkwo', 'amara@example.com')

  mergeStudents(other, keep)

  assert.equal(getStudentById(other)!.firstName, 'Amara')
  assert.equal(getStudentById(other)!.lastName, 'Okonkwo')
})

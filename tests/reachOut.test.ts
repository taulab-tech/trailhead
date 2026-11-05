import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CLOSE_UNITS, GONE_MONTHS, QUIET_MONTHS, reachOutList, suggestionFor } from '../src/main/reachOut'
import { shortCertificateName } from '../src/main/certificates'
import type { CertificateProgress, Student, YearEstimate } from '../src/shared/types'

const TODAY = new Date('2026-11-05')

function year(n: number | null, kind: YearEstimate['kind'] = 'year'): YearEstimate {
  return { kind, year: n, label: n ? `Year ${n}` : 'Unknown', ordinal: n ?? 8, basis: null, current: true }
}

function student(over: Partial<Student> = {}): Student {
  return {
    id: 'student-1',
    firstName: 'Priya',
    lastName: 'Raman',
    nsid: null,
    college: null,
    discipline: null,
    degree: null,
    program: null,
    yearInProgram: null,
    isAlumni: false,
    cohortYear: null,
    enrolTerm: null,
    position: null,
    positionOrg: null,
    positionSince: null,
    positionUrl: null,
    positionFoundAt: null,
    notes: null,
    createdAt: '',
    updatedAt: '',
    emails: [],
    phones: [],
    attendanceCount: 0,
    currentYear: year(2),
    ...over
  }
}

function certificate(earned: number, total = 26, name = 'Innovation'): CertificateProgress {
  return {
    certificateId: 'c1',
    name,
    totalUnits: total,
    earnedUnits: earned,
    inProgressUnits: 0,
    percent: Math.round((earned / total) * 100),
    complete: earned >= total,
    groups: [],
    missing: []
  }
}

/* --------------------------- who is suggested --------------------------- */

test('somebody a few units short is the first person to contact', () => {
  const s = suggestionFor(
    { student: student(), certificates: [certificate(26 - CLOSE_UNITS)], lastSeen: '2026-09-01' },
    TODAY
  )
  assert.equal(s?.reason, 'close_to_finishing')
  assert.equal(s?.unitsRemaining, CLOSE_UNITS)
  assert.match(s!.detail, /from finishing Innovation/)
})

test('somebody with a long way to go is not chased for it', () => {
  const s = suggestionFor({ student: student(), certificates: [certificate(3)], lastSeen: '2026-09-01' }, TODAY)
  assert.equal(s, null)
})

test('a final-year student with an unfinished certificate is worth a word', () => {
  const s = suggestionFor(
    { student: student({ currentYear: year(4) }), certificates: [certificate(10)], lastSeen: '2026-09-01' },
    TODAY
  )
  assert.equal(s?.reason, 'final_year')
  assert.match(s!.detail, /last year/)
})

test('somebody who started and then went quiet is drifting', () => {
  const s = suggestionFor(
    { student: student(), certificates: [certificate(10)], lastSeen: '2024-01-01' },
    TODAY
  )
  assert.equal(s?.reason, 'drifting')
  assert.ok((s?.monthsQuiet ?? 0) >= QUIET_MONTHS)
})

test('recently seen and mid-way through is nobody to chase', () => {
  assert.equal(
    suggestionFor({ student: student(), certificates: [certificate(10)], lastSeen: '2026-10-01' }, TODAY),
    null
  )
})

/* --------------------------- who is left alone -------------------------- */

test('somebody who has finished the certificate is not suggested', () => {
  assert.equal(
    suggestionFor({ student: student(), certificates: [certificate(26)], lastSeen: '2026-09-01' }, TODAY),
    null
  )
})

test('an alum is never suggested, however close they were', () => {
  assert.equal(
    suggestionFor(
      { student: student({ isAlumni: true }), certificates: [certificate(23)], lastSeen: '2026-09-01' },
      TODAY
    ),
    null
  )
})

test('somebody who has likely finished the programme is not suggested', () => {
  assert.equal(
    suggestionFor(
      {
        student: student({ currentYear: year(null, 'likely_graduated') }),
        certificates: [certificate(23)],
        lastSeen: '2026-09-01'
      },
      TODAY
    ),
    null
  )
})

test('somebody who has never started a certificate is not suggested', () => {
  assert.equal(
    suggestionFor({ student: student(), certificates: [certificate(0)], lastSeen: '2026-09-01' }, TODAY),
    null
  )
})

test('with no certificates set up there is nothing to say', () => {
  assert.equal(suggestionFor({ student: student(), certificates: [], lastSeen: '2026-09-01' }, TODAY), null)
})

/* ------------------------------ the list -------------------------------- */

test('the certificate they are furthest through is the one named', () => {
  const s = suggestionFor(
    {
      student: student(),
      certificates: [certificate(3, 13, 'New Product Market'), certificate(22, 26, 'Innovation')],
      lastSeen: '2026-09-01'
    },
    TODAY
  )
  assert.equal(s?.certificateName, 'Innovation')
})

test('the nearly-finished come before the final years, and those before the drifting', () => {
  const list = reachOutList(
    [
      { student: student({ id: 'a', lastName: 'Drifting' }), certificates: [certificate(10)], lastSeen: '2025-01-01' },
      { student: student({ id: 'b', lastName: 'Final', currentYear: year(4) }), certificates: [certificate(10)], lastSeen: '2026-09-01' },
      { student: student({ id: 'c', lastName: 'Close' }), certificates: [certificate(23)], lastSeen: '2026-09-01' }
    ],
    TODAY
  )
  assert.deepEqual(
    list.map((s) => s.reason),
    ['close_to_finishing', 'final_year', 'drifting']
  )
})

test('among those nearly finished, the nearest comes first', () => {
  const list = reachOutList(
    [
      { student: student({ id: 'a', lastName: 'Further' }), certificates: [certificate(21)], lastSeen: '2026-09-01' },
      { student: student({ id: 'b', lastName: 'Nearer' }), certificates: [certificate(24)], lastSeen: '2026-09-01' }
    ],
    TODAY
  )
  assert.deepEqual(
    list.map((s) => s.lastName),
    ['Nearer', 'Further']
  )
})

test('nobody worth contacting is an empty list, not a padded one', () => {
  const list = reachOutList(
    [{ student: student(), certificates: [certificate(3)], lastSeen: '2026-10-01' }],
    TODAY
  )
  assert.deepEqual(list, [])
})

test('somebody last seen years ago is gone, not drifting', () => {
  // Six years and a tenth of a certificate is not a prospect, and listing
  // them only buries the people who are.
  const s = suggestionFor(
    { student: student(), certificates: [certificate(2)], lastSeen: '2019-01-01' },
    TODAY
  )
  assert.equal(s, null)
})

test('a long certificate name is shortened for the sentence, not the record', () => {
  // "Engineering Entrepreneurship - Leading Innovative Teams" spends most of
  // a dashboard line saying what every certificate here says.
  assert.equal(shortCertificateName('Engineering Entrepreneurship – Leading Innovative Teams'), 'Leading Innovative Teams')
  assert.equal(shortCertificateName('Engineering Innovation and Entrepreneurship'), 'Innovation and Entrepreneurship')
  // Nothing to take off, so nothing is taken off.
  assert.equal(shortCertificateName('Co-op Certificate'), 'Co-op Certificate')
  assert.equal(shortCertificateName('Innovation'), 'Innovation')

  const s = suggestionFor(
    { student: student(), certificates: [certificate(23, 26, 'Engineering Innovation and Entrepreneurship')], lastSeen: '2026-09-01' },
    TODAY
  )
  assert.equal(s?.detail, '3 CU from finishing Innovation and Entrepreneurship')
  assert.equal(s?.certificateName, 'Engineering Innovation and Entrepreneurship', 'the record keeps the real name')
})

test('the drifting window has both ends', () => {
  const at = (months: number) => {
    const d = new Date(TODAY)
    d.setMonth(d.getMonth() - months)
    return d.toISOString().slice(0, 10)
  }
  assert.equal(
    suggestionFor({ student: student(), certificates: [certificate(10)], lastSeen: at(QUIET_MONTHS) }, TODAY)?.reason,
    'drifting'
  )
  assert.equal(
    suggestionFor({ student: student(), certificates: [certificate(10)], lastSeen: at(GONE_MONTHS + 1) }, TODAY),
    null
  )
})

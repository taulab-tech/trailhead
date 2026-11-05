import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-certs-'))
process.env.TRAILHEAD_DB_PATH = path.join(tmpDir, 'test.db')

import { getDb, wipeDatabase } from '../src/main/db'
import { openDb } from '../src/main/db/desktop'
import { certificateProgress, normalizeCourseCode, totalUnitsFor } from '../src/main/certificates'
import {
  certificateRoster,
  getCertificate,
  installCertificate,
  listCertificates,
  installStarterCertificates,
  setStudentCertificate,
  studentCertificates
} from '../src/main/db/certificates'
import { USASK_CERTIFICATES } from '../src/main/certificateSeeds'
import { recordStudentCourse } from '../src/main/db/courses'
import { createStudent } from '../src/main/db/students'
import type { CertificateDefinition, StudentCourse } from '../src/shared/types'

openDb()

beforeEach(() => {
  wipeDatabase()
  getDb().exec('DELETE FROM certificates')
})

/* --------------------------- building fixtures -------------------------- */

let nextId = 0
const id = (): string => `id-${++nextId}`

/** A definition built by hand, so a rule can be tested without the seeds. */
function definition(parts: Partial<CertificateDefinition> = {}): CertificateDefinition {
  return {
    id: 'cert',
    name: 'Test certificate',
    totalUnits: null,
    notes: null,
    groups: [],
    requirements: [],
    substitutions: [],
    ...parts
  }
}

function course(code: string, status: StudentCourse['status'] = 'completed'): StudentCourse {
  return {
    id: id(),
    studentId: 'student',
    courseCode: code,
    term: '202509',
    termLabel: '2025 Fall Term',
    creditUnits: 3,
    grade: status === 'completed' ? '87' : null,
    regStatus: 'Registered by student',
    status,
    sourceFile: null
  }
}

/* ------------------------------ course codes ---------------------------- */

test('course codes match however they are written', () => {
  assert.equal(normalizeCourseCode('ge495'), 'GE 495')
  assert.equal(normalizeCourseCode('GE  495'), 'GE 495')
  assert.equal(normalizeCourseCode('GE 495.6'), 'GE 495')
  assert.equal(normalizeCourseCode(' comm 204.3 '), 'COMM 204')
})

/* ------------------------------ required -------------------------------- */

const REQUIRED_ONLY = definition({
  groups: [{ id: 'g1', name: 'Required', kind: 'required', minUnits: null, parentId: null, sortOrder: 0 }],
  requirements: [
    { id: 'r1', groupId: 'g1', courseCode: 'GE 431', creditUnits: 3, sortOrder: 0 },
    { id: 'r2', groupId: 'g1', courseCode: 'GE 495', creditUnits: 6, sortOrder: 1 }
  ]
})

test('a required course counts for what the catalogue says, not the class list', () => {
  // The class list records GE 495 at 3.0 units per term; the catalogue says 6.
  const progress = certificateProgress(REQUIRED_ONLY, [course('GE 495')])
  assert.equal(progress.earnedUnits, 6)
  assert.equal(progress.totalUnits, 9)
})

test('a certificate is complete only when every required course is done', () => {
  assert.equal(certificateProgress(REQUIRED_ONLY, [course('GE 431')]).complete, false)
  assert.equal(certificateProgress(REQUIRED_ONLY, [course('GE 431'), course('GE 495')]).complete, true)
})

test('what is still outstanding is listed', () => {
  const progress = certificateProgress(REQUIRED_ONLY, [course('GE 431')])
  assert.deepEqual(progress.missing, ['GE 495'])
})

test('a course under way is reported separately from one that is finished', () => {
  const progress = certificateProgress(REQUIRED_ONLY, [course('GE 431'), course('GE 495', 'in_progress')])
  assert.equal(progress.earnedUnits, 3)
  assert.equal(progress.inProgressUnits, 6)
  assert.equal(progress.complete, false)
})

test('an audited course counts for nothing', () => {
  const progress = certificateProgress(REQUIRED_ONLY, [course('GE 431', 'audited')])
  assert.equal(progress.earnedUnits, 0)
  assert.deepEqual(progress.missing, ['GE 431', 'GE 495'])
})

test('a failed course counts for nothing', () => {
  assert.equal(certificateProgress(REQUIRED_ONLY, [course('GE 431', 'not_completed')]).earnedUnits, 0)
})

test('the same course taken twice is only counted once', () => {
  const twice = [course('GE 431'), { ...course('GE 431'), term: '202409' }]
  assert.equal(certificateProgress(REQUIRED_ONLY, twice).earnedUnits, 3)
})

test('a later pass beats an earlier attempt that was not completed', () => {
  const failedThenPassed = [course('GE 431', 'not_completed'), course('GE 431')]
  assert.equal(certificateProgress(REQUIRED_ONLY, failedThenPassed).earnedUnits, 3)
})

/* ------------------------------ electives ------------------------------- */

const WITH_ELECTIVES = definition({
  groups: [
    { id: 'g1', name: 'Required', kind: 'required', minUnits: null, parentId: null, sortOrder: 0 },
    { id: 'g2', name: 'Electives', kind: 'elective', minUnits: 6, parentId: null, sortOrder: 1 }
  ],
  requirements: [
    { id: 'r1', groupId: 'g1', courseCode: 'GE 431', creditUnits: 3, sortOrder: 0 },
    { id: 'r2', groupId: 'g2', courseCode: 'RCM 402', creditUnits: 3, sortOrder: 0 },
    { id: 'r3', groupId: 'g2', courseCode: 'RCM 404', creditUnits: 3, sortOrder: 1 },
    { id: 'r4', groupId: 'g2', courseCode: 'RCM 409', creditUnits: 3, sortOrder: 2 }
  ]
})

test('electives count towards their minimum', () => {
  const progress = certificateProgress(WITH_ELECTIVES, [course('RCM 402')])
  assert.equal(progress.earnedUnits, 3)
  assert.equal(progress.totalUnits, 9)
})

test('extra electives beyond the minimum do not inflate the total', () => {
  const all = [course('RCM 402'), course('RCM 404'), course('RCM 409')]
  const progress = certificateProgress(WITH_ELECTIVES, all)
  assert.equal(progress.earnedUnits, 6, 'capped at the 6 units the group asks for')
  assert.equal(progress.percent, 67)
})

test('a missing elective is not listed as a missing course', () => {
  // Which electives someone picks is up to them, so naming one would be wrong.
  assert.deepEqual(certificateProgress(WITH_ELECTIVES, []).missing, ['GE 431'])
})

/* --------------------- a rule inside an elective group ------------------ */

const NESTED = definition({
  groups: [
    { id: 'g1', name: 'Electives', kind: 'elective', minUnits: 9, parentId: null, sortOrder: 0 },
    { id: 'g2', name: 'COMM electives', kind: 'elective', minUnits: 3, parentId: 'g1', sortOrder: 1 }
  ],
  requirements: [
    { id: 'r1', groupId: 'g1', courseCode: 'RCM 402', creditUnits: 3, sortOrder: 0 },
    { id: 'r2', groupId: 'g1', courseCode: 'RCM 404', creditUnits: 3, sortOrder: 1 },
    { id: 'r3', groupId: 'g1', courseCode: 'RCM 409', creditUnits: 3, sortOrder: 2 },
    { id: 'r4', groupId: 'g2', courseCode: 'COMM 204', creditUnits: 3, sortOrder: 0 },
    { id: 'r5', groupId: 'g2', courseCode: 'COMM 205', creditUnits: 3, sortOrder: 1 },
    { id: 'r6', groupId: 'g2', courseCode: 'COMM 211', creditUnits: 3, sortOrder: 2 }
  ]
})

test('the wider elective pool cannot fill the COMM minimum', () => {
  // Nine units of RCM is nine units, but three of them have to be COMM.
  const progress = certificateProgress(NESTED, [course('RCM 402'), course('RCM 404'), course('RCM 409')])
  assert.equal(progress.earnedUnits, 6, 'only the 6 units that are not reserved for COMM')
  assert.equal(progress.complete, false)
})

test('three COMM units unlock the rest', () => {
  const progress = certificateProgress(NESTED, [
    course('RCM 402'),
    course('RCM 404'),
    course('COMM 204')
  ])
  assert.equal(progress.earnedUnits, 9)
  assert.equal(progress.complete, true)
})

test('all-COMM electives are fine', () => {
  const progress = certificateProgress(NESTED, [course('COMM 204'), course('COMM 205'), course('COMM 211')])
  assert.equal(progress.earnedUnits, 9)
  assert.equal(progress.complete, true)
})

test('part-way there is counted part-way', () => {
  const progress = certificateProgress(NESTED, [course('COMM 204'), course('RCM 402')])
  assert.equal(progress.earnedUnits, 6)
  assert.equal(progress.complete, false)
})

/* ---------------------------- substitutions ----------------------------- */

const WITH_SUBSTITUTION = definition({
  groups: [{ id: 'g1', name: 'Required', kind: 'required', minUnits: null, parentId: null, sortOrder: 0 }],
  requirements: [{ id: 'r1', groupId: 'g1', courseCode: 'GE 495', creditUnits: 6, sortOrder: 0 }],
  substitutions: [
    { id: 's1', replacesCode: 'GE 495', acceptedCode: 'CHE 495', alsoRequiresCode: 'GE 496' }
  ]
})

test('a substitute capstone does not count on its own', () => {
  const progress = certificateProgress(WITH_SUBSTITUTION, [course('CHE 495')])
  assert.equal(progress.earnedUnits, 0)
  assert.equal(progress.complete, false)
})

test('a substitute capstone counts once its companion course is done too', () => {
  const progress = certificateProgress(WITH_SUBSTITUTION, [course('CHE 495'), course('GE 496')])
  assert.equal(progress.earnedUnits, 6)
  assert.equal(progress.complete, true)
  assert.equal(progress.groups[0].requirements[0].satisfiedBy, 'CHE 495')
})

test('the course itself still counts without the companion', () => {
  const progress = certificateProgress(WITH_SUBSTITUTION, [course('GE 495')])
  assert.equal(progress.complete, true)
  assert.equal(progress.groups[0].requirements[0].satisfiedBy, null)
})

/* -------------------------- the real certificates ----------------------- */

test('the three College of Engineering certificates add up to their stated totals', () => {
  for (const seed of USASK_CERTIFICATES) {
    const required = seed.groups
      .filter((g) => g.kind === 'required')
      .flatMap((g) => g.courses)
      .reduce((sum, c) => sum + c.units, 0)
    const electives = seed.groups
      .filter((g) => g.kind === 'elective')
      .reduce((sum, g) => sum + (g.minUnits ?? 0), 0)
    assert.equal(required + electives, seed.totalUnits, `${seed.name} should add up`)
  }
})

test('the starter certificates go in when asked for, and only once', () => {
  assert.equal(installStarterCertificates(), 3)
  assert.equal(listCertificates().length, 3)
  assert.equal(installStarterCertificates(), 0, 'not re-added over what the user has')
  assert.equal(listCertificates().length, 3)
})

test('a student who has finished the Innovation certificate reads as finished', () => {
  installStarterCertificates()
  const innovation = listCertificates().find((c) => c.name.startsWith('Engineering Innovation'))!
  const definitionFromDb = getCertificate(innovation.id)!
  assert.equal(totalUnitsFor(definitionFromDb), 26)

  const student = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  for (const code of ['COMM 201', 'GE 431', 'GE 450', 'GE 451', 'GE 490', 'GE 495', 'COMM 204', 'RCM 402']) {
    recordStudentCourse({
      studentId: student,
      courseCode: code,
      term: '202509',
      status: 'completed'
    })
  }

  const progress = studentCertificates(student).find((c) => c.certificateId === innovation.id)!
  // 17 required + 3 COMM + 3 RCM = 23 of 26; still 3 elective units short.
  assert.equal(progress.earnedUnits, 23)
  assert.equal(progress.complete, false)

  recordStudentCourse({ studentId: student, courseCode: 'RCM 404', term: '202601', status: 'completed' })
  const done = studentCertificates(student).find((c) => c.certificateId === innovation.id)!
  assert.equal(done.earnedUnits, 26)
  assert.equal(done.percent, 100)
  assert.equal(done.complete, true)
})

test('a capstone from another discipline counts for the Innovation certificate', () => {
  installStarterCertificates()
  const innovation = listCertificates().find((c) => c.name.startsWith('Engineering Innovation'))!

  const student = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  for (const code of ['COMM 201', 'GE 431', 'GE 450', 'GE 451', 'GE 490', 'ME 495', 'GE 496', 'COMM 204', 'RCM 402', 'RCM 404']) {
    recordStudentCourse({ studentId: student, courseCode: code, term: '202509', status: 'completed' })
  }

  const progress = studentCertificates(student).find((c) => c.certificateId === innovation.id)!
  assert.equal(progress.complete, true, 'ME 495 with GE 496 stands in for GE 495')
})

/* -------------------------------- roster -------------------------------- */

test('the roster ranks students by how far along they are', () => {
  installStarterCertificates()
  const innovation = listCertificates().find((c) => c.name.startsWith('Engineering Innovation'))!

  const ahead = createStudent({ firstName: 'Priya', lastName: 'Raman' })
  for (const code of ['GE 431', 'GE 450', 'GE 495']) {
    recordStudentCourse({ studentId: ahead, courseCode: code, term: '202509', status: 'completed' })
  }
  const behind = createStudent({ firstName: 'Marcus', lastName: 'Webb' })
  recordStudentCourse({ studentId: behind, courseCode: 'GE 431', term: '202509', status: 'completed' })

  // Nothing on record at all, so nothing to report.
  createStudent({ firstName: 'Dev', lastName: 'Okonkwo' })

  const roster = certificateRoster(innovation.id)
  assert.deepEqual(
    roster.map((r) => `${r.lastName} ${r.earnedUnits}`),
    ['Raman 12', 'Webb 3']
  )
})

test('declaring a certificate puts a student on its roster regardless', () => {
  installStarterCertificates()
  const innovation = listCertificates().find((c) => c.name.startsWith('Engineering Innovation'))!
  const student = createStudent({ firstName: 'Dev', lastName: 'Okonkwo' })
  recordStudentCourse({ studentId: student, courseCode: 'PHYS 115', term: '202509', status: 'completed' })

  assert.equal(certificateRoster(innovation.id).length, 0)

  setStudentCertificate(student, innovation.id, true)
  const roster = certificateRoster(innovation.id)
  assert.equal(roster.length, 1)
  assert.equal(roster[0].declared, true)
  assert.equal(roster[0].earnedUnits, 0)

  setStudentCertificate(student, innovation.id, false)
  assert.equal(certificateRoster(innovation.id).length, 0)
})

test('a certificate can be installed, edited and deleted like any other record', () => {
  const certificateId = installCertificate({
    name: 'Local certificate',
    totalUnits: 6,
    notes: null,
    groups: [{ name: 'Required', kind: 'required', courses: [{ code: 'GE 431', units: 3 }] }]
  })

  const loaded = getCertificate(certificateId)!
  assert.equal(loaded.name, 'Local certificate')
  assert.equal(loaded.requirements.length, 1)
  assert.equal(loaded.groups.length, 1)

  getDb().prepare('DELETE FROM certificates WHERE id = ?').run(certificateId)
  assert.equal(getCertificate(certificateId), null)
  assert.equal(
    (getDb().prepare('SELECT COUNT(*) c FROM certificate_requirements').get() as { c: number }).c,
    0,
    'requirements go with the certificate'
  )
})

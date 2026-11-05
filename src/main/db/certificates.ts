import { newId } from '../ids'
import { getDb } from './index'
import { certificateProgress } from '../certificates'
import { listStudentCourses } from './courses'
import { listStudents } from './students'
import { USASK_CERTIFICATES, type CertificateSeed } from '../certificateSeeds'
import type {
  Certificate,
  CertificateDefinition,
  CertificateGroup,
  CertificateRequirement,
  CertificateSubstitution,
  CertificateRosterEntry,
  GroupKind,
  StudentCertificate
} from '../../shared/types'

/* ------------------------------- reading ------------------------------- */

export function listCertificates(): Certificate[] {
  return (
    getDb()
      .prepare('SELECT id, name, total_units, notes FROM certificates ORDER BY name ASC')
      .all() as { id: string; name: string; total_units: number | null; notes: string | null }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    totalUnits: row.total_units,
    notes: row.notes
  }))
}

export function getCertificate(id: string): CertificateDefinition | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id, name, total_units, notes FROM certificates WHERE id = ?')
    .get(id) as { id: string; name: string; total_units: number | null; notes: string | null } | undefined
  if (!row) return null

  const groups = (
    db
      .prepare(
        `SELECT id, name, kind, min_units, parent_id, sort_order
         FROM certificate_groups WHERE certificate_id = ? ORDER BY sort_order ASC`
      )
      .all(id) as {
      id: string
      name: string
      kind: string
      min_units: number | null
      parent_id: string | null
      sort_order: number
    }[]
  ).map(
    (g): CertificateGroup => ({
      id: g.id,
      name: g.name,
      kind: g.kind as GroupKind,
      minUnits: g.min_units,
      parentId: g.parent_id,
      sortOrder: g.sort_order
    })
  )

  const requirements = (
    db
      .prepare(
        `SELECT id, group_id, course_code, credit_units, sort_order
         FROM certificate_requirements WHERE certificate_id = ? ORDER BY sort_order ASC`
      )
      .all(id) as {
      id: string
      group_id: string
      course_code: string
      credit_units: number
      sort_order: number
    }[]
  ).map(
    (r): CertificateRequirement => ({
      id: r.id,
      groupId: r.group_id,
      courseCode: r.course_code,
      creditUnits: r.credit_units,
      sortOrder: r.sort_order
    })
  )

  const substitutions = (
    db
      .prepare(
        `SELECT id, replaces_code, accepted_code, also_requires_code
         FROM certificate_substitutions WHERE certificate_id = ?`
      )
      .all(id) as {
      id: string
      replaces_code: string
      accepted_code: string
      also_requires_code: string | null
    }[]
  ).map(
    (s): CertificateSubstitution => ({
      id: s.id,
      replacesCode: s.replaces_code,
      acceptedCode: s.accepted_code,
      alsoRequiresCode: s.also_requires_code
    })
  )

  return {
    id: row.id,
    name: row.name,
    totalUnits: row.total_units,
    notes: row.notes,
    groups,
    requirements,
    substitutions
  }
}

export function listCertificateDefinitions(): CertificateDefinition[] {
  return listCertificates()
    .map((c) => getCertificate(c.id))
    .filter((c): c is CertificateDefinition => c !== null)
}

/* ------------------------------- progress ------------------------------ */

/** Every certificate, with how far this student is through each. */
export function studentCertificates(studentId: string): StudentCertificate[] {
  const courses = listStudentCourses(studentId)
  const declared = new Set(
    (
      getDb()
        .prepare('SELECT certificate_id FROM student_certificates WHERE student_id = ?')
        .all(studentId) as { certificate_id: string }[]
    ).map((r) => r.certificate_id)
  )

  return listCertificateDefinitions().map((definition) => ({
    ...certificateProgress(definition, courses),
    declared: declared.has(definition.id)
  }))
}

/**
 * Everyone who has touched a certificate, furthest along first.
 *
 * Only students with at least one course on record appear — the rest have no
 * progress to report and would bury the ones who do.
 */
export function certificateRoster(certificateId: string): CertificateRosterEntry[] {
  const definition = getCertificate(certificateId)
  if (!definition) return []

  const db = getDb()
  // Through listStudents, so the year shown here is the worked-out one and
  // matches what the Students screen says rather than the raw record.
  const withCourses = new Set(
    (db.prepare('SELECT DISTINCT student_id FROM student_courses').all() as { student_id: string }[]).map(
      (r) => r.student_id
    )
  )
  const students = listStudents().filter((s) => withCourses.has(s.id))

  const declared = new Set(
    (
      db
        .prepare('SELECT student_id FROM student_certificates WHERE certificate_id = ?')
        .all(certificateId) as { student_id: string }[]
    ).map((r) => r.student_id)
  )

  return students
    .map((student) => {
      const progress = certificateProgress(definition, listStudentCourses(student.id))
      return {
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        currentYear: student.currentYear,
        earnedUnits: progress.earnedUnits,
        inProgressUnits: progress.inProgressUnits,
        totalUnits: progress.totalUnits,
        percent: progress.percent,
        complete: progress.complete,
        declared: declared.has(student.id),
        missing: progress.missing
      }
    })
    .filter((entry) => entry.earnedUnits > 0 || entry.inProgressUnits > 0 || entry.declared)
    .sort((a, b) => b.earnedUnits - a.earnedUnits || a.lastName.localeCompare(b.lastName))
}

export function setStudentCertificate(studentId: string, certificateId: string, declared: boolean): void {
  const db = getDb()
  if (!declared) {
    db.prepare('DELETE FROM student_certificates WHERE student_id = ? AND certificate_id = ?').run(
      studentId,
      certificateId
    )
    return
  }
  db.prepare(
    `INSERT INTO student_certificates (id, student_id, certificate_id, declared_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(student_id, certificate_id) DO NOTHING`
  ).run(newId(), studentId, certificateId, new Date().toISOString())
}

/* ------------------------------- editing ------------------------------- */

export function createCertificate(name: string, totalUnits: number | null, notes: string | null): string {
  const id = newId()
  const now = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO certificates (id, name, total_units, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, name.trim(), totalUnits, notes, now, now)
  return id
}

export function updateCertificate(
  id: string,
  fields: { name?: string; totalUnits?: number | null; notes?: string | null }
): void {
  const db = getDb()
  const current = db.prepare('SELECT name, total_units, notes FROM certificates WHERE id = ?').get(id) as
    | { name: string; total_units: number | null; notes: string | null }
    | undefined
  if (!current) throw new Error('Certificate not found')

  db.prepare('UPDATE certificates SET name = ?, total_units = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    fields.name?.trim() ?? current.name,
    fields.totalUnits === undefined ? current.total_units : fields.totalUnits,
    fields.notes === undefined ? current.notes : fields.notes,
    new Date().toISOString(),
    id
  )
}

export function deleteCertificate(id: string): void {
  getDb().prepare('DELETE FROM certificates WHERE id = ?').run(id)
}

export function createGroup(
  certificateId: string,
  input: { name: string; kind: GroupKind; minUnits: number | null; parentId?: string | null }
): string {
  const db = getDb()
  const id = newId()
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM certificate_groups WHERE certificate_id = ?')
    .get(certificateId) as { n: number }
  db.prepare(
    `INSERT INTO certificate_groups (id, certificate_id, name, kind, min_units, parent_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, certificateId, input.name.trim(), input.kind, input.minUnits, input.parentId ?? null, next.n)
  return id
}

export function updateGroup(
  id: string,
  fields: { name?: string; minUnits?: number | null; sortOrder?: number }
): void {
  const db = getDb()
  const current = db.prepare('SELECT name, min_units, sort_order FROM certificate_groups WHERE id = ?').get(id) as
    | { name: string; min_units: number | null; sort_order: number }
    | undefined
  if (!current) throw new Error('Group not found')

  db.prepare('UPDATE certificate_groups SET name = ?, min_units = ?, sort_order = ? WHERE id = ?').run(
    fields.name?.trim() ?? current.name,
    fields.minUnits === undefined ? current.min_units : fields.minUnits,
    fields.sortOrder ?? current.sort_order,
    id
  )
}

export function deleteGroup(id: string): void {
  getDb().prepare('DELETE FROM certificate_groups WHERE id = ?').run(id)
}

export function addRequirement(groupId: string, courseCode: string, creditUnits: number): string {
  const db = getDb()
  const group = db.prepare('SELECT certificate_id FROM certificate_groups WHERE id = ?').get(groupId) as
    | { certificate_id: string }
    | undefined
  if (!group) throw new Error('Group not found')

  const id = newId()
  const next = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM certificate_requirements WHERE group_id = ?')
    .get(groupId) as { n: number }
  db.prepare(
    `INSERT INTO certificate_requirements
       (id, certificate_id, group_id, course_code, credit_units, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id, course_code) DO UPDATE SET credit_units = excluded.credit_units`
  ).run(id, group.certificate_id, groupId, courseCode.trim().toUpperCase(), creditUnits, next.n)
  return id
}

export function removeRequirement(id: string): void {
  getDb().prepare('DELETE FROM certificate_requirements WHERE id = ?').run(id)
}

export function addSubstitution(
  certificateId: string,
  replacesCode: string,
  acceptedCode: string,
  alsoRequiresCode: string | null
): void {
  getDb()
    .prepare(
      `INSERT INTO certificate_substitutions
         (id, certificate_id, replaces_code, accepted_code, also_requires_code)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(certificate_id, replaces_code, accepted_code) DO UPDATE SET
         also_requires_code = excluded.also_requires_code`
    )
    .run(
      newId(),
      certificateId,
      replacesCode.trim().toUpperCase(),
      acceptedCode.trim().toUpperCase(),
      alsoRequiresCode ? alsoRequiresCode.trim().toUpperCase() : null
    )
}

export function removeSubstitution(id: string): void {
  getDb().prepare('DELETE FROM certificate_substitutions WHERE id = ?').run(id)
}

/* -------------------------------- seeding ------------------------------ */

/** Writes one seed definition into the database as a new certificate. */
export function installCertificate(seed: CertificateSeed): string {
  const db = getDb()
  const install = db.transaction((): string => {
    const certificateId = createCertificate(seed.name, seed.totalUnits, seed.notes)

    for (const group of seed.groups) {
      const groupId = createGroup(certificateId, {
        name: group.name,
        kind: group.kind,
        minUnits: group.minUnits ?? null
      })
      for (const course of group.courses) {
        addRequirement(groupId, course.code, course.units)
      }
      for (const child of group.children ?? []) {
        const childId = createGroup(certificateId, {
          name: child.name,
          kind: child.kind,
          minUnits: child.minUnits ?? null,
          parentId: groupId
        })
        for (const course of child.courses) {
          addRequirement(childId, course.code, course.units)
        }
      }
    }

    for (const sub of seed.substitutions ?? []) {
      addSubstitution(certificateId, sub.replaces, sub.accepted, sub.alsoRequires ?? null)
    }

    return certificateId
  })
  return install()
}

/**
 * Puts the three College of Engineering certificates in, when somebody asks
 * for them from the Certificates screen.
 *
 * Deliberately not done on its own. A certificate is the user's data, and
 * finding three of them already in a database you just created is a
 * surprise — the right kind of help is saving somebody from typing out
 * 38 course requirements, not deciding for them that they wanted it.
 */
export function installStarterCertificates(): number {
  const existing = getDb().prepare('SELECT COUNT(*) AS c FROM certificates').get() as { c: number }
  if (existing.c > 0) return 0

  for (const seed of USASK_CERTIFICATES) installCertificate(seed)
  return USASK_CERTIFICATES.length
}

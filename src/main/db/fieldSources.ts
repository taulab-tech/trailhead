import { getDb } from './index'

/**
 * When each of a student's details was last known to be true.
 *
 * The importer uses this to decide whether what it is carrying is newer than
 * what is already on record. Without it, re-importing a 2021 roster would
 * cheerfully overwrite a 2026 one, and a correction somebody typed in by
 * hand would be lost the next time any file mentioning them was imported.
 *
 * A value typed into the app is recorded with the source "manual", which is
 * never overwritten automatically — only ever proposed.
 */

export const MANUAL_SOURCE = 'manual'

export interface FieldSource {
  observedAt: string
  source: string
}

/** Every recorded source for one student, keyed by field name. */
export function fieldSourcesFor(studentId: string): Map<string, FieldSource> {
  const rows = getDb()
    .prepare('SELECT field, observed_at, source FROM student_field_sources WHERE student_id = ?')
    .all(studentId) as { field: string; observed_at: string; source: string }[]
  return new Map(rows.map((r) => [r.field, { observedAt: r.observed_at, source: r.source }]))
}

export function recordFieldSource(
  studentId: string,
  field: string,
  observedAt: string,
  source: string
): void {
  getDb()
    .prepare(
      `INSERT INTO student_field_sources (student_id, field, observed_at, source, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(student_id, field) DO UPDATE SET
         observed_at = excluded.observed_at,
         source = excluded.source,
         updated_at = excluded.updated_at`
    )
    .run(studentId, field, observedAt, source, new Date().toISOString())
}

/** Marks fields as typed in by a person, so no import overwrites them silently. */
export function markFieldsManual(studentId: string, fields: string[]): void {
  const now = new Date().toISOString()
  for (const field of fields) recordFieldSource(studentId, field, now, MANUAL_SOURCE)
}

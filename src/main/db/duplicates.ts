import { newId } from '../ids'
import { getDb } from './index'
import { getStudentById } from './students'
import { nameOrderIsConfirmed } from './fieldSources'
import { explainReversedName, isReversedName } from '../nameOrder'
import type { PossibleDuplicate, Student } from '../../shared/types'

interface DuplicateRow {
  id: string
  student_a_id: string
  student_b_id: string
  score: number
  reason: string | null
  status: 'pending' | 'merged' | 'dismissed'
  created_at: string
}

/** Records a possible-duplicate pair if this pair has never been suggested before (in either order). */
export function suggestDuplicate(studentAId: string, studentBId: string, score: number, reason: string): void {
  if (studentAId === studentBId) return
  const [a, b] = [studentAId, studentBId].sort()
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM possible_duplicates WHERE student_a_id = ? AND student_b_id = ?')
    .get(a, b)
  if (existing) return
  db.prepare(
    `INSERT INTO possible_duplicates (id, student_a_id, student_b_id, score, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(newId(), a, b, score, reason, new Date().toISOString())
}


/**
 * Fills in what the pair looks like now, rather than what it looked like
 * when it was flagged.
 *
 * The reversed-name case is worked out on read for two reasons: pairs
 * already queued from an earlier build get the better explanation without
 * re-importing anything, and the roster evidence can arrive after the pair
 * was flagged — a class list imported next week settles which way round a
 * name goes, and the screen should say so the moment it does.
 */
function describe(row: DuplicateRow, studentA: Student, studentB: Student): PossibleDuplicate {
  const base = {
    id: row.id,
    studentA,
    studentB,
    score: row.score,
    status: row.status,
    createdAt: row.created_at
  }

  if (isReversedName(studentA, studentB)) {
    const verdict = explainReversedName(
      studentA,
      studentB,
      nameOrderIsConfirmed(studentA.id),
      nameOrderIsConfirmed(studentB.id)
    )
    return { ...base, reason: verdict.reason, reversedName: true, confirmedNameSide: verdict.confirmed }
  }

  return { ...base, reason: row.reason ?? '', reversedName: false, confirmedNameSide: null }
}

export function listPossibleDuplicates(status: 'pending' | 'merged' | 'dismissed' = 'pending'): PossibleDuplicate[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM possible_duplicates WHERE status = ? ORDER BY score DESC, created_at DESC')
    .all(status) as DuplicateRow[]
  const result: PossibleDuplicate[] = []
  for (const row of rows) {
    const studentA = getStudentById(row.student_a_id)
    const studentB = getStudentById(row.student_b_id)
    if (!studentA || !studentB) continue
    result.push(describe(row, studentA, studentB))
  }
  return result
}

export function getPendingDuplicateCount(): number {
  const db = getDb()
  const row = db
    .prepare("SELECT COUNT(*) as c FROM possible_duplicates WHERE status = 'pending'")
    .get() as { c: number }
  return row.c
}

export function dismissDuplicate(id: string): void {
  const db = getDb()
  db.prepare("UPDATE possible_duplicates SET status = 'dismissed' WHERE id = ?").run(id)
}

export function getDuplicateById(id: string): PossibleDuplicate | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM possible_duplicates WHERE id = ?').get(id) as
    | DuplicateRow
    | undefined
  if (!row) return null
  const studentA = getStudentById(row.student_a_id)
  const studentB = getStudentById(row.student_b_id)
  if (!studentA || !studentB) return null
  return describe(row, studentA, studentB)
}

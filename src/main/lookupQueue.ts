import { getDb } from './db/index'
import { getStudentById } from './db/students'
import { getSettings } from './db/settings'
import { lookUpPosition } from './positionLookup'
import type { LookupItem, LookupStatus, PositionSearchResult } from '../shared/types'

/**
 * Background LinkedIn lookups for a batch of students (e.g. everyone a new
 * roster added). It only ever searches — results wait in lookup_queue for the
 * user to review, and nothing is saved to a student without their approval.
 *
 * Deliberately slow: one search every SECONDS_PER_SEARCH, and it pauses itself
 * after MAX_CONSECUTIVE_FAILURES in a row, which usually means the search
 * engine has started refusing requests. Stopped or paused work stays queued
 * and resumes only when the user asks.
 */
export const SECONDS_PER_SEARCH = 8
const MAX_CONSECUTIVE_FAILURES = 3

let running = false
let stopRequested = false
let pausedReason: string | null = null

type SearchFn = (firstName: string, lastName: string) => Promise<PositionSearchResult>
const defaultSearch: SearchFn = (firstName, lastName) =>
  lookUpPosition(firstName, lastName, '', getSettings().institutionNames)
let search: SearchFn = defaultSearch
let secondsPerSearch = SECONDS_PER_SEARCH

/** Tests swap in an offline search and drop the spacing; never used by the app. */
export function configureLookupsForTesting(options: { search?: SearchFn; secondsPerSearch?: number }): void {
  search = options.search ?? defaultSearch
  secondsPerSearch = options.secondsPerSearch ?? SECONDS_PER_SEARCH
}

/** Resolves once the worker has stopped (tests only need this to await a run). */
export async function waitForLookupsIdle(): Promise<void> {
  while (running) await new Promise((r) => setTimeout(r, 5))
}

interface QueueRow {
  student_id: string
  status: 'queued' | 'done' | 'failed'
  result: string | null
  error: string | null
}

/** Queues students who have no position yet and aren't already queued or awaiting review, then starts working. */
export function enqueueLookups(studentIds: string[]): number {
  const db = getDb()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO lookup_queue (student_id, status, updated_at)
     SELECT id, 'queued', ? FROM students WHERE id = ? AND position IS NULL`
  )
  let added = 0
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const id of studentIds) added += insert.run(now, id).changes
  })()
  if (added > 0) startLookups()
  return added
}

export function startLookups(): void {
  pausedReason = null
  stopRequested = false
  if (!running) void work()
}

export function stopLookups(): void {
  stopRequested = true
}

/** Puts failed searches back in line and starts again. */
export function retryFailedLookups(): void {
  getDb()
    .prepare("UPDATE lookup_queue SET status = 'queued', error = NULL, updated_at = ? WHERE status = 'failed'")
    .run(new Date().toISOString())
  startLookups()
}

/** Removes students from the queue (after their position is saved, or when skipped). */
export function dismissLookups(studentIds: string[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM lookup_queue WHERE student_id = ?')
  db.transaction(() => studentIds.forEach((id) => del.run(id)))()
}

export function getLookupStatus(): LookupStatus {
  const counts = getDb()
    .prepare('SELECT status, COUNT(*) as c FROM lookup_queue GROUP BY status')
    .all() as { status: string; c: number }[]
  const count = (s: string): number => counts.find((r) => r.status === s)?.c ?? 0
  return {
    running,
    queued: count('queued'),
    done: count('done'),
    failed: count('failed'),
    pausedReason,
    secondsPerSearch
  }
}

export function listLookups(): LookupItem[] {
  const rows = getDb()
    .prepare('SELECT student_id, status, result, error FROM lookup_queue ORDER BY updated_at')
    .all() as QueueRow[]
  return rows.flatMap((r) => {
    const student = getStudentById(r.student_id)
    if (!student) return []
    return [
      {
        student,
        status: r.status,
        result: r.result ? (JSON.parse(r.result) as PositionSearchResult) : null,
        error: r.error
      }
    ]
  })
}

async function work(): Promise<void> {
  running = true
  let failuresInARow = 0
  const db = getDb()
  const next = db.prepare(
    "SELECT student_id FROM lookup_queue WHERE status = 'queued' ORDER BY updated_at LIMIT 1"
  )
  const save = db.prepare('UPDATE lookup_queue SET status = ?, result = ?, error = ?, updated_at = ? WHERE student_id = ?')
  try {
    while (!stopRequested) {
      const row = next.get() as { student_id: string } | undefined
      if (!row) break
      const student = getStudentById(row.student_id)
      if (!student) {
        dismissLookups([row.student_id])
        continue
      }
      const startedAt = Date.now()
      try {
        const result = await search(student.firstName, student.lastName)
        save.run('done', JSON.stringify(result), null, new Date().toISOString(), row.student_id)
        failuresInARow = 0
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        save.run('failed', null, message, new Date().toISOString(), row.student_id)
        failuresInARow++
        // Missing Python/ddgs fails the same way for everyone — no point going on.
        if (failuresInARow >= MAX_CONSECUTIVE_FAILURES || /isn’t installed|wasn’t found/.test(message)) {
          pausedReason = message
          break
        }
      }
      const wait = secondsPerSearch * 1000 - (Date.now() - startedAt)
      if (wait > 0 && !stopRequested) await new Promise((r) => setTimeout(r, wait))
    }
  } finally {
    running = false
  }
}

import { randomUUID } from 'crypto'
import { getDb } from './index'
import { getStudentById } from './students'
import type { EventDetail, EventRecord, Student } from '../../shared/types'

interface EventRow {
  id: string
  name: string
  date: string | null
  source_file: string | null
  source_sheet: string | null
  category_id: string | null
  created_at: string
}

interface EventRowWithCategory extends EventRow {
  category_name: string | null
  stage_order: number | null
}

const SELECT_WITH_CATEGORY = `
  SELECT e.*, c.name as category_name, c.stage_order as stage_order
  FROM events e
  LEFT JOIN event_categories c ON c.id = e.category_id
`

function attendeeCount(eventId: string): number {
  const db = getDb()
  const row = db
    .prepare('SELECT COUNT(*) as c FROM attendances WHERE event_id = ?')
    .get(eventId) as { c: number }
  return row.c
}

function rowToEvent(row: EventRowWithCategory): EventRecord {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    sourceFile: row.source_file,
    sourceSheet: row.source_sheet,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryStage: row.stage_order,
    createdAt: row.created_at,
    attendeeCount: attendeeCount(row.id)
  }
}

export function listEvents(): EventRecord[] {
  const db = getDb()
  const rows = db
    .prepare(`${SELECT_WITH_CATEGORY} ORDER BY e.date IS NULL, e.date DESC, e.name ASC`)
    .all() as EventRowWithCategory[]
  return rows.map(rowToEvent)
}

export function getEventById(id: string): EventRecord | null {
  const db = getDb()
  const row = db.prepare(`${SELECT_WITH_CATEGORY} WHERE e.id = ?`).get(id) as
    | EventRowWithCategory
    | undefined
  return row ? rowToEvent(row) : null
}

export function getEventDetail(id: string): EventDetail | null {
  const event = getEventById(id)
  if (!event) return null
  const db = getDb()
  const studentIds = db
    .prepare('SELECT student_id FROM attendances WHERE event_id = ?')
    .all(id) as { student_id: string }[]
  const attendees: Student[] = studentIds
    .map((r) => getStudentById(r.student_id))
    .filter((s): s is Student => !!s)
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
  return { ...event, attendees }
}

export function findEventIdByName(name: string): string | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id FROM events WHERE lower(name) = lower(?)')
    .get(name.trim()) as { id: string } | undefined
  return row?.id ?? null
}

export function findOrCreateEvent(
  name: string,
  date: string | null,
  sourceFile: string | null,
  sourceSheet: string | null,
  categoryId: string | null = null
): string {
  const existingId = findEventIdByName(name)
  const db = getDb()
  if (existingId) {
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(existingId) as EventRow
    if (!existing.date && date) {
      db.prepare('UPDATE events SET date = ? WHERE id = ?').run(date, existingId)
    }
    if (!existing.category_id && categoryId) {
      db.prepare('UPDATE events SET category_id = ? WHERE id = ?').run(categoryId, existingId)
    }
    return existingId
  }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO events (id, name, date, source_file, source_sheet, category_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name.trim(), date, sourceFile, sourceSheet, categoryId, new Date().toISOString())
  return id
}

export function updateEvent(
  id: string,
  fields: Partial<{ name: string; date: string | null; categoryId: string | null }>
): void {
  const db = getDb()
  const current = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined
  if (!current) throw new Error(`Event ${id} not found`)
  db.prepare('UPDATE events SET name = ?, date = ?, category_id = ? WHERE id = ?').run(
    fields.name ?? current.name,
    fields.date !== undefined ? fields.date : current.date,
    fields.categoryId !== undefined ? fields.categoryId : current.category_id,
    id
  )
}

export function deleteEvent(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
}

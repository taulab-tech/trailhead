import { newId } from '../ids'
import { getDb } from './index'
import type { EventCategory } from '../../shared/types'

interface CategoryRow {
  id: string
  name: string
  stage_order: number | null
  created_at: string
}

function rowToCategory(row: CategoryRow): EventCategory {
  return { id: row.id, name: row.name, stageOrder: row.stage_order }
}

export function listCategories(): EventCategory[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM event_categories ORDER BY stage_order IS NULL, stage_order ASC, name ASC')
    .all() as CategoryRow[]
  return rows.map(rowToCategory)
}

export function getCategoryById(id: string): EventCategory | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM event_categories WHERE id = ?').get(id) as
    | CategoryRow
    | undefined
  return row ? rowToCategory(row) : null
}

export function findCategoryByName(name: string): EventCategory | null {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM event_categories WHERE lower(name) = lower(?)')
    .get(name.trim()) as CategoryRow | undefined
  return row ? rowToCategory(row) : null
}

export function createCategory(name: string, stageOrder: number | null): EventCategory {
  const db = getDb()
  const existing = findCategoryByName(name)
  if (existing) return existing
  const id = newId()
  db.prepare(
    'INSERT INTO event_categories (id, name, stage_order, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, name.trim(), stageOrder, new Date().toISOString())
  return { id, name: name.trim(), stageOrder }
}

export function updateCategory(
  id: string,
  fields: Partial<{ name: string; stageOrder: number | null }>
): void {
  const db = getDb()
  const current = db.prepare('SELECT * FROM event_categories WHERE id = ?').get(id) as
    | CategoryRow
    | undefined
  if (!current) throw new Error(`Category ${id} not found`)
  db.prepare('UPDATE event_categories SET name = ?, stage_order = ? WHERE id = ?').run(
    fields.name ?? current.name,
    fields.stageOrder !== undefined ? fields.stageOrder : current.stage_order,
    id
  )
}

export function deleteCategory(id: string): void {
  const db = getDb()
  // Events referencing this category fall back to uncategorized rather than being deleted.
  db.prepare('UPDATE events SET category_id = NULL WHERE category_id = ?').run(id)
  db.prepare('DELETE FROM event_categories WHERE id = ?').run(id)
}

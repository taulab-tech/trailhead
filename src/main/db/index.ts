import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { normalizeNsid } from '../normalize'

let dbInstance: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  nsid TEXT,
  college TEXT,
  discipline TEXT,
  degree TEXT,
  program TEXT,
  year_in_program TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nsid ON students(nsid) WHERE nsid IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_emails (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_student_emails_student ON student_emails(student_id);

CREATE TABLE IF NOT EXISTS student_phones (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  phone TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_student_phones_student ON student_phones(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_phones_unique ON student_phones(student_id, phone);

CREATE TABLE IF NOT EXISTS event_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  stage_order INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT,
  source_file TEXT,
  source_sheet TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendances (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  extra_fields TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(student_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_attendances_student ON attendances(student_id);
CREATE INDEX IF NOT EXISTS idx_attendances_event ON attendances(event_id);

CREATE TABLE IF NOT EXISTS possible_duplicates (
  id TEXT PRIMARY KEY,
  student_a_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_b_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  UNIQUE(student_a_id, student_b_id)
);
CREATE INDEX IF NOT EXISTS idx_possible_duplicates_status ON possible_duplicates(status);
`

// Fixed ids so seeding is idempotent and other code can reference these
// well-known defaults directly (e.g. import category auto-guessing).
export const DEFAULT_CATEGORIES: { id: string; name: string; stageOrder: number | null }[] = [
  { id: 'cat-hackathon', name: 'Hackathon', stageOrder: 1 },
  { id: 'cat-inspiration', name: 'Inspiration Event', stageOrder: 1 },
  { id: 'cat-class', name: 'Class', stageOrder: 2 },
  { id: 'cat-sigma', name: 'SIGMA', stageOrder: 3 },
  { id: 'cat-social', name: 'Social', stageOrder: null },
  { id: 'cat-other', name: 'Other', stageOrder: null }
]

// `CREATE TABLE IF NOT EXISTS` only applies to brand-new tables — it won't add
// columns to a table that already exists from a previous version of the app.
// Anything added to an existing table after its first release needs an
// explicit migration step like this one.
function migrateSchema(db: Database.Database): void {
  const eventColumns = db.prepare('PRAGMA table_info(events)').all() as { name: string }[]
  if (!eventColumns.some((c) => c.name === 'category_id')) {
    db.exec(
      'ALTER TABLE events ADD COLUMN category_id TEXT REFERENCES event_categories(id) ON DELETE SET NULL'
    )
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id)')

  const studentColumns = db.prepare('PRAGMA table_info(students)').all() as { name: string }[]
  if (!studentColumns.some((c) => c.name === 'enrol_term')) {
    db.exec('ALTER TABLE students ADD COLUMN enrol_term TEXT')
  }

  renormalizeNsids(db)
}

/**
 * Brings NSIDs stored by older versions in line with the current
 * normalizeNsid (e.g. "abc123@usask.ca" → "abc123", "n/a" → NULL). A value
 * whose normalized form is already held by a different student is left
 * as-is rather than violating the unique index — those two records are
 * likely the same person and are for the user to merge.
 */
function renormalizeNsids(db: Database.Database): void {
  const rows = db.prepare('SELECT id, nsid FROM students WHERE nsid IS NOT NULL').all() as {
    id: string
    nsid: string
  }[]
  const holder = db.prepare('SELECT id FROM students WHERE nsid = ? AND id != ?')
  const update = db.prepare('UPDATE students SET nsid = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const row of rows) {
      const normalized = normalizeNsid(row.nsid)
      if (normalized === row.nsid) continue
      if (normalized && holder.get(normalized, row.id)) continue
      update.run(normalized, row.id)
    }
  })
  tx()
}

function seedDefaultCategories(db: Database.Database): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO event_categories (id, name, stage_order, created_at) VALUES (?, ?, ?, ?)'
  )
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const c of DEFAULT_CATEGORIES) insert.run(c.id, c.name, c.stageOrder, now)
  })
  tx()
}

function resolveDbPath(): string {
  return process.env.SIGMA_DB_PATH ?? path.join(app.getPath('userData'), 'sigma-attendance.db')
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const dbPath = resolveDbPath()

  dbInstance = new Database(dbPath)
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')
  dbInstance.exec(SCHEMA)
  migrateSchema(dbInstance)
  seedDefaultCategories(dbInstance)
  return dbInstance
}

export function closeDb(): void {
  dbInstance?.close()
  dbInstance = null
}

export function getDbPath(): string {
  return resolveDbPath()
}

export function getBackupDir(): string {
  return path.join(app.getPath('userData'), 'backups')
}

/**
 * Online backup via better-sqlite3's step-based backup API — safe to run
 * against a live, WAL-mode database (unlike copying the file directly, which
 * can grab it mid-checkpoint and produce a torn copy).
 */
export async function backupDatabaseTo(destPath: string): Promise<void> {
  await getDb().backup(destPath)
}

/** Deletes every student, event, and attendance record, then re-seeds the default categories. */
export function wipeDatabase(): void {
  const db = getDb()
  const tx = db.transaction(() => {
    // Cascades take care of student_emails/phones, attendances, and possible_duplicates.
    db.exec('DELETE FROM students')
    db.exec('DELETE FROM events')
    db.exec('DELETE FROM event_categories')
  })
  tx()
  seedDefaultCategories(db)
}

/**
 * Replaces the live database file with `sourcePath`. Takes a safety snapshot
 * of the current database first (returned so the caller can surface where it
 * went), since this is only ever invoked from a destructive "restore" action
 * where picking the wrong file would otherwise be unrecoverable.
 */
export async function restoreDatabaseFrom(sourcePath: string): Promise<string> {
  const probe = new Database(sourcePath, { readonly: true, fileMustExist: true })
  let looksValid: boolean
  try {
    looksValid = !!probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students'")
      .get()
  } finally {
    probe.close()
  }
  if (!looksValid) throw new Error('That file does not look like a SIGMA attendance database.')

  const backupDir = getBackupDir()
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safetyPath = path.join(backupDir, `sigma-attendance-before-restore-${stamp}.db`)
  await backupDatabaseTo(safetyPath)

  const liveDbPath = resolveDbPath()
  getDb().pragma('wal_checkpoint(TRUNCATE)')
  closeDb()

  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${liveDbPath}${suffix}`
    if (fs.existsSync(target)) fs.rmSync(target)
  }
  fs.copyFileSync(sourcePath, liveDbPath)

  getDb() // reopen — re-runs schema migrations in case the backup predates them
  return safetyPath
}

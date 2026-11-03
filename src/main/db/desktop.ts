import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { DB_FILE_NAME } from '../dataDir'
import { initializeDatabase, setDbDriver, type SqlDriver } from './index'

/**
 * The desktop half of the database: a real file on disk, opened with
 * better-sqlite3. Everything here is Electron- and filesystem-bound, which is
 * exactly why it lives apart from `db/index.ts` — the web build imports that
 * one and never this one.
 */

let dbInstance: Database.Database | null = null

function resolveDbPath(): string {
  return process.env.TRAILHEAD_DB_PATH ?? path.join(app.getPath('userData'), DB_FILE_NAME)
}

/** Opens (or reopens) the database file and hands it to the query layer. */
export function openDb(): Database.Database {
  if (dbInstance) return dbInstance

  dbInstance = new Database(resolveDbPath())
  dbInstance.pragma('journal_mode = WAL')
  // better-sqlite3's Database satisfies SqlDriver structurally; the cast is
  // only here because its generics are wider than the four methods we use.
  setDbDriver(dbInstance as unknown as SqlDriver)
  initializeDatabase(dbInstance as unknown as SqlDriver)
  return dbInstance
}

export function closeDb(): void {
  dbInstance?.close()
  dbInstance = null
  setDbDriver(null)
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
  await openDb().backup(destPath)
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
  if (!looksValid) throw new Error('That file does not look like a Trailhead database.')

  const backupDir = getBackupDir()
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safetyPath = path.join(backupDir, `trailhead-before-restore-${stamp}.db`)
  await backupDatabaseTo(safetyPath)

  const liveDbPath = resolveDbPath()
  openDb().pragma('wal_checkpoint(TRUNCATE)')
  closeDb()

  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${liveDbPath}${suffix}`
    if (fs.existsSync(target)) fs.rmSync(target)
  }
  fs.copyFileSync(sourcePath, liveDbPath)

  openDb() // reopen — re-runs schema migrations in case the backup predates them
  return safetyPath
}

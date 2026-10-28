import fs from 'fs'
import path from 'path'
import { backupDatabaseTo, getBackupDir } from './db'

const AUTO_BACKUPS_TO_KEEP = 14

function datedBackupName(date: Date): string {
  const iso = date.toISOString().slice(0, 10) // YYYY-MM-DD
  return `sigma-attendance-${iso}.db`
}

function pruneOldBackups(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^sigma-attendance-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort() // ISO dates sort chronologically as strings
  const excess = files.length - AUTO_BACKUPS_TO_KEEP
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(dir, files[i]))
  }
}

/**
 * Writes one dated backup per calendar day the app is opened, so a corrupted
 * DB file or wiped machine never costs more than a day of data. Runs in the
 * background after the window opens — a failure here shouldn't block startup.
 */
export async function runAutoBackup(): Promise<void> {
  const dir = getBackupDir()
  fs.mkdirSync(dir, { recursive: true })

  const dest = path.join(dir, datedBackupName(new Date()))
  if (fs.existsSync(dest)) return

  await backupDatabaseTo(dest)
  pruneOldBackups(dir)
}

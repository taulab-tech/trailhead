import fs from 'fs'
import path from 'path'

export const DB_FILE_NAME = 'trailhead.db'
const LEGACY_DB_FILE_NAME = 'sigma-attendance.db'

/**
 * Earlier versions kept data in a "sigma-attendance" folder. On first launch
 * with no database in the current folder, the old database (with its WAL
 * files) and backups are copied across. The old folder is left untouched as
 * a fallback.
 */
export function migrateLegacyDataDir(legacyDir: string, dataDir: string): void {
  const legacyDb = path.join(legacyDir, LEGACY_DB_FILE_NAME)
  if (fs.existsSync(path.join(dataDir, DB_FILE_NAME)) || !fs.existsSync(legacyDb)) return

  fs.mkdirSync(dataDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const from = legacyDb + suffix
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dataDir, DB_FILE_NAME + suffix))
  }
  const legacyBackups = path.join(legacyDir, 'backups')
  if (fs.existsSync(legacyBackups)) {
    fs.cpSync(legacyBackups, path.join(dataDir, 'backups'), { recursive: true, force: false })
  }
}

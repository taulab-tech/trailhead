import { normalizeNsid } from '../normalize'
import { USASK_CERTIFICATES, isUntrackedCourse } from '../certificateSeeds'
import { splitHeadline } from '../../shared/positions'
import { getDb, type SqlDriver } from './driver'

export { getDb, hasDb, setDbDriver } from './driver'
export type { SqlDriver, SqlStatement } from './driver'

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
  -- Marked as alumni, and the year they came through, which is how the
  -- cohort trackers are organised.
  is_alumni INTEGER NOT NULL DEFAULT 0,
  cohort_year INTEGER,
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

CREATE TABLE IF NOT EXISTS lookup_queue (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_courses (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL,
  -- The registrar's term stamp ("202509"). Empty rather than NULL so the
  -- unique index below actually catches a re-import: in SQLite two NULLs
  -- are never equal, so a nullable column wouldn't dedupe.
  term TEXT NOT NULL DEFAULT '',
  term_label TEXT,
  credit_units REAL,
  grade TEXT,
  reg_status TEXT,
  status TEXT NOT NULL,
  -- The student's year of study as the registrar recorded it at the time
  -- ("Fourth Year"). Kept per course rather than only on the student record,
  -- because it is the pairing with the term that makes it possible to work
  -- out what year they are in now.
  class_year TEXT,
  source_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(student_id, course_code, term)
);
CREATE INDEX IF NOT EXISTS idx_student_courses_student ON student_courses(student_id);
CREATE INDEX IF NOT EXISTS idx_student_courses_code ON student_courses(course_code);

-- When the data behind each of a student's fields was true, so a later
-- import can tell whether what it is carrying is newer than what is on
-- record. Without this, re-importing an old roster would quietly undo a
-- newer one.
CREATE TABLE IF NOT EXISTS student_field_sources (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  -- ISO date the value was true, e.g. the term or the event's date.
  observed_at TEXT NOT NULL,
  -- The file it came from, or 'manual' for a value somebody typed in.
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (student_id, field)
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  total_units REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A certificate is a set of groups: one or more "required" groups whose every
-- course must be completed, and "elective" groups that need a number of
-- credit units from a list. A group can sit inside another to express a rule
-- like "9 units of electives, at least 3 of which must be COMM" — the COMM
-- courses are a child group with its own minimum.
CREATE TABLE IF NOT EXISTS certificate_groups (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  min_units REAL,
  parent_id TEXT REFERENCES certificate_groups(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_certificate_groups_cert ON certificate_groups(certificate_id);

CREATE TABLE IF NOT EXISTS certificate_requirements (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES certificate_groups(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL,
  -- The units this course is worth towards the certificate, which is the
  -- catalogue's figure. It is deliberately not taken from the class list: a
  -- full-year course like GE 495.6 is exported once per term at 3.0 units,
  -- and counting that would leave every capstone student short.
  credit_units REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(group_id, course_code)
);
CREATE INDEX IF NOT EXISTS idx_certificate_requirements_cert ON certificate_requirements(certificate_id);

-- "You may count CHE 495.6 in place of GE 495.6, provided you also complete
-- GE 496.3." Both halves are checked before the substitution is allowed.
CREATE TABLE IF NOT EXISTS certificate_substitutions (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  replaces_code TEXT NOT NULL,
  accepted_code TEXT NOT NULL,
  also_requires_code TEXT,
  UNIQUE(certificate_id, replaces_code, accepted_code)
);

-- Who has said they are working towards which certificate. Progress is
-- worked out for every certificate regardless; this is what marks the ones
-- someone is actually pursuing.
CREATE TABLE IF NOT EXISTS student_certificates (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  certificate_id TEXT NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  declared_at TEXT NOT NULL,
  UNIQUE(student_id, certificate_id)
);
CREATE INDEX IF NOT EXISTS idx_student_certificates_student ON student_certificates(student_id);
`

/**
 * Creates the schema if it isn't there and brings an older database up to
 * date. Safe to run against a brand-new database and against one saved by any
 * earlier version — which matters more on the web, where the file people open
 * could have come from any build of the app.
 */
export function initializeDatabase(db: SqlDriver): void {
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrateSchema(db)
}

/** True if `db` holds a Trailhead database rather than some other SQLite file. */
export function looksLikeTrailheadDb(db: SqlDriver): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students'")
    .get()
}

// `CREATE TABLE IF NOT EXISTS` only applies to brand-new tables — it won't add
// columns to a table that already exists from a previous version of the app.
// Anything added to an existing table after its first release needs an
// explicit migration step like this one.
function migrateSchema(db: SqlDriver): void {
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
  for (const column of ['position', 'position_url', 'position_found_at', 'position_org', 'position_since']) {
    if (!studentColumns.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE students ADD COLUMN ${column} TEXT`)
    }
  }
  // Alumni are the same people, marked. A separate table would break
  // matching — the point is seeing that a 2021 alum first turned up at a
  // hackathon in 2019.
  if (!studentColumns.some((c) => c.name === 'is_alumni')) {
    db.exec('ALTER TABLE students ADD COLUMN is_alumni INTEGER NOT NULL DEFAULT 0')
  }
  if (!studentColumns.some((c) => c.name === 'cohort_year')) {
    db.exec('ALTER TABLE students ADD COLUMN cohort_year INTEGER')
  }
  const courseColumns = db.prepare('PRAGMA table_info(student_courses)').all() as { name: string }[]
  if (courseColumns.length > 0 && !courseColumns.some((c) => c.name === 'class_year')) {
    db.exec('ALTER TABLE student_courses ADD COLUMN class_year TEXT')
  }

  splitCombinedPositions(db)

  renormalizeNsids(db)

  dropUntrackedCertificateCourses(db)
}

/**
 * Positions saved before the separate organisation field held both in one
 * line ("PLC Programmer at Cameco"); split those where the line says "at"/"@".
 */
function splitCombinedPositions(db: SqlDriver): void {
  const rows = db
    .prepare('SELECT id, position FROM students WHERE position IS NOT NULL AND position_org IS NULL')
    .all() as { id: string; position: string }[]
  const update = db.prepare('UPDATE students SET position = ?, position_org = ? WHERE id = ?')
  const tx = db.transaction(() => {
    for (const row of rows) {
      const { title, org } = splitHeadline(row.position)
      if (org) update.run(title, org, row.id)
    }
  })
  tx()
}

/**
 * Brings stored student IDs in line with the current normalizeNsid
 * (e.g. "n/a" → NULL). Runs on open. A value
 * whose normalized form is already held by a different student is left
 * as-is rather than violating the unique index — those two records are
 * likely the same person and are for the user to merge.
 */
function renormalizeNsids(db: SqlDriver): void {
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

/**
 * Takes the COMM and RCM requirements out of the three starter certificates
 * in a database seeded by an earlier build, so an existing file shows the
 * same thing a new one does.
 *
 * Runs once per database and records that it has, because after this the
 * certificates are the user's again: somebody who deliberately adds COMM 204
 * back should not find it gone the next time they open the file.
 *
 * Only the three certificates the app seeded are touched, matched by name,
 * and only their course requirements — a certificate somebody typed out
 * themselves is left exactly as it is. The total is corrected only where it
 * still reads as the catalogue figure the seed wrote; if it has been edited
 * since, that edit is theirs and stands.
 */
export const GE_ONLY_MIGRATION_KEY = 'certificates_ge_only_v1'

export function dropUntrackedCertificateCourses(db: SqlDriver): void {
  const done = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(GE_ONLY_MIGRATION_KEY) as { value: string } | undefined
  if (done) return

  // The totals the earlier seeds wrote, by certificate name. A total that
  // still matches is one nobody has touched.
  const seededTotals: Record<string, number> = {
    'Engineering Innovation and Entrepreneurship': 26,
    'Engineering Entrepreneurship – Leading Innovative Teams': 13,
    'Engineering Entrepreneurship – New Product Market': 13
  }

  const tx = db.transaction(() => {
    for (const seed of USASK_CERTIFICATES) {
      const certificate = db
        .prepare('SELECT id, total_units FROM certificates WHERE name = ?')
        .get(seed.name) as { id: string; total_units: number | null } | undefined
      if (!certificate) continue

      const requirements = db
        .prepare('SELECT id, course_code FROM certificate_requirements WHERE certificate_id = ?')
        .all(certificate.id) as { id: string; course_code: string }[]
      const remove = db.prepare('DELETE FROM certificate_requirements WHERE id = ?')
      for (const requirement of requirements) {
        if (isUntrackedCourse(requirement.course_code)) remove.run(requirement.id)
      }

      // A group emptied by those deletions has nothing left to say. Children
      // first, so a parent whose only content was a child group goes too.
      for (let pass = 0; pass < 2; pass++) {
        db.prepare(
          `DELETE FROM certificate_groups
           WHERE certificate_id = ?
             AND id NOT IN (SELECT group_id FROM certificate_requirements WHERE certificate_id = ?)
             AND id NOT IN (SELECT parent_id FROM certificate_groups
                            WHERE certificate_id = ? AND parent_id IS NOT NULL)`
        ).run(certificate.id, certificate.id, certificate.id)
      }

      if (certificate.total_units === seededTotals[seed.name] && seed.totalUnits !== null) {
        db.prepare('UPDATE certificates SET total_units = ?, notes = ? WHERE id = ?').run(
          seed.totalUnits,
          seed.notes,
          certificate.id
        )
      }
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      GE_ONLY_MIGRATION_KEY,
      new Date().toISOString()
    )
  })
  tx()
}

/** Deletes every student, event, attendance record and group, leaving an empty trail. */
export function wipeDatabase(): void {
  const db = getDb()
  const tx = db.transaction(() => {
    // Cascades take care of student_emails/phones, attendances,
    // student_courses and possible_duplicates.
    db.exec('DELETE FROM students')
    db.exec('DELETE FROM events')
    db.exec('DELETE FROM event_categories')
  })
  tx()
}

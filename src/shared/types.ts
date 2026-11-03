export interface Student {
  id: string
  firstName: string
  lastName: string
  nsid: string | null
  college: string | null
  discipline: string | null
  degree: string | null
  program: string | null
  yearInProgram: string | null
  enrolTerm: 'fall' | 'winter' | null
  /** Job title, confirmed by the user from a LinkedIn lookup (or typed in). */
  position: string | null
  positionOrg: string | null
  /** When they started, as "YYYY-MM" (copied from the profile; search results don't carry it). */
  positionSince: string | null
  positionUrl: string | null
  positionFoundAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  emails: string[]
  phones: string[]
  attendanceCount: number
  /**
   * What year they are in now. Worked out on every read from the most recent
   * dated observation, never stored — a stored answer goes stale every
   * September without anyone noticing.
   */
  currentYear: YearEstimate
}

export interface StudentDetail extends Student {
  attendances: Attendance[]
  courses: StudentCourse[]
}

/**
 * Where a student stands in one course. `audited` is kept apart from the
 * rest because an audited course earns no credit, so it counts towards no
 * certificate however good the mark.
 */
export type CourseStatus = 'completed' | 'in_progress' | 'audited' | 'not_completed'

/** One student's record in one course, in one term. */
export interface StudentCourse {
  id: string
  studentId: string
  /** Subject and number, e.g. "GE 495". */
  courseCode: string
  /** The registrar's term stamp, e.g. "202509". */
  term: string | null
  /** The term as written, e.g. "2025 Fall Term". */
  termLabel: string | null
  creditUnits: number | null
  grade: string | null
  regStatus: string | null
  status: CourseStatus
  /** Year of study as recorded on this roster, e.g. "Fourth Year". */
  classYear: string | null
  sourceFile: string | null
}

export interface EventCategory {
  id: string
  name: string
  /** Position in the funnel (1 = entry, 2 = middle, 3 = end, …). null = not part of the funnel. */
  stageOrder: number | null
}

export interface EventRecord {
  id: string
  name: string
  date: string | null
  sourceFile: string | null
  sourceSheet: string | null
  categoryId: string | null
  categoryName: string | null
  categoryStage: number | null
  createdAt: string
  attendeeCount: number
}

export interface EventDetail extends EventRecord {
  attendees: Student[]
}

export interface Attendance {
  id: string
  studentId: string
  eventId: string
  eventName: string
  eventDate: string | null
  extraFields: Record<string, string>
  createdAt: string
}

export interface PossibleDuplicate {
  id: string
  studentA: Student
  studentB: Student
  score: number
  reason: string
  status: 'pending' | 'merged' | 'dismissed'
  createdAt: string
}

// --- Import pipeline types ---

export interface ParsedSheet {
  sheetName: string
  suggestedEventName: string
  suggestedDate: string | null
  suggestedCategoryId: string | null
  headers: string[]
  rowCount: number
  sampleRows: Record<string, string>[]
  /** Every data row, for the review-and-edit table on the import screen. */
  rows: Record<string, string>[]
  suggestedMapping: ColumnMapping
  /** Set when suggestedMapping flags a year column with 2+ distinct years — this sheet will split into one event per year on import. */
  yearSplitPreview: { column: string; years: number[] } | null
  /** Set when this sheet is a registrar class list, so the import also records who took the course. */
  course: ParsedCourse | null
}

/** The course a class list is a roster for. */
export interface ParsedCourse {
  code: string
  title: string | null
  term: string | null
  termLabel: string | null
}

export interface ParsedWorkbook {
  fileName: string
  filePath: string
  sheets: ParsedSheet[]
}

export type MappableField =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'nsid'
  | 'college'
  | 'discipline'
  | 'degree'
  | 'program'
  | 'yearInProgram'
  | 'ignore'

export type ColumnMapping = Record<string, MappableField>

export interface ImportSheetRequest {
  filePath: string
  fileName: string
  sheetName: string
  eventName: string
  eventDate: string | null
  categoryId: string | null
  mapping: ColumnMapping
  /** The rows to import, as reviewed/edited by the user. Omitted = read the sheet from the file. */
  rows?: Record<string, string>[]
}

/** What importing a row would do. `repeatOfRow` is a 0-based index into the same request's rows. */
export interface RowOutcome {
  status: 'new' | 'existing' | 'repeat' | 'skipped'
  matchedName?: string
  repeatOfRow?: number
}

export interface ImportPreview {
  rows: RowOutcome[]
  newStudents: number
  matchedExisting: number
  skippedBlankRows: number
  newDuplicateSuggestions: number
}

export interface ImportEventSummary {
  eventId: string
  eventName: string
  rowsProcessed: number
  newStudents: number
  matchedExisting: number
}

export interface ImportResult {
  events: ImportEventSummary[]
  rowsProcessed: number
  newStudents: number
  matchedExisting: number
  newDuplicateSuggestions: number
  skippedBlankRows: number
  /** Students this import created, e.g. to look them up on LinkedIn afterwards. */
  newStudentIds: string[]
}

export interface NewStudentInput {
  firstName: string
  lastName: string
  nsid?: string | null
  college?: string | null
  discipline?: string | null
  degree?: string | null
  program?: string | null
  yearInProgram?: string | null
  enrolTerm?: 'fall' | 'winter' | null
  email?: string | null
  phone?: string | null
}

export interface FunnelNode {
  categoryId: string
  categoryName: string
  stage: number
  studentCount: number
}

export interface FunnelFlow {
  fromCategoryId: string
  toCategoryId: string
  count: number
}

export interface FunnelStats {
  stages: number[]
  nodes: FunnelNode[]
  flows: FunnelFlow[]
  fullFunnelCount: number
}

export interface AttendanceDate {
  studentId: string
  eventId: string
  date: string
}

export interface DashboardStats {
  totalStudents: number
  totalEvents: number
  totalAttendances: number
  repeatAttendeeCount: number
  repeatAttendeeRate: number
  avgEventsPerStudent: number
  pendingDuplicates: number
  byCollege: { label: string; count: number }[]
  byDiscipline: { label: string; count: number }[]
  byYear: { label: string; count: number }[]
  topEvents: { eventId: string; name: string; count: number }[]
  eventsOverTime: { name: string; date: string | null; count: number }[]
  funnel: FunnelStats
  funnelYears: number[]
}

/** One possible LinkedIn match for a student, parsed from a search result. */
export interface PositionCandidate {
  name: string
  headline: string | null
  experience: string | null
  education: string | null
  location: string | null
  url: string
  snippet: string
  /** Which configured institution name the profile mentions, if any — likely the right person. */
  institutionMatch: string | null
}

export interface PositionSearchResult {
  /** The exact search that produced these results. */
  query: string
  /** Everything the search returned, before keeping only LinkedIn profiles. */
  resultCount: number
  candidates: PositionCandidate[]
  /** Set when the narrowing words found nothing and the name alone was searched instead. */
  broadenedFrom: string | null
  /** LinkedIn profiles dropped because they belong to someone with a different name. */
  otherNamesHidden: number
  /** Every search tried, in order, until someone was found. */
  attempts: SearchAttempt[]
}

export interface AppSettings {
  institutionNames: string[]
}

/** One student's place in the background LinkedIn lookup queue. */
export interface LookupItem {
  student: Student
  status: 'queued' | 'done' | 'failed'
  result: PositionSearchResult | null
  error: string | null
}

export interface LookupStatus {
  running: boolean
  queued: number
  done: number
  failed: number
  /** Why the worker stopped early (e.g. the search engine refusing searches), if it did. */
  pausedReason: string | null
  secondsPerSearch: number
}

export interface SearchAttempt {
  query: string
  resultCount: number
  /** Profiles with the student's name among the results. */
  profilesFound: number
}

/**
 * What this build of Trailhead can do. The desktop app can search the web for
 * a student's position; the web app deliberately cannot — it has no backend
 * to search from, and routing it through one would put student names on
 * somebody else's server. Screens check here rather than failing on click.
 */
export interface AppCapabilities {
  positionLookup: boolean
  /**
   * Whether the app owns a database file it can swap out from under itself.
   * The desktop build does; on the web the user opens a file themselves, so
   * restoring means opening a different one from the start screen.
   */
  restoreFromBackup: boolean
}

/* ----------------------------- Certificates ----------------------------- */

/** Whether a course counts towards a certificate yet. */
export type CourseStanding = 'completed' | 'in_progress' | 'none'

export type GroupKind = 'required' | 'elective'

/**
 * A set of courses within a certificate. A "required" group needs every
 * course in it; an "elective" group needs `minUnits` worth from the list. A
 * group nested inside another expresses a rule like "9 units of electives,
 * at least 3 of which must be COMM".
 */
export interface CertificateGroup {
  id: string
  name: string
  kind: GroupKind
  minUnits: number | null
  parentId: string | null
  sortOrder: number
}

export interface CertificateRequirement {
  id: string
  groupId: string
  courseCode: string
  /** What the catalogue says the course is worth, not what a class list says. */
  creditUnits: number
  sortOrder: number
}

/** "CHE 495.6 counts in place of GE 495.6, if GE 496.3 is also done." */
export interface CertificateSubstitution {
  id: string
  replacesCode: string
  acceptedCode: string
  alsoRequiresCode: string | null
}

export interface Certificate {
  id: string
  name: string
  /** Null means "add the parts up". */
  totalUnits: number | null
  notes: string | null
}

export interface CertificateDefinition extends Certificate {
  groups: CertificateGroup[]
  requirements: CertificateRequirement[]
  substitutions: CertificateSubstitution[]
}

export interface RequirementProgress {
  courseCode: string
  creditUnits: number
  standing: CourseStanding
  /** The course that stood in for this one, when a substitution applied. */
  satisfiedBy: string | null
}

export interface GroupProgress {
  id: string
  name: string
  kind: GroupKind
  minUnits: number | null
  earnedUnits: number
  satisfied: boolean
  requirements: RequirementProgress[]
  children: GroupProgress[]
}

export interface CertificateProgress {
  certificateId: string
  name: string
  totalUnits: number
  earnedUnits: number
  /** Units they would gain by finishing what they are currently taking. */
  inProgressUnits: number
  percent: number
  complete: boolean
  groups: GroupProgress[]
  /** Required courses still outstanding. */
  missing: string[]
}

/** A certificate with one student's progress through it. */
export interface StudentCertificate extends CertificateProgress {
  /** True when the student has said they are working towards this one. */
  declared: boolean
}

/** One student's standing in a certificate, for the roster view. */
export interface CertificateRosterEntry {
  studentId: string
  firstName: string
  lastName: string
  yearInProgram: string | null
  earnedUnits: number
  inProgressUnits: number
  totalUnits: number
  percent: number
  complete: boolean
  declared: boolean
  missing: string[]
}

/* --------------------------- Year of study ------------------------------ */

/** Something that said what year a student was in, and when it said it. */
export interface YearObservation {
  /** As written: "Fourth Year", "2nd year", "PhD". */
  raw: string
  /** The academic year it was observed in; Winter 2026 counts as 2025. */
  academicYear: number
  /** For display, e.g. "Fall 2024". */
  when: string
  /** The registrar is believed over a self-reported form answer. */
  source: 'classlist' | 'event'
  /**
   * False for a value held on the student record with nothing saying when
   * it was true. It still beats knowing nothing, but it can't be advanced
   * and shouldn't be presented as current.
   */
  dated?: boolean
}

export type YearKind = 'year' | 'graduate' | 'likely_graduated' | 'unknown'

/** What year a student is in now, worked out from the most recent observation. */
export interface YearEstimate {
  kind: YearKind
  /** 1-5 when `kind` is "year". */
  year: number | null
  label: string
  /** For sorting: 1-5 by year, then graduate, likely graduated, unknown. */
  ordinal: number
  /** What it was worked out from, e.g. "Fourth Year, Fall 2024". */
  basis: string | null
  /** True when the observation is from this academic year, so nothing was inferred. */
  current: boolean
}

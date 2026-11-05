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
  /** Marked as having come through the programme, rather than still in it. */
  isAlumni: boolean
  /** The year they came through, as the cohort trackers record it. */
  cohortYear: number | null
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
  /** The two records hold the same name the opposite way round. */
  reversedName: boolean
  /**
   * The side whose name order came from a "Last, First" roster, when one
   * did. Null means nothing on record settles it.
   */
  confirmedNameSide: 'a' | 'b' | null
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
  | 'cohortYear'
  | 'graduated'
  | 'position'
  | 'positionOrg'
  | 'positionUrl'
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
  /** Mark everyone on this sheet as alumni — for importing a cohort list. */
  markAsAlumni?: boolean
  /** The rows to import, as reviewed/edited by the user. Omitted = read the sheet from the file. */
  rows?: Record<string, string>[]
  /**
   * Proposed detail changes the user unticked, by key. Anything not listed
   * here is applied — refreshing records is the point of re-importing.
   */
  rejectedUpdates?: string[]
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
  /** Details of existing students this import would change. */
  updates: FieldUpdate[]
  /** Blanks it would fill in, which need no decision. */
  blanksFilled: number
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
  /** Details of existing students that were refreshed. */
  updatedFields: number
  blanksFilled: number
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
  position?: string | null
  positionOrg?: string | null
  positionUrl?: string | null
  isAlumni?: boolean
  cohortYear?: number | null
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
  /** Where the local lookup helper is listening, or null if it isn't used. */
  lookupHelperUrl: string | null
  searchApiKey: string | null
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
  /** Whether a lookup can be run right now. On the web this follows the helper. */
  positionLookup: boolean
  /**
   * Whether this build needs a search key pasted in to look people up.
   * True on the web, where the page cannot read a search engine's reply
   * on its own; false on the desktop, which has its own helper.
   */
  needsSearchKey: boolean
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
  /** The worked-out year, the same one the Students screen shows. */
  currentYear: YearEstimate
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

/* ------------------------- Updating on re-import ------------------------ */

/** The student details an import is allowed to refresh. */
export const UPDATABLE_FIELDS = [
  'nsid',
  'college',
  'discipline',
  'degree',
  'program',
  'yearInProgram',
  'position',
  'positionOrg',
  'positionUrl'
] as const

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

export const FIELD_LABELS: Record<UpdatableField, string> = {
  nsid: 'Student ID',
  college: 'College',
  discipline: 'Discipline',
  degree: 'Degree',
  program: 'Program',
  yearInProgram: 'Year in program',
  position: 'Position',
  positionOrg: 'Organisation',
  positionUrl: 'LinkedIn'
}

/**
 * A detail an import would change on a student who is already on record.
 * Filling a blank happens quietly; replacing something is only ever
 * proposed, so nothing a person typed in is lost without them seeing it.
 */
export interface FieldUpdate {
  /** "studentId:field" — what the review screen ticks and unticks. */
  key: string
  studentId: string
  studentName: string
  field: UpdatableField
  label: string
  from: string
  to: string
  /** What the existing value was last known to be true, if anything says. */
  fromObservedAt: string | null
  /** Whether the existing value was typed in rather than imported. */
  fromManual: boolean
}

/* --------------------------- Who to contact ----------------------------- */

/** Why somebody is worth a word right now. */
export type ReachOutReason = 'close_to_finishing' | 'final_year' | 'drifting'

/**
 * One suggested student, with the number behind it. The reason and the
 * figures are carried so the suggestion can be argued with rather than
 * taken on trust.
 */
export interface ReachOutSuggestion {
  studentId: string
  firstName: string
  lastName: string
  reason: ReachOutReason
  /** A sentence saying why, e.g. "3 CU from finishing …". */
  detail: string
  certificateName: string
  unitsRemaining: number
  percent: number
  /** The most recent event or course term on their record. */
  lastSeen: string | null
  monthsQuiet: number | null
}

/**
 * Somebody seen recently, and what they look like if you follow up.
 *
 * The other half of "worth a word": that list is people who have gone
 * quiet or are nearly done, this one is people who turned up lately and
 * are still warm. Sorted by when they were last seen, never by promise —
 * a recency list reordered by score stops being a recency list.
 */
export interface RecentContact {
  studentId: string
  firstName: string
  lastName: string
  /** ISO date of the most recent sign of them. */
  lastSeen: string
  /** What that sign was — the event's name, or the term they were registered in. */
  where: string
  /** Events attended in total, which is what makes a returning face obvious. */
  attendanceCount: number
  /** The certificate they are furthest through, if they have started one. */
  certificateName: string | null
  percent: number | null
  /** One checkable line: "2 CU from finishing Innovation", "3rd event". */
  promise: string
  /** True for the few close enough that a word now is likely to finish it. */
  promising: boolean
}

/* ------------------------- Adding people on the spot -------------------- */

/** One line of pasted text, read as a person. */
export interface ParsedPerson {
  raw: string
  firstName: string
  lastName: string
  emails: string[]
  phones: string[]
  note: string | null
  nameOrderConfirmed: boolean
  problem: string | null
}

/** Somebody else this person keeps turning up with. */
export interface Connection {
  studentId: string
  firstName: string
  lastName: string
  /** Events the two of them have both been to. */
  sharedEvents: number
}

/** What the app can say about one person the moment they are added. */
export interface QuickAddPerson {
  studentId: string
  firstName: string
  lastName: string
  line: ParsedPerson
  /** True when nobody by this name was on record before today. */
  isNew: boolean
  /** Events attended in total, counting the one just added. */
  attendanceCount: number
  /** The last time anybody saw them before today, and where. */
  previouslySeen: string | null
  previouslySeenAt: string | null
  /** Details this line filled in or changed on their record. */
  updates: FieldUpdate[]
  /** Certificates they have started, furthest first. */
  certificates: { name: string; percent: number; unitsRemaining: number; complete: boolean }[]
  /** How far along the trail they have got. */
  furthestStop: string | null
  /** The people they overlap with most. */
  connections: Connection[]
  /** What to do next, and the fact behind it. */
  nextStep: string
  nextStepBecause: string
}

/** The result of pasting a list of people in. */
export interface QuickAddResult {
  /** The event they were added to, when one was given. */
  eventId: string | null
  eventName: string | null
  people: QuickAddPerson[]
  /** Lines that held no name, handed back to be fixed rather than dropped. */
  unreadable: ParsedPerson[]
  newStudents: number
  returning: number
}

/** What the screen sends when somebody pastes a list in. */
export interface QuickAddRequest {
  text: string
  /** The event they all attended. Blank adds them without an event. */
  eventName: string | null
  eventDate: string | null
  categoryId: string | null
  /** Preview only: work out what would happen without writing anything. */
  previewOnly?: boolean
}

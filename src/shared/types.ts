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
  notes: string | null
  createdAt: string
  updatedAt: string
  emails: string[]
  phones: string[]
  attendanceCount: number
}

export interface StudentDetail extends Student {
  attendances: Attendance[]
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

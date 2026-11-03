import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AttendanceDate,
  ColumnMapping,
  DashboardStats,
  EventCategory,
  EventDetail,
  EventRecord,
  FunnelStats,
  ImportPreview,
  ImportResult,
  ImportSheetRequest,
  NewStudentInput,
  ParsedWorkbook,
  PossibleDuplicate,
  Student,
  StudentDetail,
  PositionSearchResult,
  AppSettings,
  AppCapabilities,
  Certificate,
  CertificateDefinition,
  CertificateRosterEntry,
  GroupKind,
  StudentCertificate,
  LookupItem,
  LookupStatus
} from '../shared/types'

const api = {
  capabilities: { positionLookup: true, restoreFromBackup: true } as AppCapabilities,

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),

  previewImport: (filePath: string): Promise<ParsedWorkbook> =>
    ipcRenderer.invoke('import:preview', filePath),
  previewImportRows: (request: ImportSheetRequest): Promise<ImportPreview> =>
    ipcRenderer.invoke('import:previewRows', request),
  commitImport: (request: ImportSheetRequest): Promise<ImportResult> =>
    ipcRenderer.invoke('import:commit', request),

  listStudents: (search?: string): Promise<Student[]> => ipcRenderer.invoke('students:list', search),
  getStudentDetail: (id: string): Promise<StudentDetail | null> =>
    ipcRenderer.invoke('students:detail', id),
  createStudent: (input: NewStudentInput): Promise<string> => ipcRenderer.invoke('students:create', input),
  updateStudent: (id: string, fields: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('students:update', id, fields),
  deleteStudent: (id: string): Promise<void> => ipcRenderer.invoke('students:delete', id),
  addAttendance: (
    studentId: string,
    eventId: string,
    extraFields?: Record<string, string>
  ): Promise<void> => ipcRenderer.invoke('students:addAttendance', studentId, eventId, extraFields),
  removeAttendance: (attendanceId: string): Promise<void> =>
    ipcRenderer.invoke('students:removeAttendance', attendanceId),
  mergeStudents: (keepId: string, mergeId: string): Promise<void> =>
    ipcRenderer.invoke('students:merge', keepId, mergeId),
  findPosition: (studentId: string, extraTerms?: string): Promise<PositionSearchResult> =>
    ipcRenderer.invoke('students:findPosition', studentId, extraTerms),

  listEvents: (): Promise<EventRecord[]> => ipcRenderer.invoke('events:list'),
  getEventDetail: (id: string): Promise<EventDetail | null> => ipcRenderer.invoke('events:detail', id),
  updateEvent: (
    id: string,
    fields: { name?: string; date?: string | null; categoryId?: string | null }
  ): Promise<void> => ipcRenderer.invoke('events:update', id, fields),
  deleteEvent: (id: string): Promise<void> => ipcRenderer.invoke('events:delete', id),

  listCategories: (): Promise<EventCategory[]> => ipcRenderer.invoke('categories:list'),
  createCategory: (name: string, stageOrder: number | null): Promise<EventCategory> =>
    ipcRenderer.invoke('categories:create', name, stageOrder),
  updateCategory: (id: string, fields: { name?: string; stageOrder?: number | null }): Promise<void> =>
    ipcRenderer.invoke('categories:update', id, fields),
  deleteCategory: (id: string): Promise<void> => ipcRenderer.invoke('categories:delete', id),

  listDuplicates: (status?: 'pending' | 'merged' | 'dismissed'): Promise<PossibleDuplicate[]> =>
    ipcRenderer.invoke('duplicates:list', status),
  dismissDuplicate: (id: string): Promise<void> => ipcRenderer.invoke('duplicates:dismiss', id),
  mergeDuplicate: (id: string, keepId: string): Promise<void> =>
    ipcRenderer.invoke('duplicates:merge', id, keepId),

  getDashboardStats: (): Promise<DashboardStats> => ipcRenderer.invoke('dashboard:stats'),

  getEventStudentSets: (): Promise<{ eventId: string; studentIds: string[] }[]> =>
    ipcRenderer.invoke('funnel:eventStudentSets'),
  getAttendanceDates: (): Promise<AttendanceDate[]> => ipcRenderer.invoke('dashboard:attendanceDates'),
  getFunnelForYear: (year: number | null): Promise<FunnelStats> =>
    ipcRenderer.invoke('dashboard:funnelForYear', year),

  enqueueLookups: (studentIds: string[]): Promise<number> => ipcRenderer.invoke('lookups:enqueue', studentIds),
  getLookupStatus: (): Promise<LookupStatus> => ipcRenderer.invoke('lookups:status'),
  listLookups: (): Promise<LookupItem[]> => ipcRenderer.invoke('lookups:list'),
  startLookups: (): Promise<void> => ipcRenderer.invoke('lookups:start'),
  stopLookups: (): Promise<void> => ipcRenderer.invoke('lookups:stop'),
  retryFailedLookups: (): Promise<void> => ipcRenderer.invoke('lookups:retryFailed'),
  dismissLookups: (studentIds: string[]): Promise<void> => ipcRenderer.invoke('lookups:dismiss', studentIds),

  listCertificates: (): Promise<Certificate[]> => ipcRenderer.invoke('certificates:list'),
  getCertificate: (id: string): Promise<CertificateDefinition | null> =>
    ipcRenderer.invoke('certificates:get', id),
  getCertificateRoster: (id: string): Promise<CertificateRosterEntry[]> =>
    ipcRenderer.invoke('certificates:roster', id),
  createCertificate: (name: string, totalUnits: number | null, notes: string | null): Promise<string> =>
    ipcRenderer.invoke('certificates:create', name, totalUnits, notes),
  updateCertificate: (
    id: string,
    fields: { name?: string; totalUnits?: number | null; notes?: string | null }
  ): Promise<void> => ipcRenderer.invoke('certificates:update', id, fields),
  deleteCertificate: (id: string): Promise<void> => ipcRenderer.invoke('certificates:delete', id),
  addCertificateGroup: (
    certificateId: string,
    input: { name: string; kind: GroupKind; minUnits: number | null; parentId?: string | null }
  ): Promise<string> => ipcRenderer.invoke('certificates:addGroup', certificateId, input),
  updateCertificateGroup: (
    id: string,
    fields: { name?: string; minUnits?: number | null }
  ): Promise<void> => ipcRenderer.invoke('certificates:updateGroup', id, fields),
  deleteCertificateGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke('certificates:deleteGroup', id),
  addCertificateRequirement: (groupId: string, courseCode: string, creditUnits: number): Promise<string> =>
    ipcRenderer.invoke('certificates:addRequirement', groupId, courseCode, creditUnits),
  removeCertificateRequirement: (id: string): Promise<void> =>
    ipcRenderer.invoke('certificates:removeRequirement', id),
  addCertificateSubstitution: (
    certificateId: string,
    replacesCode: string,
    acceptedCode: string,
    alsoRequiresCode: string | null
  ): Promise<void> =>
    ipcRenderer.invoke('certificates:addSubstitution', certificateId, replacesCode, acceptedCode, alsoRequiresCode),
  removeCertificateSubstitution: (id: string): Promise<void> =>
    ipcRenderer.invoke('certificates:removeSubstitution', id),

  getStudentCertificates: (studentId: string): Promise<StudentCertificate[]> =>
    ipcRenderer.invoke('students:certificates', studentId),
  setStudentCertificate: (studentId: string, certificateId: string, declared: boolean): Promise<void> =>
    ipcRenderer.invoke('students:setCertificate', studentId, certificateId, declared),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setInstitutionNames: (names: string[]): Promise<string[]> =>
    ipcRenderer.invoke('settings:setInstitutionNames', names),

  backupDatabase: (): Promise<string | null> => ipcRenderer.invoke('db:backup'),
  restoreDatabase: (): Promise<string | null> => ipcRenderer.invoke('db:restore'),
  wipeDatabase: (): Promise<string | null> => ipcRenderer.invoke('db:wipe')
}

export type TrailheadApi = typeof api
export type { ColumnMapping }

contextBridge.exposeInMainWorld('api', api)

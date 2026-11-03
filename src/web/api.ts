import { wipeDatabase } from '../main/db'
import {
  addAttendance,
  createStudent,
  deleteStudent,
  getStudentDetail,
  listStudents,
  mergeStudents,
  removeAttendance,
  updateStudent
} from '../main/db/students'
import { deleteEvent, getEventDetail, listEvents, updateEvent } from '../main/db/events'
import { dismissDuplicate, getDuplicateById, listPossibleDuplicates } from '../main/db/duplicates'
import { createCategory, deleteCategory, listCategories, updateCategory } from '../main/db/categories'
import {
  getAttendanceDates,
  getDashboardStats,
  getEventStudentSets,
  getFunnelStats
} from '../main/db/dashboard'
import { getSettings, setInstitutionNames } from '../main/db/settings'
import { commitImport, parseWorkbookForPreview, previewImport } from '../main/importer'
import type {
  AppCapabilities,
  ImportSheetRequest,
  LookupItem,
  LookupStatus,
  NewStudentInput,
  PositionSearchResult
} from '../shared/types'
import { loadWorkbook, registerFile } from './workbooks'
import { downloadDatabase, save } from './session'
import { pickFilesWithInput } from './storage'

/**
 * `window.api` for the browser.
 *
 * In the desktop app this is a preload bridge that forwards to the main
 * process over IPC; here the same functions run in the page, against the
 * sql.js database. The shape is identical on purpose — every screen in
 * `src/renderer` is shared between the two builds and can't tell which it is
 * talking to.
 */

/**
 * Lookups are a desktop-only feature: they scrape a search engine through a
 * bundled Python, which a web page can't do and shouldn't try to. Rather
 * than throw on click, the screens check `capabilities` and hide the entry
 * points; these inert stubs keep the badge polling in `App.tsx` honest.
 */
const NO_LOOKUPS: LookupStatus = {
  running: false,
  queued: 0,
  done: 0,
  failed: 0,
  pausedReason: null,
  secondsPerSearch: 0
}

function lookupsUnavailable(): never {
  throw new Error('Looking up positions is only available in the desktop app.')
}

export const webApi = {
  capabilities: { positionLookup: false, restoreFromBackup: false } as AppCapabilities,

  // The renderer treats this as an opaque handle, so a reference to the file
  // held in memory does the same job as a path on disk.
  getPathForFile: (file: File): string => registerFile(file),

  pickFiles: async (): Promise<string[]> => {
    const files = await pickFilesWithInput('.xlsx,.xls,.csv')
    return files.map(registerFile)
  },

  previewImport: async (ref: string) => {
    await loadWorkbook(ref)
    return parseWorkbookForPreview(ref)
  },
  // The sheet is loaded even when the review screen has supplied edited
  // rows: a class list's course details live above the table, not in it.
  previewImportRows: async (request: ImportSheetRequest) => {
    await loadWorkbook(request.filePath)
    return previewImport(request)
  },
  commitImport: async (request: ImportSheetRequest) => {
    await loadWorkbook(request.filePath)
    const result = commitImport(request)
    await save()
    return result
  },

  listStudents: async (search?: string) => listStudents(search),
  getStudentDetail: async (id: string) => getStudentDetail(id),
  createStudent: async (input: NewStudentInput) => createStudent(input),
  updateStudent: async (id: string, fields: Parameters<typeof updateStudent>[1]) => {
    updateStudent(id, fields)
  },
  deleteStudent: async (id: string) => deleteStudent(id),
  addAttendance: async (studentId: string, eventId: string, extraFields?: Record<string, string>) => {
    addAttendance(studentId, eventId, extraFields ?? {})
  },
  removeAttendance: async (attendanceId: string) => removeAttendance(attendanceId),
  mergeStudents: async (keepId: string, mergeId: string) => mergeStudents(keepId, mergeId),
  findPosition: async (_studentId: string, _extraTerms?: string): Promise<PositionSearchResult> =>
    lookupsUnavailable(),

  listEvents: async () => listEvents(),
  getEventDetail: async (id: string) => getEventDetail(id),
  updateEvent: async (id: string, fields: Parameters<typeof updateEvent>[1]) => {
    updateEvent(id, fields)
  },
  deleteEvent: async (id: string) => deleteEvent(id),

  listCategories: async () => listCategories(),
  createCategory: async (name: string, stageOrder: number | null) => createCategory(name, stageOrder),
  updateCategory: async (id: string, fields: Parameters<typeof updateCategory>[1]) => {
    updateCategory(id, fields)
  },
  deleteCategory: async (id: string) => deleteCategory(id),

  listDuplicates: async (status?: 'pending' | 'merged' | 'dismissed') => listPossibleDuplicates(status),
  dismissDuplicate: async (id: string) => dismissDuplicate(id),
  mergeDuplicate: async (id: string, keepId: string) => {
    const duplicate = getDuplicateById(id)
    if (!duplicate) throw new Error('Duplicate suggestion not found')
    const mergeId = keepId === duplicate.studentA.id ? duplicate.studentB.id : duplicate.studentA.id
    // mergeStudents deletes this suggestion along with the merged-away record.
    mergeStudents(keepId, mergeId)
  },

  getDashboardStats: async () => getDashboardStats(),
  getEventStudentSets: async () => getEventStudentSets(),
  getAttendanceDates: async () => getAttendanceDates(),
  getFunnelForYear: async (year: number | null) => getFunnelStats(year),

  enqueueLookups: async (_studentIds: string[]): Promise<number> => 0,
  getLookupStatus: async (): Promise<LookupStatus> => NO_LOOKUPS,
  listLookups: async (): Promise<LookupItem[]> => [],
  startLookups: async (): Promise<void> => {},
  stopLookups: async (): Promise<void> => {},
  retryFailedLookups: async (): Promise<void> => {},
  dismissLookups: async (_studentIds: string[]): Promise<void> => {},

  getSettings: async () => getSettings(),
  setInstitutionNames: async (names: string[]) => setInstitutionNames(names),

  /** "Back up" on the web means handing the user a copy of the file. */
  backupDatabase: async (): Promise<string | null> => {
    const name = `trailhead-backup-${new Date().toISOString().slice(0, 10)}.db`
    downloadDatabase(name)
    return name
  },

  // Restoring means opening a different file, which the session gate on the
  // start screen handles. Offering it from Settings as well would leave the
  // currently open file ambiguous.
  restoreDatabase: async (): Promise<string | null> => null,

  wipeDatabase: async (): Promise<string | null> => {
    // The desktop app takes a safety snapshot first; here that means putting
    // a copy in the user's downloads before anything is deleted.
    const safetyName = `trailhead-before-wipe-${new Date().toISOString().slice(0, 10)}.db`
    downloadDatabase(safetyName)
    wipeDatabase()
    await save()
    return safetyName
  }
}

export type WebApi = typeof webApi

/** Makes the API available to the screens, exactly as the preload script does. */
export function installWebApi(): void {
  ;(window as unknown as { api: WebApi }).api = webApi
}

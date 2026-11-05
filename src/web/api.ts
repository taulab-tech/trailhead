import { wipeDatabase } from '../main/db'
import {
  addAttendance,
  createStudent,
  deleteStudent,
  getStudentById,
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
  getFunnelStats,
  reachOutSuggestions,
  recentContacts
} from '../main/db/dashboard'
import { getSettings, setInstitutionNames, setLookupHelperUrl } from '../main/db/settings'
import { lookUpPosition, setSearchTransport } from '../main/positionLookup'
import {
  dismissLookups,
  enqueueLookups,
  getLookupStatus,
  listLookups,
  retryFailedLookups,
  startLookups,
  stopLookups
} from '../main/lookupQueue'
import { detectHelper, helperIsRunning, helperSearch } from './lookupHelper'
import { markFieldsManual } from '../main/db/fieldSources'
import {
  addRequirement,
  addSubstitution,
  certificateRoster,
  createCertificate,
  createGroup,
  deleteCertificate,
  deleteGroup,
  getCertificate,
  installStarterCertificates,
  listCertificates,
  removeRequirement,
  removeSubstitution,
  setStudentCertificate,
  studentCertificates,
  updateCertificate,
  updateGroup
} from '../main/db/certificates' 
import { commitImport, parseWorkbookForPreview, previewImport } from '../main/importer'
import type {
  AppCapabilities,
  UpdatableField,
  ImportSheetRequest,
  LookupItem,
  LookupStatus,
  NewStudentInput,
  PositionSearchResult
} from '../shared/types'
import { UPDATABLE_FIELDS } from '../shared/types'
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
 * The queue only runs once a search transport exists, which on the web
 * means the local helper. Without one these answer as an empty queue, so
 * the badge polling in `App.tsx` stays honest.
 */
const NO_LOOKUPS: LookupStatus = {
  running: false,
  queued: 0,
  done: 0,
  failed: 0,
  pausedReason: null,
  secondsPerSearch: 0
}

/**
 * Points the lookup at the helper, if one is set up. Returns false when
 * there is none, which is how every lookup call decides whether to run.
 */
/** The helper we found, if any. Re-checked whenever a lookup is asked for. */
let helperUrl: string | null = null

function searchIsReady(): boolean {
  if (!helperUrl) return false
  setSearchTransport(helperSearch(helperUrl))
  return true
}

/**
 * Looks for the helper and tells the screens whether to offer the lookup.
 *
 * Run when a database is opened and again whenever somebody asks for a
 * lookup, so starting the helper mid-session is picked up without a reload.
 */
export async function refreshLookupCapability(): Promise<boolean> {
  helperUrl = await detectHelper(getSettings().lookupHelperUrl)
  webApi.capabilities.positionLookup = helperUrl !== null
  return helperUrl !== null
}

function lookupsUnavailable(): never {
  throw new Error(
    'Automatic lookup is not available on this computer. Use the search button to look the person up in a tab instead.'
  )
}

export const webApi = {
  capabilities: { positionLookup: false, usesLocalLookupHelper: true, restoreFromBackup: false } as AppCapabilities,

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
    // Typed in by a person, so no later import replaces it without asking.
    markFieldsManual(
      id,
      Object.keys(fields).filter((f): f is UpdatableField =>
        (UPDATABLE_FIELDS as readonly string[]).includes(f)
      )
    )
    await save()
  },
  deleteStudent: async (id: string) => deleteStudent(id),
  addAttendance: async (studentId: string, eventId: string, extraFields?: Record<string, string>) => {
    addAttendance(studentId, eventId, extraFields ?? {})
  },
  removeAttendance: async (attendanceId: string) => removeAttendance(attendanceId),
  mergeStudents: async (keepId: string, mergeId: string) => mergeStudents(keepId, mergeId),
  findPosition: async (studentId: string, extraTerms?: string): Promise<PositionSearchResult> => {
    if (!searchIsReady() && !(await refreshLookupCapability())) lookupsUnavailable()
    searchIsReady()
    const student = getStudentById(studentId)
    if (!student) throw new Error('Student not found')
    return lookUpPosition(student.firstName, student.lastName, extraTerms, getSettings().institutionNames)
  },

  setLookupHelperUrl: async (url: string | null) => {
    const saved = setLookupHelperUrl(url)
    await refreshLookupCapability()
    await save()
    return saved
  },
  checkLookupHelper: async (url: string) => helperIsRunning(url),
  /** Whether a lookup can be run right now. Checks for the helper afresh. */
  lookupAvailable: async () => refreshLookupCapability(),

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
  getReachOutSuggestions: async () => reachOutSuggestions(),
  getRecentContacts: async () => recentContacts(),
  getEventStudentSets: async () => getEventStudentSets(),
  getAttendanceDates: async () => getAttendanceDates(),
  getFunnelForYear: async (year: number | null) => getFunnelStats(year),

  enqueueLookups: async (studentIds: string[]): Promise<number> => {
    if (!searchIsReady()) return 0
    const queued = enqueueLookups(studentIds)
    await save()
    return queued
  },
  getLookupStatus: async (): Promise<LookupStatus> => (searchIsReady() ? getLookupStatus() : NO_LOOKUPS),
  listLookups: async (): Promise<LookupItem[]> => (searchIsReady() ? listLookups() : []),
  startLookups: async (): Promise<void> => {
    if (searchIsReady()) startLookups()
  },
  stopLookups: async (): Promise<void> => stopLookups(),
  retryFailedLookups: async (): Promise<void> => {
    if (searchIsReady()) retryFailedLookups()
  },
  dismissLookups: async (studentIds: string[]): Promise<void> => {
    dismissLookups(studentIds)
    await save()
  },

  listCertificates: async () => listCertificates(),
  installStarterCertificates: async () => {
    const added = installStarterCertificates()
    await save()
    return added
  },
  getCertificate: async (id: string) => getCertificate(id),
  getCertificateRoster: async (id: string) => certificateRoster(id),
  createCertificate: async (name: string, totalUnits: number | null, notes: string | null) => {
    const id = createCertificate(name, totalUnits, notes)
    await save()
    return id
  },
  updateCertificate: async (id: string, fields: Parameters<typeof updateCertificate>[1]) => {
    updateCertificate(id, fields)
    await save()
  },
  deleteCertificate: async (id: string) => {
    deleteCertificate(id)
    await save()
  },
  addCertificateGroup: async (certificateId: string, input: Parameters<typeof createGroup>[1]) => {
    const id = createGroup(certificateId, input)
    await save()
    return id
  },
  updateCertificateGroup: async (id: string, fields: Parameters<typeof updateGroup>[1]) => {
    updateGroup(id, fields)
    await save()
  },
  deleteCertificateGroup: async (id: string) => {
    deleteGroup(id)
    await save()
  },
  addCertificateRequirement: async (groupId: string, courseCode: string, creditUnits: number) => {
    const id = addRequirement(groupId, courseCode, creditUnits)
    await save()
    return id
  },
  removeCertificateRequirement: async (id: string) => {
    removeRequirement(id)
    await save()
  },
  addCertificateSubstitution: async (
    certificateId: string,
    replacesCode: string,
    acceptedCode: string,
    alsoRequiresCode: string | null
  ) => {
    addSubstitution(certificateId, replacesCode, acceptedCode, alsoRequiresCode)
    await save()
  },
  removeCertificateSubstitution: async (id: string) => {
    removeSubstitution(id)
    await save()
  },

  getStudentCertificates: async (studentId: string) => studentCertificates(studentId),
  setStudentCertificate: async (studentId: string, certificateId: string, declared: boolean) => {
    setStudentCertificate(studentId, certificateId, declared)
    await save()
  },

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

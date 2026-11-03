import { dialog, ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { parseWorkbookForPreview, commitImport, previewImport } from './importer'
import { wipeDatabase } from './db'
import { backupDatabaseTo, getBackupDir, restoreDatabaseFrom } from './db/desktop'
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
} from './db/students'
import {
  deleteEvent,
  getEventDetail,
  listEvents,
  updateEvent
} from './db/events'
import {
  dismissDuplicate,
  getDuplicateById,
  listPossibleDuplicates
} from './db/duplicates'
import { createCategory, deleteCategory, listCategories, updateCategory } from './db/categories'
import { getAttendanceDates, getDashboardStats, getEventStudentSets, getFunnelStats } from './db/dashboard'
import { lookUpPosition } from './positionLookup'
import { getSettings, setInstitutionNames } from './db/settings'
import { markFieldsManual } from './db/fieldSources'
import { UPDATABLE_FIELDS, type UpdatableField } from '../shared/types'
import {
  addRequirement,
  addSubstitution,
  certificateRoster,
  createCertificate,
  createGroup,
  deleteCertificate,
  deleteGroup,
  getCertificate,
  listCertificates,
  removeRequirement,
  removeSubstitution,
  setStudentCertificate,
  studentCertificates,
  updateCertificate,
  updateGroup
} from './db/certificates' 
import {
  dismissLookups,
  enqueueLookups,
  getLookupStatus,
  listLookups,
  retryFailedLookups,
  startLookups,
  stopLookups
} from './lookupQueue'
import type { ImportSheetRequest, NewStudentInput } from '../shared/types'

/** Only the details an import could otherwise overwrite need marking. */
function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose attendance spreadsheets',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('import:preview', (_e, filePath: string) => parseWorkbookForPreview(filePath))
  ipcMain.handle('import:commit', (_e, request: ImportSheetRequest) => commitImport(request))
  ipcMain.handle('import:previewRows', (_e, request: ImportSheetRequest) => previewImport(request))

  ipcMain.handle('students:list', (_e, search?: string) => listStudents(search))
  ipcMain.handle('students:detail', (_e, id: string) => getStudentDetail(id))
  ipcMain.handle('students:create', (_e, input: NewStudentInput) => createStudent(input))
  ipcMain.handle('students:update', (_e, id: string, fields: Parameters<typeof updateStudent>[1]) => {
    updateStudent(id, fields)
    markFieldsManual(id, Object.keys(fields).filter(isUpdatableField))
  })
  ipcMain.handle('students:delete', (_e, id: string) => deleteStudent(id))
  ipcMain.handle(
    'students:addAttendance',
    (_e, studentId: string, eventId: string, extraFields?: Record<string, string>) =>
      addAttendance(studentId, eventId, extraFields ?? {})
  )
  ipcMain.handle('students:removeAttendance', (_e, attendanceId: string) => removeAttendance(attendanceId))
  ipcMain.handle('students:merge', (_e, keepId: string, mergeId: string) => mergeStudents(keepId, mergeId))
  ipcMain.handle('students:findPosition', (_e, studentId: string, extraTerms?: string) => {
    const student = getStudentById(studentId)
    if (!student) throw new Error('Student not found')
    return lookUpPosition(student.firstName, student.lastName, extraTerms, getSettings().institutionNames)
  })

  ipcMain.handle('events:list', () => listEvents())
  ipcMain.handle('events:detail', (_e, id: string) => getEventDetail(id))
  ipcMain.handle('events:update', (_e, id: string, fields: Parameters<typeof updateEvent>[1]) =>
    updateEvent(id, fields)
  )
  ipcMain.handle('events:delete', (_e, id: string) => deleteEvent(id))

  ipcMain.handle('duplicates:list', (_e, status?: 'pending' | 'merged' | 'dismissed') =>
    listPossibleDuplicates(status)
  )
  ipcMain.handle('duplicates:dismiss', (_e, id: string) => dismissDuplicate(id))
  ipcMain.handle('duplicates:merge', (_e, id: string, keepId: string) => {
    const dup = getDuplicateById(id)
    if (!dup) throw new Error('Duplicate suggestion not found')
    const mergeId = keepId === dup.studentA.id ? dup.studentB.id : dup.studentA.id
    // mergeStudents deletes this suggestion along with the merged-away record.
    mergeStudents(keepId, mergeId)
  })

  ipcMain.handle('dashboard:stats', () => getDashboardStats())

  ipcMain.handle('categories:list', () => listCategories())
  ipcMain.handle('categories:create', (_e, name: string, stageOrder: number | null) =>
    createCategory(name, stageOrder)
  )
  ipcMain.handle(
    'categories:update',
    (_e, id: string, fields: Parameters<typeof updateCategory>[1]) => updateCategory(id, fields)
  )
  ipcMain.handle('categories:delete', (_e, id: string) => deleteCategory(id))

  ipcMain.handle('funnel:eventStudentSets', () => getEventStudentSets())
  ipcMain.handle('dashboard:attendanceDates', () => getAttendanceDates())
  ipcMain.handle('dashboard:funnelForYear', (_e, year: number | null) => getFunnelStats(year))

  ipcMain.handle('lookups:enqueue', (_e, studentIds: string[]) => enqueueLookups(studentIds))
  ipcMain.handle('lookups:status', () => getLookupStatus())
  ipcMain.handle('lookups:list', () => listLookups())
  ipcMain.handle('lookups:start', () => startLookups())
  ipcMain.handle('lookups:stop', () => stopLookups())
  ipcMain.handle('lookups:retryFailed', () => retryFailedLookups())
  ipcMain.handle('lookups:dismiss', (_e, studentIds: string[]) => dismissLookups(studentIds))

  ipcMain.handle('certificates:list', () => listCertificates())
  ipcMain.handle('certificates:get', (_e, id: string) => getCertificate(id))
  ipcMain.handle('certificates:roster', (_e, id: string) => certificateRoster(id))
  ipcMain.handle('certificates:create', (_e, name: string, totalUnits: number | null, notes: string | null) =>
    createCertificate(name, totalUnits, notes)
  )
  ipcMain.handle('certificates:update', (_e, id: string, fields: Parameters<typeof updateCertificate>[1]) =>
    updateCertificate(id, fields)
  )
  ipcMain.handle('certificates:delete', (_e, id: string) => deleteCertificate(id))
  ipcMain.handle('certificates:addGroup', (_e, certificateId: string, input: Parameters<typeof createGroup>[1]) =>
    createGroup(certificateId, input)
  )
  ipcMain.handle('certificates:updateGroup', (_e, id: string, fields: Parameters<typeof updateGroup>[1]) =>
    updateGroup(id, fields)
  )
  ipcMain.handle('certificates:deleteGroup', (_e, id: string) => deleteGroup(id))
  ipcMain.handle('certificates:addRequirement', (_e, groupId: string, courseCode: string, creditUnits: number) =>
    addRequirement(groupId, courseCode, creditUnits)
  )
  ipcMain.handle('certificates:removeRequirement', (_e, id: string) => removeRequirement(id))
  ipcMain.handle(
    'certificates:addSubstitution',
    (_e, certificateId: string, replaces: string, accepted: string, alsoRequires: string | null) =>
      addSubstitution(certificateId, replaces, accepted, alsoRequires)
  )
  ipcMain.handle('certificates:removeSubstitution', (_e, id: string) => removeSubstitution(id))

  ipcMain.handle('students:certificates', (_e, studentId: string) => studentCertificates(studentId))
  ipcMain.handle('students:setCertificate', (_e, studentId: string, certificateId: string, declared: boolean) =>
    setStudentCertificate(studentId, certificateId, declared)
  )

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:setInstitutionNames', (_e, names: string[]) => setInstitutionNames(names))

  ipcMain.handle('db:backup', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const defaultName = `trailhead-backup-${new Date().toISOString().slice(0, 10)}.db`
    const options: Electron.SaveDialogOptions = {
      title: 'Back up database',
      defaultPath: defaultName,
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await backupDatabaseTo(result.filePath)
    return path.basename(result.filePath)
  })

  ipcMain.handle('db:restore', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const backupDir = getBackupDir()
    const options: Electron.OpenDialogOptions = {
      title: 'Restore database from backup',
      defaultPath: fs.existsSync(backupDir) ? backupDir : undefined,
      properties: ['openFile'],
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    await restoreDatabaseFrom(result.filePaths[0])
    win?.reload()
    return path.basename(result.filePaths[0])
  })

  ipcMain.handle('db:wipe', async () => {
    const backupDir = getBackupDir()
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safetyPath = path.join(backupDir, `trailhead-before-wipe-${stamp}.db`)
    await backupDatabaseTo(safetyPath)
    wipeDatabase()
    return path.basename(safetyPath)
  })
}

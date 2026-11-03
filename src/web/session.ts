import { initializeDatabase, looksLikeTrailheadDb, setDbDriver } from '../main/db'
import { seedCertificatesIfEmpty } from '../main/db/certificates'
import { setWorkbookReader } from '../main/workbooks'
import { openWebDatabase, type WebDatabase } from './sqljs'
import { browserWorkbookReader, forgetWorkbooks } from './workbooks'
import {
  clearRecoveryCopy,
  DEFAULT_DB_NAME,
  downloadBytes,
  forgetFileHandle,
  rememberFileHandle,
  saveRecoveryCopy,
  writeToHandle,
  type OpenedFile
} from './storage'

/**
 * The open database, and the file it belongs to.
 *
 * This is the piece the desktop app gets from the operating system for free:
 * something that knows where the data lives and writes it back when it
 * changes. On the web we have to run it ourselves, so it lives here — one
 * object the whole app can watch.
 */

/** How long to wait after the last change before writing to disk. */
const SAVE_DEBOUNCE_MS = 1200

export interface SessionState {
  /** Null until a database is open; the gate screen watches for this. */
  fileName: string | null
  /** True when the app can write straight back to the user's file. */
  savesInPlace: boolean
  unsavedChanges: boolean
  saving: boolean
  lastSavedAt: Date | null
  error: string | null
}

type Listener = (state: SessionState) => void

let db: WebDatabase | null = null
let handle: FileSystemFileHandle | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let state: SessionState = {
  fileName: null,
  savesInPlace: false,
  unsavedChanges: false,
  saving: false,
  lastSavedAt: null,
  error: null
}

const listeners = new Set<Listener>()

function publish(changes: Partial<SessionState>): void {
  state = { ...state, ...changes }
  for (const listener of listeners) listener(state)
}

export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function sessionState(): SessionState {
  return state
}

export function currentDatabase(): WebDatabase {
  if (!db) throw new Error('No database is open.')
  return db
}

/** Called by the driver on every write. */
function onDatabaseChanged(): void {
  publish({ unsavedChanges: true })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
}

/**
 * Writes the database out: to the user's own file where the browser allows
 * it, and always to the recovery copy. Saving is best-effort and never
 * interrupts what someone is doing — a failure is surfaced in the status bar,
 * not thrown at the caller.
 */
export async function save(): Promise<void> {
  if (!db || state.saving) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  publish({ saving: true, error: null })
  const bytes = db.export()
  try {
    await saveRecoveryCopy(bytes)
    if (handle) {
      await writeToHandle(handle, bytes)
      publish({ saving: false, unsavedChanges: false, lastSavedAt: new Date() })
    } else {
      // Nowhere to write to; the recovery copy is holding the work until the
      // user downloads the file.
      publish({ saving: false })
    }
  } catch (error) {
    publish({ saving: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Saves the database as a download, for browsers without file handles. */
export function downloadDatabase(fileName = state.fileName ?? DEFAULT_DB_NAME): void {
  if (!db) return
  downloadBytes(fileName, db.export())
  publish({ unsavedChanges: false, lastSavedAt: new Date() })
}

/** Points the session at a different file and writes the database there. */
export async function saveAs(target: FileSystemFileHandle): Promise<void> {
  handle = target
  await rememberFileHandle(target)
  publish({ fileName: target.name, savesInPlace: true })
  await save()
}

async function start(bytes: Uint8Array | undefined, fileName: string, fileHandle: FileSystemFileHandle | null): Promise<void> {
  db?.close()
  forgetWorkbooks()

  const opened = await openWebDatabase(bytes)
  if (bytes && !looksLikeTrailheadDb(opened)) {
    opened.close()
    throw new Error('That file does not look like a Trailhead database.')
  }

  setDbDriver(opened)
  setWorkbookReader(browserWorkbookReader)
  initializeDatabase(opened)
  seedCertificatesIfEmpty()
  opened.watch(onDatabaseChanged)

  db = opened
  handle = fileHandle
  if (fileHandle) await rememberFileHandle(fileHandle)

  publish({
    fileName,
    savesInPlace: fileHandle !== null,
    unsavedChanges: false,
    saving: false,
    lastSavedAt: null,
    error: null
  })
}

/** Opens a database the user picked, dropped, or had open last time. */
export async function openSession(file: OpenedFile): Promise<void> {
  await start(file.bytes, file.name, file.handle)
}

/** Starts an empty database. `target` is null when the browser can't hold a file handle. */
export async function startNewSession(target: FileSystemFileHandle | null): Promise<void> {
  await start(undefined, target?.name ?? DEFAULT_DB_NAME, target)
  await save() // put the empty database on disk straight away
}

/** Reopens a database from the browser's recovery copy after a crash. */
export async function recoverSession(bytes: Uint8Array): Promise<void> {
  await start(bytes, DEFAULT_DB_NAME, null)
  publish({ unsavedChanges: true })
}

/** Closes the database and forgets the file, without touching its contents. */
export async function closeSession(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  db?.close()
  db = null
  handle = null
  setDbDriver(null)
  forgetWorkbooks()
  await forgetFileHandle()
  await clearRecoveryCopy()
  publish({
    fileName: null,
    savesInPlace: false,
    unsavedChanges: false,
    saving: false,
    lastSavedAt: null,
    error: null
  })
}

/**
 * Last line of defence: if someone closes the tab with work that hasn't made
 * it to their file, the browser asks them to confirm.
 */
export function warnBeforeLeaving(): void {
  window.addEventListener('beforeunload', (event) => {
    if (!state.unsavedChanges) return
    event.preventDefault()
    event.returnValue = ''
  })
}

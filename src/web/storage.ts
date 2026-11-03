/**
 * Everything that touches the user's disk or the browser's own storage.
 *
 * Nothing here sends a byte anywhere. The database file is read from, and
 * written back to, a file the user picked themselves; the recovery copy lives
 * in the browser's private storage on their machine. There is no upload
 * because there is nothing to upload to.
 */

const DB_PICKER_TYPES: FilePickerAcceptType[] = [
  { description: 'Trailhead database', accept: { 'application/x-sqlite3': ['.db'] } }
]

export const DEFAULT_DB_NAME = 'trailhead.db'

/** True in Edge and Chrome: the app can save back to the file people opened. */
export function supportsFileHandles(): boolean {
  return typeof window.showOpenFilePicker === 'function'
}

export interface OpenedFile {
  name: string
  bytes: Uint8Array
  /** Null in browsers without file handles — saving falls back to a download. */
  handle: FileSystemFileHandle | null
}

/** Asks for read/write on a handle, prompting the user only if needed. */
async function ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
  const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  if ((await handle.queryPermission?.(options)) === 'granted') return true
  return (await handle.requestPermission?.(options)) === 'granted'
}

async function readHandle(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile()
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle }
}

/**
 * Opens an existing database. Returns null if the user cancelled the picker.
 */
export async function pickDatabaseFile(): Promise<OpenedFile | null> {
  if (supportsFileHandles()) {
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker!({
        types: DB_PICKER_TYPES,
        multiple: false,
        id: 'trailhead-db'
      })
    } catch {
      return null // the user dismissed the picker
    }
    const handle = handles[0]
    if (!handle) return null
    await ensureWritable(handle)
    return readHandle(handle)
  }

  const file = await pickFileWithInput('.db,application/x-sqlite3')
  if (!file) return null
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null }
}

/** Reads a file the user dragged onto the page. */
export async function readDroppedDatabase(file: File): Promise<OpenedFile> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null }
}

/**
 * Chooses where a brand-new database should live, so that a first-time user
 * is saving to a real file from their very first import rather than
 * accumulating work in a tab they might close.
 */
export async function createDatabaseFile(): Promise<FileSystemFileHandle | null> {
  if (!supportsFileHandles()) return null
  try {
    const handle = await window.showSaveFilePicker!({
      types: DB_PICKER_TYPES,
      suggestedName: DEFAULT_DB_NAME,
      id: 'trailhead-db'
    })
    return (await ensureWritable(handle)) ? handle : null
  } catch {
    return null
  }
}

/** Writes the database back to the file it came from. */
export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  if (!(await ensureWritable(handle))) {
    throw new Error('Trailhead no longer has permission to write to that file.')
  }
  const writable = await handle.createWritable()
  try {
    await writable.write(bytes as unknown as BufferSource)
  } finally {
    await writable.close()
  }
}

/** Hands the database to the browser as a download. The fallback save path. */
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/x-sqlite3' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Opens a file chooser without the File System Access API. */
export function pickFileWithInput(accept: string, multiple = false): Promise<File | null> {
  return pickFilesWithInput(accept, multiple).then((files) => files[0] ?? null)
}

export function pickFilesWithInput(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)

    // A cancelled picker fires no 'change' event in most browsers, so the
    // promise is also settled when focus comes back to the page.
    let settled = false
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(Array.from(input.files ?? [])), 500),
      { once: true }
    )
    input.click()
  })
}

/* ------------------------------------------------------------------ *
 * Recovery copy (OPFS)
 *
 * A private, per-origin corner of the browser's storage on this machine.
 * Written after every change so that a crashed tab, a closed window or a
 * browser without file handles never costs someone their afternoon.
 * ------------------------------------------------------------------ */

const RECOVERY_FILE = 'trailhead-recovery.db'

async function recoveryDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage?.getDirectory()
  } catch {
    return null // private windows and blocked site data land here
  }
}

export async function saveRecoveryCopy(bytes: Uint8Array): Promise<void> {
  const dir = await recoveryDir()
  if (!dir) return
  try {
    const handle = await dir.getFileHandle(RECOVERY_FILE, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(bytes as unknown as BufferSource)
    } finally {
      await writable.close()
    }
  } catch {
    // Storage full or unavailable: the real file is still the source of truth.
  }
}

export async function loadRecoveryCopy(): Promise<Uint8Array | null> {
  const dir = await recoveryDir()
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(RECOVERY_FILE)
    const file = await handle.getFile()
    if (file.size === 0) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

export async function clearRecoveryCopy(): Promise<void> {
  const dir = await recoveryDir()
  if (!dir) return
  try {
    await dir.removeEntry(RECOVERY_FILE)
  } catch {
    // Nothing to clear.
  }
}

/* ------------------------------------------------------------------ *
 * Remembering the file across visits
 *
 * File handles survive a reload if they're kept in IndexedDB, so someone who
 * opened `trailhead.db` yesterday is offered it again today instead of
 * hunting through their folders. The browser still asks them to confirm
 * access — we can't grant ourselves permission.
 * ------------------------------------------------------------------ */

const HANDLE_DB = 'trailhead-handles'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'database'

function withHandleStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(HANDLE_DB, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE)
    request.onerror = () => resolve(null)
    request.onsuccess = () => {
      const db = request.result
      try {
        const operation = run(db.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE))
        operation.onsuccess = () => {
          resolve(operation.result ?? null)
          db.close()
        }
        operation.onerror = () => {
          resolve(null)
          db.close()
        }
      } catch {
        resolve(null)
        db.close()
      }
    }
  })
}

export async function rememberFileHandle(handle: FileSystemFileHandle): Promise<void> {
  await withHandleStore('readwrite', (store) => store.put(handle, HANDLE_KEY) as IDBRequest<unknown>)
}

export async function forgetFileHandle(): Promise<void> {
  await withHandleStore('readwrite', (store) => store.delete(HANDLE_KEY) as IDBRequest<unknown>)
}

/** The file opened last time, if the browser will still let us read it. */
export async function recallFileHandle(): Promise<FileSystemFileHandle | null> {
  const handle = await withHandleStore<FileSystemFileHandle>(
    'readonly',
    (store) => store.get(HANDLE_KEY) as IDBRequest<FileSystemFileHandle>
  )
  if (!handle) return null
  const granted = await handle.queryPermission?.({ mode: 'readwrite' })
  return granted === 'granted' || granted === 'prompt' ? handle : null
}

export async function reopenRememberedFile(handle: FileSystemFileHandle): Promise<OpenedFile | null> {
  if (!(await ensureWritable(handle))) return null
  try {
    return await readHandle(handle)
  } catch {
    return null // moved, renamed or deleted since last time
  }
}

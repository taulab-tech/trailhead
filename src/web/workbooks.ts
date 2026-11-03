import * as XLSX from 'xlsx'
import type { WorkbookReader } from '../main/workbooks'

/**
 * Spreadsheets the user has picked or dropped, held in memory for as long as
 * the import screen needs them.
 *
 * The desktop app passes file paths around and reads from disk whenever it
 * needs a sheet again. A browser has no paths, so each file gets an opaque
 * reference instead — which is all the renderer ever treated `filePath` as.
 *
 * Reading a file in a browser is asynchronous but the importer is not, so
 * `loadWorkbook` is called by the API layer before it hands a reference down.
 */

const files = new Map<string, File>()
const parsed = new Map<string, XLSX.WorkBook>()
let nextRef = 0

/** Takes a file and returns the reference the rest of the app will use. */
export function registerFile(file: File): string {
  // The counter keeps two files of the same name apart.
  const ref = `file-${++nextRef}:${file.name}`
  files.set(ref, file)
  return ref
}

/** Parses the workbook behind `ref` so the importer can read it synchronously. */
export async function loadWorkbook(ref: string): Promise<void> {
  if (parsed.has(ref)) return
  const file = files.get(ref)
  if (!file) throw new Error('That spreadsheet is no longer open. Add it again to import it.')
  const buffer = await file.arrayBuffer()
  parsed.set(ref, XLSX.read(buffer, { type: 'array', cellDates: false }))
}

export const browserWorkbookReader: WorkbookReader = {
  read: (ref) => {
    const book = parsed.get(ref)
    if (!book) throw new Error('That spreadsheet is no longer open. Add it again to import it.')
    return book
  },
  baseName: (ref) => files.get(ref)?.name ?? ref
}

/** Drops every held spreadsheet — on closing a database, or opening another. */
export function forgetWorkbooks(): void {
  files.clear()
  parsed.clear()
}

import * as XLSX from 'xlsx'

/**
 * How the importer gets at a spreadsheet. The desktop build reads the file
 * off disk by path; the web build never has a path, so it keeps the picked
 * files in memory and hands back a reference instead. Either way the rest of
 * the importer only ever sees an opaque string, which is also all the
 * renderer passes around.
 */
export interface WorkbookReader {
  /** Parses the workbook `ref` points at. */
  read(ref: string): XLSX.WorkBook
  /** The file's display name, e.g. "2026 Mining Hackathon.xlsx". */
  baseName(ref: string): string
}

let reader: WorkbookReader | null = null

export function setWorkbookReader(next: WorkbookReader | null): void {
  reader = next
}

function active(): WorkbookReader {
  if (!reader) throw new Error('No workbook reader is configured.')
  return reader
}

export function readWorkbook(ref: string): XLSX.WorkBook {
  return active().read(ref)
}

export function workbookBaseName(ref: string): string {
  return active().baseName(ref)
}

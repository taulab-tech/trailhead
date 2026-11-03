import path from 'path'
import * as XLSX from 'xlsx'
import type { WorkbookReader } from './workbooks'

/** Reads spreadsheets straight off disk, by path. Desktop build only. */
export const desktopWorkbookReader: WorkbookReader = {
  read: (ref) => XLSX.readFile(ref, { cellDates: false }),
  baseName: (ref) => path.basename(ref)
}

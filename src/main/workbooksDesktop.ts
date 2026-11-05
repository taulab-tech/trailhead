import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import type { WorkbookReader } from './workbooks'
import { readWorkbookBytes } from './repackWorkbook'

/** Reads spreadsheets straight off disk, by path. Desktop build only. */
export const desktopWorkbookReader: WorkbookReader = {
  // A .csv is not a zip and XLSX.readFile handles the encoding sniffing,
  // so only spreadsheets go the bytes route, where repacking can help.
  read: (ref) =>
    /\.xlsx?$/i.test(ref)
      ? readWorkbookBytes(new Uint8Array(fs.readFileSync(ref)))
      : XLSX.readFile(ref, { cellDates: false }),
  baseName: (ref) => path.basename(ref)
}

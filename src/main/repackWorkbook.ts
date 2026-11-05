import { unzipSync, zipSync } from 'fflate'
import * as XLSX from 'xlsx'

/**
 * Rescuing an .xlsx that the spreadsheet reader refuses to open.
 *
 * An .xlsx is a zip. Some writers — SurveyMonkey's export among them —
 * stream the entries out, leaving the sizes in each local header set to a
 * placeholder and putting the real ones in a descriptor after the data.
 * The zip is perfectly valid and its central directory is correct; our
 * reader believes the local headers instead and falls over, in more than
 * one way: sometimes "Bad compressed size", sometimes an attempt to
 * allocate four gigabytes from a placeholder it read as a length.
 *
 * The file is not broken and there is nothing for anybody to fix, so
 * telling somebody to re-save it in Excel would be handing them our
 * problem. Instead the entries are read the way the zip specification says
 * to — through the central directory — and written back out as an ordinary
 * zip, which the reader then opens happily. The spreadsheet's contents are
 * not touched.
 */

/** True if these bytes begin with a local zip header, as every .xlsx does. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** Reads the zip by its central directory and writes it out again. */
export function repackZip(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes)
  if (Object.keys(entries).length === 0) throw new Error('There is nothing in this file.')
  // Level 0: it is read once, immediately, and then thrown away.
  return zipSync(entries, { level: 0 })
}

/**
 * Reads a spreadsheet from bytes, repacking it if the first attempt fails.
 *
 * The retry is tried for anything zip-shaped rather than for particular
 * error messages, because the same cause surfaces as several different
 * errors. If the repacked copy fails too, the first error is what gets
 * raised: it describes the file the user actually chose.
 */
export function readWorkbookBytes(bytes: Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, { type: 'array', cellDates: false })
  } catch (error) {
    if (!isZip(bytes)) throw error
    try {
      return XLSX.read(repackZip(bytes), { type: 'array', cellDates: false })
    } catch {
      throw error
    }
  }
}

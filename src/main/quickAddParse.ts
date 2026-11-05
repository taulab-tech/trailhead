import { normalizeEmail, normalizePhone } from './normalize'

/**
 * Reading a list of people out of whatever somebody typed at an event.
 *
 * This is not an import. Nobody standing at a table with a laptop is going
 * to build a spreadsheet; they are going to type names, and a few of those
 * lines will have an email or a note stuck on the end. So the rule is to
 * take every line as a person and never reject one for being untidy — a
 * line we cannot read is handed back as a line to fix, not dropped.
 *
 * Nothing here touches the database, so every shape of line a real person
 * might type can be tested as plain text.
 */

/** One line of the pasted text, read as far as it can be. */
export interface ParsedLine {
  /** The line as typed, so the screen can show what it is talking about. */
  raw: string
  firstName: string
  lastName: string
  emails: string[]
  phones: string[]
  /** What was said about them — "wants to join the capstone team". */
  note: string | null
  /**
   * True when the line wrote "Okonkwo, Amara", which states which half is
   * the surname instead of leaving it to the order words happen to be in.
   */
  nameOrderConfirmed: boolean
  /** Set when the line could not be read as a person at all. */
  problem: string | null
}

/** Bullets, numbering and dashes people start a list line with. */
const LEADING_MARKS = /^\s*(?:[-*•·–—]|\d+[.)])\s+/

/** What separates a name from a note: a dash, a colon, a pipe, a tab. */
const NOTE_SEPARATOR = /\s+[-–—|:]\s+|\t+/

const EMAIL = /[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/g

/** A run of digits long enough to be a phone number, with the usual noise. */
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g

/** Words that are part of a surname rather than a separate name. */
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'da', 'di', 'du', 'la', 'le', 'bin', 'binte', 'al', 'st', 'ter', 'ten'])

function titleCaseWord(word: string): string {
  if (!word) return word
  // Leave anything already mixed-case alone: "McGrath" and "O'Neill" are
  // right as typed, and "correcting" them makes the app look broken.
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) return word
  return word[0].toUpperCase() + word.slice(1).toLowerCase()
}

function tidyName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split('-').map(titleCaseWord).join('-'))
    .join(' ')
}

/**
 * Splits a name with no comma in it.
 *
 * The first word is the given name and the rest is the surname, which is
 * the convention every signup sheet uses. Particles are kept with the
 * surname, so "amara van der berg" does not end up with a surname of
 * "der berg" and a first name of "amara van".
 */
function splitPlainName(text: string): { firstName: string; lastName: string } {
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }

  let cut = 1
  while (cut < parts.length - 1 && NAME_PARTICLES.has(parts[cut].toLowerCase().replace(/\.$/, ''))) {
    cut++
  }
  // A particle only belongs to the surname if something follows it.
  while (cut > 1 && !NAME_PARTICLES.has(parts[cut - 1].toLowerCase().replace(/\.$/, ''))) cut--
  return { firstName: parts.slice(0, cut).join(' '), lastName: parts.slice(cut).join(' ') }
}

/** True for a fragment that is a name rather than a detail about somebody. */
function looksLikeName(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes('@')) return false
  if (/\d/.test(trimmed)) return false
  return /^[\p{L}][\p{L}\s'.-]*$/u.test(trimmed)
}

/**
 * Reads one line. Returns a person with `problem` set when the line holds
 * no name at all — an email on its own, say, or a stray bit of punctuation.
 */
export function parseLine(raw: string): ParsedLine {
  const base: ParsedLine = {
    raw,
    firstName: '',
    lastName: '',
    emails: [],
    phones: [],
    note: null,
    nameOrderConfirmed: false,
    problem: null
  }

  const line = raw.replace(LEADING_MARKS, '').trim()
  if (!line) return { ...base, problem: 'Blank line' }

  // The note comes off first, so a dash inside it can't be mistaken for the
  // separator and a name can't be found inside it.
  const separatorMatch = NOTE_SEPARATOR.exec(line)
  let head = line
  let note: string | null = null
  if (separatorMatch && separatorMatch.index > 0) {
    head = line.slice(0, separatorMatch.index).trim()
    note = line.slice(separatorMatch.index + separatorMatch[0].length).trim() || null
  }

  // Contact details can sit either side of the separator.
  const emails: string[] = []
  const phones: string[] = []
  const harvest = (text: string): string => {
    let rest = text.replace(EMAIL, (match) => {
      const email = normalizeEmail(match)
      if (email) emails.push(email)
      return ' '
    })
    rest = rest.replace(PHONE, (match) => {
      const phone = normalizePhone(match)
      if (phone) phones.push(phone)
      return ' '
    })
    return rest
  }

  let nameText = harvest(head).replace(/[,;]\s*$/, '').trim()
  if (note) note = harvest(note).trim() || null

  // If the name was only in the note's half — "amara@x.com - Amara Okonkwo"
  // — take the name from there rather than reporting no name at all.
  if (!nameText && note && looksLikeName(note)) {
    nameText = note
    note = null
  }

  if (!nameText) {
    return {
      ...base,
      emails,
      phones,
      note,
      problem: emails.length > 0 ? 'No name on this line, only contact details' : 'No name on this line'
    }
  }

  // A comma can mean "Okonkwo, Amara" or it can be separating a name from
  // something else. It is only a surname-first marker when both halves read
  // as names.
  let firstName: string
  let lastName: string
  let nameOrderConfirmed = false
  const comma = nameText.indexOf(',')
  if (comma > 0) {
    const before = nameText.slice(0, comma).trim()
    const after = nameText.slice(comma + 1).trim()
    if (looksLikeName(before) && looksLikeName(after)) {
      lastName = before
      firstName = after
      nameOrderConfirmed = true
    } else {
      const split = splitPlainName(before)
      firstName = split.firstName
      lastName = split.lastName
      if (after && !note) note = after
    }
  } else {
    const split = splitPlainName(nameText)
    firstName = split.firstName
    lastName = split.lastName
  }

  return {
    raw,
    firstName: tidyName(firstName),
    lastName: tidyName(lastName),
    emails,
    phones,
    note,
    nameOrderConfirmed,
    problem: null
  }
}

/**
 * Reads a whole pasted block.
 *
 * Lines are people. A header line a spreadsheet copy-paste brings along
 * ("Name  Email") is dropped, because adding a student called "Name Email"
 * is never what anybody meant.
 */
export function parsePastedPeople(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .filter((line) => !isHeaderLine(line))
    .map(parseLine)
}

const HEADER_WORDS = ['name', 'email', 'first', 'last', 'nsid', 'phone', 'student', 'note', 'notes', 'id']

/** True for a line that is a spreadsheet's column headings rather than a person. */
function isHeaderLine(line: string): boolean {
  const words = line
    .toLowerCase()
    .split(/[\s,;|\t]+/)
    .filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  return words.every((w) => HEADER_WORDS.includes(w))
}

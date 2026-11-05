import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseLine, parsePastedPeople } from '../src/main/quickAddParse'

const name = (line: string): string => {
  const p = parseLine(line)
  return `${p.firstName}|${p.lastName}`
}

/* ------------------------------ plain names ----------------------------- */

test('a plain name splits into first and last', () => {
  assert.equal(name('Amara Okonkwo'), 'Amara|Okonkwo')
})

test('a middle name belongs to the surname side, not the first', () => {
  assert.equal(name('Amara Rose Okonkwo'), 'Amara|Rose Okonkwo')
})

test('one word is a first name with no surname', () => {
  assert.equal(name('Amara'), 'Amara|')
})

test('capitalisation is tidied, but not where somebody meant it', () => {
  assert.equal(name('amara okonkwo'), 'Amara|Okonkwo')
  assert.equal(name('AMARA OKONKWO'), 'Amara|Okonkwo')
  assert.equal(name('Rosa McGrath'), 'Rosa|McGrath')
  assert.equal(name("Sean O'Neill"), "Sean|O'Neill")
  assert.equal(name('Anne-Marie Dubois'), 'Anne-Marie|Dubois')
})

test('a surname particle stays with the surname', () => {
  assert.equal(name('Amara van der Berg'), 'Amara|van der Berg')
  assert.equal(name('Rosa de Silva'), 'Rosa|de Silva')
})

/* -------------------------------- commas -------------------------------- */

test('"Okonkwo, Amara" is read as surname first, and said to be certain', () => {
  const p = parseLine('Okonkwo, Amara')
  assert.equal(p.firstName, 'Amara')
  assert.equal(p.lastName, 'Okonkwo')
  assert.equal(p.nameOrderConfirmed, true)
})

test('a comma before an email is not a surname marker', () => {
  const p = parseLine('Amara Okonkwo, amara@example.com')
  assert.equal(p.firstName, 'Amara')
  assert.equal(p.lastName, 'Okonkwo')
  assert.equal(p.nameOrderConfirmed, false)
  assert.deepEqual(p.emails, ['amara@example.com'])
})

/* ------------------------- emails, phones, notes ------------------------ */

test('an email anywhere on the line is picked up', () => {
  assert.deepEqual(parseLine('Amara Okonkwo amara@example.com').emails, ['amara@example.com'])
  assert.deepEqual(parseLine('amara@example.com Amara Okonkwo').emails, ['amara@example.com'])
})

test('a note after a dash is kept and left out of the name', () => {
  const p = parseLine('Amara Okonkwo - wants to join a capstone team')
  assert.equal(p.firstName, 'Amara')
  assert.equal(p.lastName, 'Okonkwo')
  assert.equal(p.note, 'wants to join a capstone team')
})

test('an em dash, a colon and a tab separate a note just as well', () => {
  assert.equal(parseLine('Amara Okonkwo — keen on hardware').note, 'keen on hardware')
  assert.equal(parseLine('Amara Okonkwo : keen on hardware').note, 'keen on hardware')
  assert.equal(parseLine('Amara Okonkwo\tkeen on hardware').note, 'keen on hardware')
})

test('a hyphenated surname is not mistaken for a note', () => {
  const p = parseLine('Amara Okonkwo-Hollis')
  assert.equal(p.lastName, 'Okonkwo-Hollis')
  assert.equal(p.note, null)
})

test('everything at once comes apart correctly', () => {
  const p = parseLine('- Amara Okonkwo, amara@example.com, 306-555-0142 — asked about the certificate')
  assert.equal(p.firstName, 'Amara')
  assert.equal(p.lastName, 'Okonkwo')
  assert.deepEqual(p.emails, ['amara@example.com'])
  assert.equal(p.phones.length, 1)
  assert.equal(p.note, 'asked about the certificate')
  assert.equal(p.problem, null)
})

test('bullets and numbering are stripped', () => {
  for (const prefix of ['- ', '* ', '• ', '1. ', '12) ']) {
    assert.equal(name(`${prefix}Amara Okonkwo`), 'Amara|Okonkwo', `with "${prefix}"`)
  }
})

/* ------------------------------- bad lines ------------------------------ */

test('a line with no name is handed back, not silently dropped', () => {
  const p = parseLine('amara@example.com')
  assert.equal(p.problem, 'No name on this line, only contact details')
  assert.deepEqual(p.emails, ['amara@example.com'])
})

test('a name on the far side of the separator is still found', () => {
  const p = parseLine('amara@example.com - Amara Okonkwo')
  assert.equal(p.firstName, 'Amara')
  assert.equal(p.lastName, 'Okonkwo')
  assert.deepEqual(p.emails, ['amara@example.com'])
})

test('punctuation on its own is a problem line', () => {
  assert.ok(parseLine('---').problem)
})

/* ------------------------------ whole blocks ---------------------------- */

test('blank lines are skipped and the rest keep their order', () => {
  const people = parsePastedPeople('Amara Okonkwo\n\n  \nBence Lindqvist\n')
  assert.deepEqual(
    people.map((p) => p.lastName),
    ['Okonkwo', 'Lindqvist']
  )
})

test('a pasted header row is not added as a person', () => {
  const people = parsePastedPeople('First Name\tLast Name\tEmail\nAmara\tOkonkwo\tamara@example.com')
  assert.equal(people.length, 1)
  assert.equal(people[0].firstName, 'Amara')
})

test('a real person is never mistaken for a header', () => {
  // "Student" and "Name" are header words; a person called neither is safe,
  // and a line with a note is far too long to be a heading.
  const people = parsePastedPeople('Amara Okonkwo - student rep')
  assert.equal(people.length, 1)
  assert.equal(people[0].firstName, 'Amara')
})

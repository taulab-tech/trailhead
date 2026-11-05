/**
 * Builds a throwaway database of invented people, so the dashboard can be
 * looked at while it is being worked on. Never run against real data and
 * never committed — the output is a .db, which .gitignore already blocks.
 */
import fs from 'fs'
import path from 'path'

const out = process.argv[2]
if (!out) throw new Error('usage: make-fixture <path to .db>')
fs.rmSync(out, { force: true })
process.env.TRAILHEAD_DB_PATH = out

import { openDb } from '../src/main/db/desktop'
import { installStarterCertificates } from '../src/main/db/certificates'
import { addAttendance, createStudent } from '../src/main/db/students'
import { findOrCreateEvent } from '../src/main/db/events'
import { recordStudentCourse } from '../src/main/db/courses'
import { createCategory } from '../src/main/db/categories'

openDb()
installStarterCertificates()

const workshops = createCategory('Workshops', 1).id
const programs = createCategory('Programs', 2).id

const FIRST = ['Amara', 'Bence', 'Chidi', 'Dagny', 'Eero', 'Farida', 'Goran', 'Hana', 'Idris', 'Juno',
  'Kiran', 'Lotta', 'Mikkel', 'Nadia', 'Oren', 'Pilar', 'Quill', 'Rosa', 'Sven', 'Tamsin',
  'Ulla', 'Viktor', 'Wren', 'Xiulan', 'Yusuf', 'Zofia']
const LAST = ['Aldridge', 'Barrow', 'Castellan', 'Draycott', 'Ellery', 'Fenwick', 'Garrow', 'Hollis',
  'Ingleby', 'Jarrow', 'Kesterly', 'Lindqvist', 'Marchetti', 'Navarrete', 'Oakhurst', 'Pemberly',
  'Quintrell', 'Rossiter', 'Standish', 'Thorne', 'Urquhart', 'Vasquez', 'Wilde', 'Yarrow', 'Zendeli']

const CERT_COURSES = ['GE 348', 'GE 431', 'GE 450', 'GE 451', 'GE 490', 'GE 495']
const DISCIPLINES = ['Mechanical', 'Electrical', 'Civil', 'Chemical', 'Computer', 'Environmental']

const EVENTS: [string, string, string][] = [
  ['Intro to Prototyping', '2026-09-18', workshops],
  ['Pitch Night', '2026-10-02', programs],
  ['Design Sprint', '2026-10-21', workshops],
  ['Founders Breakfast', '2026-10-29', programs],
  ['Demo Day', '2026-11-01', programs],
  ['Customer Discovery', '2026-06-11', workshops],
  ['Spring Showcase', '2026-04-08', programs],
  ['Hardware Lab', '2025-11-12', workshops],
  ['Startup Weekend', '2025-03-07', programs],
  ['Idea Jam', '2024-10-15', workshops]
]
const eventIds = EVENTS.map(([name, date, category]) => findOrCreateEvent(name, date, null, null, category))

// A spread that exercises every rule: some nearly finished, some in their
// last year, some who came once in 2024 and never again.
let n = 0
for (const last of LAST) {
  for (const first of FIRST.slice(0, 3)) {
    n++
    const id = createStudent({
      firstName: first,
      lastName: last,
      nsid: `zz${String(100 + n).padStart(4, '0')}`,
      college: 'Engineering',
      discipline: DISCIPLINES[n % DISCIPLINES.length],
      yearInProgram: ['1st year', '2nd year', '3rd year', '4th year'][n % 4]
    })

    // Courses: every fourth student is close to finishing something.
    const howMany = n % 4 === 0 ? 5 : n % 3 === 0 ? 3 : n % 5 === 0 ? 1 : 0
    for (const code of CERT_COURSES.slice(0, howMany)) {
      recordStudentCourse({
        studentId: id,
        courseCode: code,
        term: ['202409', '202501', '202509'][n % 3],
        status: 'completed'
      })
    }

    // Attendance: recent for most, long ago for a tail of them.
    const span = n % 7 === 0 ? eventIds.slice(7) : eventIds.slice(0, 1 + (n % 5))
    for (const eventId of span) addAttendance(id, eventId, {})
  }
}

console.log(`fixture written: ${path.resolve(out)} — ${n} invented students`)

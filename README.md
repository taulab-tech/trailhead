# Trailhead

Attendance and student-pathway tracking for programs and events.

A local, offline desktop app for tracking student attendance across programs and events.
Drag in event/attendance spreadsheets, and it builds a master student list — automatically
linking repeat students across events, with a manual review screen for anything the automatic
matching couldn't confidently resolve.

No AI. Everything (including the database) lives on your computer. The one exception is the
optional **Position** lookup on a student, which searches the web for that student's name — only
when you click it.

## What it does

- **Import**: drag in `.xlsx`/`.xls`/`.csv` files. Every sheet becomes one event/program roster.
  You can rename the event, set a date, and review/adjust which spreadsheet column maps to
  which field before importing.
- **Matching**: students are linked across events using, in order of confidence: student ID
  match (an ID written as an email, like `abc123@school.edu`, also matches bare `abc123` when
  the names agree), email match, then an exact normalized name match — but only when exactly one
  existing student has that name and their student IDs don't conflict. Anything less certain (e.g.
  "Chris Elash" vs "Christopher Elash", or two existing students with the same name) is left
  alone and flagged on the **Duplicates** screen for you to merge or dismiss by hand. Students
  with two different student IDs are never linked or flagged, since an ID belongs to one person.
- **Students**: searchable master list with every student's contact info, program/college info,
  and full event history. Edit any field, manually add/remove an event, or manually merge two
  records the matching missed.
- **Position lookup**: in a student's panel, *Look up on LinkedIn* searches DuckDuckGo for
  `"First Last" site:linkedin.com/in` and lists the matching profiles (headline, experience,
  education, location). Pick the right person with *This is them* to save their position and
  profile link — nothing is saved automatically, since names are often shared. Searches run one
  at a time, a few seconds apart, and only on click. The Windows installer includes its own
  Python with `ddgs`; when running from source it uses your Python (`pip install ddgs`).
- **LinkedIn matches**: after an import, *Find LinkedIn matches* looks up the new students in
  the background — one search every 8 seconds, pausing itself if the search engine starts
  refusing. Results wait on the *LinkedIn matches* page: strong matches (exactly one profile
  that mentions your institution, set in **Settings**) are pre-ticked with title and
  organisation filled in; the rest are yours to pick or skip. Nothing is saved until you
  press *Save*.
- **Programs & Events**: every imported roster, with attendee lists and the ability to rename,
  re-date, or delete an accidentally-imported sheet.
- **The Trail**: drag-and-drop the groups (Hackathon, Class, Program, …) into the order students
  move through them, and drag events between groups. A new database starts with an empty trail.
- **Dashboard**: aggregate stats — unique students, repeat-attendance rate, breakdowns by
  college/discipline/year, and top programs by attendance.

## Running it

Requires [Node.js](https://nodejs.org) 20+. The optional position lookup also needs Python 3 with
`pip install ddgs` when running from source.

```bash
npm install
npm run dev
```

This opens the app in a window. Your data is stored in a local SQLite file in your OS user-data
folder (on Windows: `%APPDATA%\Trailhead\trailhead.db`) — it persists
between runs automatically.

## Tests

```bash
npm test
```

Runs the database, matching, and import tests in `tests/` against a throwaway SQLite file
(never your real data). They run under Electron's bundled Node, since that's what the
SQLite driver is compiled for.

## Building an installer

```bash
npm run dist:win    # Windows installer (.exe)
npm run dist:mac    # macOS (.dmg)
npm run dist:linux  # Linux (AppImage)
```

`dist:win` also prepares a private Python with `ddgs` for the installer (`scripts/bundle-python.cjs`),
which needs Python with pip on the build machine the first time.

Output lands in `dist/`. Run the matching `dist:*` script on the OS you want to build for.

## Project layout

- `src/main` — Electron main process: SQLite schema/queries (`db/`), spreadsheet parsing
  (`importer.ts`), and the deterministic student-matching engine (`matching.ts`).
- `src/preload` — the narrow, typed bridge exposed to the renderer as `window.api`.
- `src/renderer` — the React UI.
- `src/shared` — types shared between main and renderer.
- `tests` — automated tests (`npm test`).

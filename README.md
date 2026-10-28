# SIGMA Attendance Tracker

A local, offline desktop app for tracking student attendance across SIGMA programs and events.
Drag in event/attendance spreadsheets, and it builds a master student list — automatically
linking repeat students across events, with a manual review screen for anything the automatic
matching couldn't confidently resolve.

No AI, no network calls. Everything (including the database) lives on your computer.

## What it does

- **Import**: drag in `.xlsx`/`.xls`/`.csv` files. Every sheet becomes one event/program roster.
  You can rename the event, set a date, and review/adjust which spreadsheet column maps to
  which field before importing.
- **Matching**: students are linked across events using, in order of confidence: student ID
  (NSID) match, email match, then an exact normalized name match — but only when exactly one
  existing student has that name and their NSIDs don't conflict. Anything less certain (e.g.
  "Chris Elash" vs "Christopher Elash", or two existing students with the same name) is left
  alone and flagged on the **Duplicates** screen for you to merge or dismiss by hand. Students
  with two different NSIDs are never linked or flagged, since an NSID belongs to one person.
- **Students**: searchable master list with every student's contact info, program/college info,
  and full event history. Edit any field, manually add/remove an event, or manually merge two
  records the matching missed.
- **Programs & Events**: every imported roster, with attendee lists and the ability to rename,
  re-date, or delete an accidentally-imported sheet.
- **Dashboard**: aggregate stats — unique students, repeat-attendance rate, breakdowns by
  college/discipline/year, and top programs by attendance.

## Running it

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm run dev
```

This opens the app in a window. Your data is stored in a local SQLite file in your OS user-data
folder (on Windows: `%APPDATA%\sigma-attendance-tracker\sigma-attendance.db`) — it persists
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

Output lands in `dist/`. Run the matching `dist:*` script on the OS you want to build for.

## Project layout

- `src/main` — Electron main process: SQLite schema/queries (`db/`), spreadsheet parsing
  (`importer.ts`), and the deterministic student-matching engine (`matching.ts`).
- `src/preload` — the narrow, typed bridge exposed to the renderer as `window.api`.
- `src/renderer` — the React UI.
- `src/shared` — types shared between main and renderer.
- `tests` — automated tests (`npm test`).

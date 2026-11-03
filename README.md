# Trailhead

Attendance and student-pathway tracking for programs and events.

A local, offline app for tracking student attendance across programs and events. It runs
two ways from one codebase: as a desktop app, and as a website (see **In a browser** below)
for machines where installing software isn't allowed.
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
  alone and flagged under **Settings → Possible duplicates** for you to merge or dismiss by hand. Students
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
  refusing. Results wait under *Students → LinkedIn matches*: strong matches (exactly one profile
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

`npm run dev` reloads the screens instantly and restarts the app when background (main-process)
code changes.

This opens the app in a window. Your data is stored in a local SQLite file in your OS user-data
folder (on Windows: `%APPDATA%\Trailhead\trailhead.db`) — it persists
between runs automatically.

## In a browser

The same app, built as a static site. Nothing is installed, and nothing is uploaded: the
database is a file on the user's own computer that the page opens, reads and writes directly.

```bash
npm run dev:web      # http://localhost:5174
npm run build:web    # static files in dist-web/
npm run preview:web  # serve the built files
```

On Edge and Chrome the File System Access API lets the page save straight back to the
`trailhead.db` the user picked, so it behaves like the desktop app; the file it opened last is
offered again next visit. Firefox and Safari have no such API, so there the database is held in
the browser and downloaded when the user is done. Either way a recovery copy is written to the
browser's private storage after every change, so a closed tab costs nothing.

It is the same `trailhead.db` either way — a file moves between the desktop and web builds
untouched.

**What's missing:** the LinkedIn position lookup. It scrapes a search engine through a bundled
Python, which a web page can't do, and proxying it would put student names on someone else's
server. The screens check `window.api.capabilities` and hide it rather than failing on click;
positions can still be typed in by hand, and the desktop build is unchanged.

**Deploying.** Pushing to `master` publishes to GitHub Pages via
`.github/workflows/deploy-web.yml`. For a custom domain, set a `CUSTOM_DOMAIN` repository
variable (Settings → Secrets and variables → Actions); the workflow then serves from the root
and writes the `CNAME`. Without it the app is served from `/<repo>/`.

The page ships a Content-Security-Policy of `connect-src 'self'` and `form-action 'none'`, so
it cannot contact any host but its own origin — which serves static files and accepts nothing.
A service worker precaches the build, so after the first visit it runs with the network off.

## Tests

```bash
npm test
```

Runs the database, matching, and import tests in `tests/` against a throwaway SQLite file
(never your real data). They run under Electron's bundled Node, since that's what the
SQLite driver is compiled for.

## Building an installer

```bash
npm run dist:win    # Windows: installer, portable .exe and .zip (no install needed)
npm run dist:mac    # macOS (.dmg)
npm run dist:linux  # Linux (AppImage)
```

`dist:win` also prepares a private Python with `ddgs` for the installer (`scripts/bundle-python.cjs`),
which needs Python with pip on the build machine the first time.

Output lands in `dist/`. Run the matching `dist:*` script on the OS you want to build for.

## Project layout

- `src/main` — SQLite schema/queries (`db/`), spreadsheet parsing (`importer.ts`), and the
  deterministic student-matching engine (`matching.ts`). Most of it is platform-neutral and
  compiled into both builds; the Electron- and Node-bound files (`index.ts`, `ipc.ts`,
  `backup.ts`, `dataDir.ts`, `db/desktop.ts`, `lookupQueue.ts`, `positionLookup.ts`,
  `workbooksDesktop.ts`) are listed in `tsconfig.web.json`'s `exclude`, which is what stops
  them reaching the browser bundle.
- `src/main/db/driver.ts` — the four-method database interface every query is written
  against. The desktop build plugs in better-sqlite3, the web build plugs in sql.js.
- `src/preload` — the narrow, typed bridge exposed to the renderer as `window.api`.
- `src/renderer` — the React UI, shared by both builds.
- `src/web` — what stands in for the main process in a browser: the sql.js adapter
  (`sqljs.ts`), file open/save and recovery (`storage.ts`, `session.ts`), and `window.api`
  (`api.ts`).
- `src/shared` — types shared between main and renderer.
- `tests` — automated tests (`npm test`).

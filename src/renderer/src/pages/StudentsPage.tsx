import React, { useEffect, useMemo, useState } from 'react'
import type { Student } from '../../../shared/types'
import StudentDetailDrawer from '../components/StudentDetailDrawer'
import LinkedInMatches from '../components/LinkedInMatches'

export type StudentsView = 'list' | 'matches'

type SortKey = 'name' | 'year' | 'events'

/**
 * Year of study sorts on its ordinal, never its text: sorting the labels
 * would put "Fourth" before "Second" and quietly make the column useless.
 */
function compareStudents(a: Student, b: Student, key: SortKey): number {
  if (key === 'year') {
    return (
      a.currentYear.ordinal - b.currentYear.ordinal ||
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName)
    )
  }
  if (key === 'events') {
    return b.attendanceCount - a.attendanceCount || a.lastName.localeCompare(b.lastName)
  }
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
}

export default function StudentsPage({
  initialView = 'list',
  onNavigate
}: {
  initialView?: StudentsView
  onNavigate: (page: string) => void
}): React.JSX.Element {
  const [view, setView] = useState<StudentsView>(initialView)
  const [matchesToReview, setMatchesToReview] = useState(0)
  const [students, setStudents] = useState<Student[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name')
  const [yearFilter, setYearFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const visible = useMemo(() => {
    const filtered =
      yearFilter === 'all'
        ? students
        : students.filter((s) =>
            yearFilter === 'unknown'
              ? s.currentYear.kind === 'unknown'
              : yearFilter === 'graduate'
                ? s.currentYear.kind === 'graduate'
                : yearFilter === 'graduated'
                  ? s.currentYear.kind === 'likely_graduated'
                  : String(s.currentYear.year) === yearFilter
          )
    return [...filtered].sort((a, b) => compareStudents(a, b, sort))
  }, [students, sort, yearFilter])

  const refresh = (): void => {
    setLoading(true)
    window.api.listStudents(search).then((rows) => {
      setStudents(rows)
      setLoading(false)
    })
  }

  useEffect(() => {
    const t = setTimeout(refresh, 150)
    return () => clearTimeout(t)
  }, [search])

  // Background lookups keep finishing while the page is open.
  useEffect(() => {
    const update = (): void => {
      window.api.getLookupStatus().then((s) => setMatchesToReview(s.done + s.failed))
    }
    update()
    const timer = setInterval(update, 3000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Students</h1>
          <p>{students.length} student{students.length === 1 ? '' : 's'} on file</p>
        </div>
      </div>

      <div className="sheet-tabs page-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'list'}
          className={`sheet-tab ${view === 'list' ? 'is-active' : ''}`}
          onClick={() => setView('list')}
        >
          All students
        </button>
        {window.api.capabilities.positionLookup && (
          <button
            role="tab"
            aria-selected={view === 'matches'}
            className={`sheet-tab ${view === 'matches' ? 'is-active' : ''}`}
            onClick={() => setView('matches')}
          >
            LinkedIn matches
            {matchesToReview > 0 && <span className="sheet-tab-count">{matchesToReview}</span>}
          </button>
        )}
      </div>

      {view === 'matches' && window.api.capabilities.positionLookup ? (
        <LinkedInMatches onNavigate={onNavigate} />
      ) : (
      <>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search name, email, student ID, college, program…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <select
            aria-label="Filter by year of study"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            style={{ maxWidth: 190 }}
          >
            <option value="all">Any year</option>
            <option value="1">Year 1</option>
            <option value="2">Year 2</option>
            <option value="3">Year 3</option>
            <option value="4">Year 4</option>
            <option value="5">Year 5</option>
            <option value="graduate">Graduate students</option>
            <option value="graduated">Likely graduated</option>
            <option value="unknown">Year unknown</option>
          </select>
          <span className="spacer" />
          <span className="text-faint">
            {visible.length === students.length
              ? `${students.length} student${students.length === 1 ? '' : 's'}`
              : `${visible.length} of ${students.length}`}
          </span>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : students.length === 0 ? (
            <div className="empty-state">No students match yet. Import a spreadsheet to get started.</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">No students in that year.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>
                    <button className="col-sort" onClick={() => setSort('name')} aria-pressed={sort === 'name'}>
                      Name{sort === 'name' && <span className="col-sort-mark"> ↓</span>}
                    </button>
                  </th>
                  <th>Contact</th>
                  <th>College / Discipline / Degree</th>
                  <th>
                    <button className="col-sort" onClick={() => setSort('year')} aria-pressed={sort === 'year'}>
                      Year{sort === 'year' && <span className="col-sort-mark"> ↓</span>}
                    </button>
                  </th>
                  <th>
                    <button className="col-sort" onClick={() => setSort('events')} aria-pressed={sort === 'events'}>
                      Events attended{sort === 'events' && <span className="col-sort-mark"> ↓</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedId(s.id)}>
                    <td>
                      <strong>
                        {s.firstName} {s.lastName}
                      </strong>
                      {s.nsid && <div className="text-faint mono">{s.nsid}</div>}
                    </td>
                    <td>
                      <div>{s.emails[0] ?? '—'}</div>
                      {s.phones[0] && <div className="text-faint">{s.phones[0]}</div>}
                    </td>
                    <td className="text-dim">
                      {[s.college, s.discipline, s.degree].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td>
                      <span className={`year-label kind-${s.currentYear.kind}`}>{s.currentYear.label}</span>
                      {s.currentYear.basis && !s.currentYear.current && (
                        <div className="text-faint year-basis" title={`From ${s.currentYear.basis}`}>
                          est. from {s.currentYear.basis}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="chip">{s.attendanceCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
      )}

      {selectedId && (
        <StudentDetailDrawer
          studentId={selectedId}
          onClose={() => {
            setSelectedId(null)
            refresh()
          }}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

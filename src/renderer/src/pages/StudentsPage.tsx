import React, { useEffect, useMemo, useState } from 'react'
import type { Student } from '../../../shared/types'
import { exportStudentsToExcel, type ProgressByStudent } from '../lib/exportStudents'
import StudentDetailDrawer from '../components/StudentDetailDrawer'
import LinkedInMatches from '../components/LinkedInMatches'

export type StudentsView = 'list' | 'alumni' | 'matches'

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
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const alumniView = view === 'alumni'
  /**
   * Somebody is an alum if they have been marked as one, or if they would
   * now be past the end of a four-year programme. The second kind is the
   * point of the split: what is left in Students is who is still in the
   * programme, which is who there is any sense in contacting.
   */
  const hasFinished = (s: Student): boolean => s.isAlumni || s.currentYear.kind === 'likely_graduated'
  // The last file saved belongs to the list it came from.
  useEffect(() => setExported(null), [view, yearFilter, search])
  const alumniCount = students.filter(hasFinished).length

  const visible = useMemo(() => {
    // Students and Alumni are two views of one list, so somebody who came to
    // a hackathon in 2019 and graduated in 2021 stays one person.
    const inView = students.filter((s) => hasFinished(s) === alumniView)
    const filtered =
      yearFilter === 'all'
        ? inView
        : inView.filter((s) =>
            yearFilter === 'unknown'
              ? s.currentYear.kind === 'unknown'
              : yearFilter === 'graduate'
                ? s.currentYear.kind === 'graduate'
                : yearFilter === 'graduated'
                  ? s.currentYear.kind === 'likely_graduated'
                  : String(s.currentYear.year) === yearFilter
          )
    return [...filtered].sort((a, b) => compareStudents(a, b, sort))
  }, [students, sort, yearFilter, alumniView])

  /**
   * Exports exactly what the table is showing. Certificate progress is
   * fetched per student at this point rather than held for every row all
   * the time — it is only needed when somebody asks for the file.
   */
  const exportVisible = async (): Promise<void> => {
    setExporting(true)
    setExported(null)
    try {
      const certificates = await window.api.listCertificates()
      const progress: ProgressByStudent = new Map()
      for (const student of visible) {
        progress.set(student.id, await window.api.getStudentCertificates(student.id))
      }
      setExported(
        exportStudentsToExcel({
          students: visible,
          kind: alumniView ? 'alumni' : 'students',
          certificateNames: certificates.map((c) => c.name),
          progress
        })
      )
    } finally {
      setExporting(false)
    }
  }

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
          <p>
            {students.length - alumniCount} still in the programme, {alumniCount} finished
          </p>
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
        <button
          role="tab"
          aria-selected={view === 'alumni'}
          className={`sheet-tab ${view === 'alumni' ? 'is-active' : ''}`}
          onClick={() => setView('alumni')}
        >
          Alumni
          {alumniCount > 0 && <span className="sheet-tab-count">{alumniCount}</span>}
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
          {!alumniView && (
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
            <option value="graduate">Graduate students</option>
            <option value="unknown">Year unknown</option>
          </select>
          )}
          <span className="spacer" />
          {exported && <span className="text-faint">Saved {exported}</span>}
          <button className="btn btn-sm" onClick={exportVisible} disabled={exporting || visible.length === 0}>
            {exporting ? 'Building…' : `Export ${visible.length} to Excel`}
          </button>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : students.length === 0 ? (
            <div className="empty-state">No students match yet. Import a spreadsheet to get started.</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              {alumniView
                ? 'Nobody has finished yet. People appear here once they are past four years, or when you mark them on their record.'
                : 'No students in that year.'}
            </div>
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
                    {alumniView ? (
                      'Cohort'
                    ) : (
                      <button className="col-sort" onClick={() => setSort('year')} aria-pressed={sort === 'year'}>
                        Year{sort === 'year' && <span className="col-sort-mark"> ↓</span>}
                      </button>
                    )}
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
                      {alumniView ? (
                        <>
                          <span className="year-label">{s.cohortYear ?? '—'}</span>
                          {!s.isAlumni && (
                            <div className="text-faint year-basis" title={s.currentYear.basis ?? undefined}>
                              estimated, not marked
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <span className={`year-label kind-${s.currentYear.kind}`}>
                            {s.currentYear.label}
                          </span>
                          {s.currentYear.basis && !s.currentYear.current && (
                            <div className="text-faint year-basis" title={`From ${s.currentYear.basis}`}>
                              est. from {s.currentYear.basis}
                            </div>
                          )}
                        </>
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

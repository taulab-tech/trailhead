import React, { useEffect, useState } from 'react'
import type { Student } from '../../../shared/types'
import StudentDetailDrawer from '../components/StudentDetailDrawer'
import LinkedInMatches from '../components/LinkedInMatches'

export type StudentsView = 'list' | 'matches'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
        <button
          role="tab"
          aria-selected={view === 'matches'}
          className={`sheet-tab ${view === 'matches' ? 'is-active' : ''}`}
          onClick={() => setView('matches')}
        >
          LinkedIn matches
          {matchesToReview > 0 && <span className="sheet-tab-count">{matchesToReview}</span>}
        </button>
      </div>

      {view === 'matches' ? (
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
        </div>

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : students.length === 0 ? (
            <div className="empty-state">No students match yet. Import a spreadsheet to get started.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>College / Discipline / Degree</th>
                  <th>Events attended</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
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

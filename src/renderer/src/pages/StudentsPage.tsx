import React, { useEffect, useState } from 'react'
import type { Student } from '../../../shared/types'
import StudentDetailDrawer from '../components/StudentDetailDrawer'

export default function StudentsPage(): React.JSX.Element {
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Students</h1>
          <p>{students.length} student{students.length === 1 ? '' : 's'} on file</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name, email, NSID, college, program…"
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

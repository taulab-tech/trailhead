import React, { useEffect, useState } from 'react'
import type { EventCategory, EventRecord, Student } from '../../../shared/types'
import EventDetailDrawer from './EventDetailDrawer'
import StudentDetailDrawer from './StudentDetailDrawer'

export interface FunnelSelection {
  title: string
  subtitle?: string
  students: Student[]
  /** Constituent events to browse, when this selection represents a whole group. */
  events?: EventRecord[]
}

export default function FunnelDrillDrawer({
  selection,
  onClose
}: {
  selection: FunnelSelection
  onClose: () => void
}): React.JSX.Element {
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)

  useEffect(() => {
    if (selection.events) window.api.listCategories().then(setCategories)
  }, [selection])

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <h2>{selection.title}</h2>
          <p className="text-dim" style={{ marginTop: 0 }}>
            {selection.subtitle ??
              `${selection.students.length} student${selection.students.length === 1 ? '' : 's'}`}
          </p>

          {selection.events && (
            <>
              <div className="section-title" style={{ marginTop: 8 }}>
                Individual events in this group ({selection.events.length})
              </div>
              {selection.events.length === 0 && (
                <p className="text-dim">No events assigned to this group yet.</p>
              )}
              {selection.events.map((e) => (
                <div
                  key={e.id}
                  onClick={() => setSelectedEventId(e.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 0',
                    borderBottom: '1px solid var(--border-soft)',
                    cursor: 'pointer'
                  }}
                >
                  <div>
                    <div>{e.name}</div>
                    {e.date && <div className="text-faint">{e.date}</div>}
                  </div>
                  <span className="chip">{e.attendeeCount}</span>
                </div>
              ))}
            </>
          )}

          <div className="section-title">Students</div>
          {selection.students.length === 0 && <p className="text-dim">None.</p>}
          {selection.students.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedStudentId(s.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '7px 0',
                borderBottom: '1px solid var(--border-soft)',
                cursor: 'pointer'
              }}
            >
              <div>
                <div>
                  {s.firstName} {s.lastName}
                </div>
                <div className="text-faint">{s.emails[0] ?? 'no email'}</div>
              </div>
              <span className="chip">{s.attendanceCount} event(s)</span>
            </div>
          ))}

          <div style={{ marginTop: 24 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {selectedEventId && (
        <EventDetailDrawer
          eventId={selectedEventId}
          categories={categories}
          onClose={() => setSelectedEventId(null)}
          onDeleted={() => setSelectedEventId(null)}
          onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
        />
      )}
      {selectedStudentId && (
        <StudentDetailDrawer
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          onChanged={() => {}}
        />
      )}
    </>
  )
}

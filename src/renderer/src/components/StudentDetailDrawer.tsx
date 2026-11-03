import React, { useEffect, useState } from 'react'
import type { AttendanceDate, EventCategory, EventRecord, Student, StudentDetail } from '../../../shared/types'
import PositionLookup from './PositionLookup'
import StudentCertificates from './StudentCertificates'
import StudentCourses from './StudentCourses'
import JourneyTimeline from './JourneyTimeline'
import { buildJourneys, trailStages } from '../../../shared/journeys'
import { colorForIndex } from '../lib/palette'

export default function StudentDetailDrawer({
  studentId,
  onClose,
  onChanged
}: {
  studentId: string
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<StudentDetail | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  // Kept out of `form`, which is a bag of text inputs.
  const [isAlumni, setIsAlumni] = useState(false)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [attendanceDates, setAttendanceDates] = useState<AttendanceDate[]>([])
  const [addEventId, setAddEventId] = useState('')
  const [mergeQuery, setMergeQuery] = useState('')
  const [mergeResults, setMergeResults] = useState<Student[]>([])
  const [saving, setSaving] = useState(false)

  const load = (): void => {
    window.api.getStudentDetail(studentId).then((d) => {
      setDetail(d)
      if (d) {
        setIsAlumni(d.isAlumni)
        setForm({
          firstName: d.firstName,
          lastName: d.lastName,
          nsid: d.nsid ?? '',
          college: d.college ?? '',
          discipline: d.discipline ?? '',
          degree: d.degree ?? '',
          program: d.program ?? '',
          yearInProgram: d.yearInProgram ?? '',
          enrolTerm: d.enrolTerm ?? '',
          cohortYear: d.cohortYear === null ? '' : String(d.cohortYear),
          notes: d.notes ?? ''
        })
      }
    })
  }

  useEffect(() => {
    load()
    window.api.listEvents().then(setEvents)
    window.api.listCategories().then(setCategories)
    window.api.getAttendanceDates().then((dates) => setAttendanceDates(dates.filter((d) => d.studentId === studentId)))
  }, [studentId])

  useEffect(() => {
    if (mergeQuery.trim().length < 2) {
      setMergeResults([])
      return
    }
    const t = setTimeout(() => {
      window.api.listStudents(mergeQuery).then((rows) => setMergeResults(rows.filter((r) => r.id !== studentId)))
    }, 200)
    return () => clearTimeout(t)
  }, [mergeQuery, studentId])

  if (!detail) return <div className="drawer-overlay" onClick={onClose} />

  const save = async (): Promise<void> => {
    setSaving(true)
    // A blank cohort year means "not known", not the number zero.
    const cohortYear = String(form.cohortYear ?? '').trim()
    await window.api.updateStudent(studentId, {
      ...form,
      isAlumni,
      cohortYear: cohortYear ? Number(cohortYear) : null
    })
    setSaving(false)
    load()
    onChanged()
  }

  const addAttendance = async (): Promise<void> => {
    if (!addEventId) return
    await window.api.addAttendance(studentId, addEventId)
    setAddEventId('')
    load()
    onChanged()
  }

  const removeAttendance = async (attendanceId: string): Promise<void> => {
    await window.api.removeAttendance(attendanceId)
    load()
    onChanged()
  }

  const mergeInto = async (targetId: string, direction: 'thisIntoTarget' | 'targetIntoThis'): Promise<void> => {
    const keepId = direction === 'thisIntoTarget' ? targetId : studentId
    const mergeId = direction === 'thisIntoTarget' ? studentId : targetId
    await window.api.mergeStudents(keepId, mergeId)
    onChanged()
    if (direction === 'thisIntoTarget') {
      onClose()
    } else {
      load()
    }
  }

  const attendedEventIds = new Set(detail.attendances.map((a) => a.eventId))
  const onTrail = categories.filter((c) => c.stageOrder !== null)
  const journey =
    buildJourneys(
      events,
      detail.attendances.map((a) => ({ eventId: a.eventId, studentIds: [detail.id] })),
      attendanceDates,
      categories
    ).get(detail.id) ?? null
  const colorForCategory = (categoryId: string | null): string | null => {
    const i = onTrail.findIndex((c) => c.id === categoryId)
    return i >= 0 ? colorForIndex(i) : null
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h2>
          {detail.firstName} {detail.lastName}
        </h2>
        <p className="text-dim" style={{ marginTop: 0 }}>
          {detail.emails.join(', ') || 'No email on file'}
        </p>

        <div className="section-title">Profile</div>
        <div className="field-row">
          <div>
            <label>First name</label>
            <input
              type="text"
              value={form.firstName ?? ''}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </div>
          <div>
            <label>Last name</label>
            <input
              type="text"
              value={form.lastName ?? ''}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
        </div>
        <div className="field-row-3">
          <div>
            <label>Student ID</label>
            <input
              type="text"
              value={form.nsid ?? ''}
              onChange={(e) => setForm({ ...form, nsid: e.target.value })}
            />
          </div>
          <div>
            <label>Year in program / enroll year</label>
            <input
              type="text"
              value={form.yearInProgram ?? ''}
              onChange={(e) => setForm({ ...form, yearInProgram: e.target.value })}
            />
          </div>
          <div>
            <label>Enrol term</label>
            <select
              value={form.enrolTerm ?? ''}
              onChange={(e) => setForm({ ...form, enrolTerm: e.target.value })}
            >
              <option value="">Unknown</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div>
            <label>College</label>
            <input
              type="text"
              value={form.college ?? ''}
              onChange={(e) => setForm({ ...form, college: e.target.value })}
            />
          </div>
          <div>
            <label>Discipline / Major</label>
            <input
              type="text"
              value={form.discipline ?? ''}
              onChange={(e) => setForm({ ...form, discipline: e.target.value })}
            />
          </div>
        </div>
        <div className="field-row">
          <div>
            <label>Degree</label>
            <input
              type="text"
              value={form.degree ?? ''}
              onChange={(e) => setForm({ ...form, degree: e.target.value })}
            />
          </div>
          <div>
            <label>Program</label>
            <input
              type="text"
              value={form.program ?? ''}
              onChange={(e) => setForm({ ...form, program: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="student-alumni">
            <input
              type="checkbox"
              checked={isAlumni}
              onChange={(e) => setIsAlumni(e.target.checked)}
            />
            Alum — has come through the programme
          </label>
          {isAlumni && (
            <div style={{ maxWidth: 160, marginBottom: 12 }}>
              <label>Cohort year</label>
              <input
                type="number"
                min="1990"
                max="2100"
                placeholder="e.g. 2023"
                value={String(form.cohortYear ?? '')}
                onChange={(e) => setForm({ ...form, cohortYear: e.target.value })}
              />
            </div>
          )}

          <label>Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        <div className="section-title">Position</div>
        <PositionLookup
          student={detail}
          onSaved={() => {
            load()
            onChanged()
          }}
        />

        <StudentCertificates studentId={detail.id} onChanged={onChanged} />

        <StudentCourses courses={detail.courses} />

        <div className="section-title">Path ({detail.attendances.length} event{detail.attendances.length === 1 ? '' : 's'})</div>
        <JourneyTimeline
          journey={journey}
          totalStops={trailStages(categories).length}
          colorForCategory={colorForCategory}
          student={detail}
          onRemove={(eventId) => {
            const attendance = detail.attendances.find((a) => a.eventId === eventId)
            if (attendance) removeAttendance(attendance.id)
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select value={addEventId} onChange={(e) => setAddEventId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Add to event…</option>
            {events
              .filter((e) => !attendedEventIds.has(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          <button className="btn btn-sm" onClick={addAttendance} disabled={!addEventId}>
            Add
          </button>
        </div>

        <div className="section-title">Manually merge with another student</div>
        <p className="text-dim" style={{ marginTop: 0 }}>
          If the automatic matching missed a repeat student, find them here and combine the two records.
        </p>
        <input
          type="text"
          placeholder="Search by name, email or student ID…"
          value={mergeQuery}
          onChange={(e) => setMergeQuery(e.target.value)}
        />
        {mergeResults.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 0',
              borderBottom: '1px solid var(--border-soft)'
            }}
          >
            <div>
              <div>
                {r.firstName} {r.lastName}
              </div>
              <div className="text-faint">
                {r.emails[0] ?? 'no email'} · {r.attendanceCount} event(s)
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => mergeInto(r.id, 'targetIntoThis')}>
                Merge into this
              </button>
              <button className="btn btn-sm" onClick={() => mergeInto(r.id, 'thisIntoTarget')}>
                Merge this into them
              </button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 24 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

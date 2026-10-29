import React, { useMemo, useState } from 'react'
import type { AttendanceDate, EventCategory, EventRecord, Student } from '../../../shared/types'
import { buildJourneys, JOURNEY_STATUS_LABELS, trailStages, type Journey, type JourneyStatus } from '../../../shared/journeys'
import { trailStopLabel } from '../lib/stageLabel'
import JourneyPath from './JourneyPath'
import PathwayDiagram, { type DiagramFocus } from './PathwayDiagram'

const FILTERS: (JourneyStatus | 'all')[] = ['all', 'in-order', 'skipped', 'out-of-order', 'single', 'unknown']
const FILTER_HINTS: Partial<Record<JourneyStatus, string>> = {
  'in-order': 'Every stop reached in sequence',
  skipped: 'Moved forward but missed a stop',
  'out-of-order': 'Reached a later stop before an earlier one',
  single: 'Only one stop so far',
  unknown: 'Some events have no date'
}
const VISIBLE_PATHS = 8
const VISIBLE_STUDENTS = 12

const pathKey = (j: Journey): string => `${j.path.join('>')}${j.status === 'unknown' ? '?' : ''}`

/**
 * How individual students moved along the trail: filter by how they moved,
 * see the most common paths, and open any student's own timeline.
 */
export default function PathwayExplorer({
  events,
  eventStudentSets,
  attendanceDates,
  categories,
  students,
  onOpenStudent
}: {
  events: EventRecord[]
  eventStudentSets: { eventId: string; studentIds: string[] }[]
  attendanceDates: AttendanceDate[]
  categories: EventCategory[]
  students: Student[]
  onOpenStudent: (id: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<JourneyStatus | 'all'>('all')
  const [pattern, setPattern] = useState<string | null>(null)
  const [focus, setFocus] = useState<DiagramFocus | null>(null)
  const [showAllStudents, setShowAllStudents] = useState(false)
  const [showAllPaths, setShowAllPaths] = useState(false)

  const totalStops = trailStages(categories).length
  const journeys = useMemo(
    () =>
      [...buildJourneys(events, eventStudentSets, attendanceDates, categories).values()].filter(
        (j) => j.status !== 'off-trail'
      ),
    [events, eventStudentSets, attendanceDates, categories]
  )
  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: journeys.length }
    for (const j of journeys) c[j.status] = (c[j.status] ?? 0) + 1
    return c
  }, [journeys])

  const filtered = filter === 'all' ? journeys : journeys.filter((j) => j.status === filter)

  const patterns = useMemo(() => {
    const byKey = new Map<string, { key: string; sample: Journey; count: number }>()
    for (const j of filtered) {
      const key = pathKey(j)
      const entry = byKey.get(key)
      if (entry) entry.count++
      else byKey.set(key, { key, sample: j, count: 1 })
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || b.sample.path.length - a.sample.path.length)
  }, [filtered])

  const inFocus = (j: Journey): boolean => {
    if (pattern) return pathKey(j) === pattern
    if (focus?.kind === 'stop') return j.stops.includes(focus.stop)
    if (focus?.kind === 'link') return j.path.some((s, i) => i > 0 && j.path[i - 1] === focus.from && s === focus.to)
    return true
  }
  const selectionTitle = pattern
    ? 'Students on this path'
    : focus?.kind === 'stop'
      ? `Students who reached ${focus.stop + 1} · ${trailStopLabel(focus.stop, totalStops)}`
      : focus?.kind === 'link'
        ? `Students who went ${trailStopLabel(focus.from, totalStops)} → ${trailStopLabel(focus.to, totalStops)}`
        : 'Students'
  const clearSelection = (): void => {
    setPattern(null)
    setFocus(null)
    setShowAllStudents(false)
  }

  const listed = filtered
    .filter(inFocus)
    .map((j) => ({ journey: j, student: studentsById.get(j.studentId) }))
    .filter((r): r is { journey: Journey; student: Student } => !!r.student)
    .sort(
      (a, b) =>
        b.journey.path.length - a.journey.path.length ||
        a.student.lastName.localeCompare(b.student.lastName) ||
        a.student.firstName.localeCompare(b.student.firstName)
    )
  const shownStudents = showAllStudents ? listed : listed.slice(0, VISIBLE_STUDENTS)
  const maxPatternCount = Math.max(1, ...patterns.map((p) => p.count))

  if (journeys.length === 0) {
    return <div className="empty-state" style={{ padding: 28 }}>No students on the trail yet.</div>
  }

  return (
    <div className="paths">
      <div className="paths-filters" role="tablist" aria-label="How students moved">
        {FILTERS.filter((f) => f === 'all' || counts[f]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`paths-filter is-${f} ${filter === f ? 'is-active' : ''}`}
            title={f === 'all' ? undefined : FILTER_HINTS[f]}
            onClick={() => {
              setFilter(f)
              clearSelection()
            }}
          >
            {f !== 'all' && <span className={`paths-filter-dot is-${f}`} />}
            {f === 'all' ? 'All paths' : JOURNEY_STATUS_LABELS[f]}
            <span className="paths-filter-count">{counts[f] ?? 0}</span>
          </button>
        ))}
      </div>
      {filter !== 'all' && FILTER_HINTS[filter] && <p className="paths-hint">{FILTER_HINTS[filter]}.</p>}

      <div className="paths-overview">
        <PathwayDiagram
          journeys={filtered}
          totalStops={totalStops}
          focus={focus}
          onFocus={(f) => {
            setPattern(null)
            setFocus(f)
            setShowAllStudents(false)
          }}
        />
        <div className="paths-legend">
          <span>
            <span className="paths-legend-swatch is-forward" /> Moved forward
          </span>
          <span>
            <span className="paths-legend-swatch is-back" /> Went back to an earlier stop
          </span>
          <span className="text-faint">Click a stop or a flow to see those students.</span>
        </div>
      </div>

      <div className="paths-grid">
        <div>
          <div className="paths-col-title">
            {showAllPaths ? `All paths · ${patterns.length}` : 'Most common paths'}
          </div>
          <div className="paths-patterns">
            {(showAllPaths ? patterns : patterns.slice(0, VISIBLE_PATHS)).map((p) => (
              <button
                key={p.key}
                className={`paths-pattern ${pattern === p.key ? 'is-active' : ''}`}
                onClick={() => {
                  setFocus(null)
                  setPattern(pattern === p.key ? null : p.key)
                  setShowAllStudents(false)
                }}
              >
                <JourneyPath path={p.sample.path} totalStops={totalStops} status={p.sample.status} />
                <span className="paths-pattern-label">
                  {p.sample.path.map((i) => trailStopLabel(i, totalStops)).join(' → ')}
                </span>
                <span className="paths-pattern-bar">
                  <span style={{ width: `${(p.count / maxPatternCount) * 100}%` }} />
                </span>
                <span className="paths-pattern-count">{p.count}</span>
              </button>
            ))}
            {patterns.length > VISIBLE_PATHS && (
              <button className="review-link paths-more" onClick={() => setShowAllPaths((v) => !v)}>
                {showAllPaths ? 'Show only the most common' : `Show all ${patterns.length} paths`}
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="paths-col-title">
            {selectionTitle} <span className="text-faint">· {listed.length}</span>
            {(pattern || focus) && (
              <button className="review-link" style={{ marginLeft: 10 }} onClick={clearSelection}>
                Show all
              </button>
            )}
          </div>
          <table className="paths-table">
            <tbody>
              {shownStudents.map(({ journey, student }) => (
                <tr key={student.id} onClick={() => onOpenStudent(student.id)}>
                  <td className="paths-student">
                    {student.firstName} {student.lastName}
                    {student.position && (
                      <div className="paths-student-job">
                        {student.position}
                        {student.positionOrg ? ` · ${student.positionOrg}` : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    <JourneyPath path={journey.path} totalStops={totalStops} status={journey.status} />
                  </td>
                  <td className="paths-status">
                    <span className={`paths-filter-dot is-${journey.status}`} />
                    {JOURNEY_STATUS_LABELS[journey.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {listed.length > VISIBLE_STUDENTS && (
            <button className="review-link" style={{ marginTop: 10 }} onClick={() => setShowAllStudents((v) => !v)}>
              {showAllStudents ? 'Show fewer' : `Show all ${listed.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

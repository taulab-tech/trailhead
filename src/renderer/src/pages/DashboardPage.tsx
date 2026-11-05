import React, { useEffect, useMemo, useState } from 'react'
import type { AttendanceDate, DashboardStats, EventCategory, EventRecord, Student } from '../../../shared/types'
import FunnelDrillDrawer, { type FunnelSelection } from '../components/FunnelDrillDrawer'
import PathwayExplorer from '../components/PathwayExplorer'
import ReachOut from '../components/ReachOut'
import StudentDetailDrawer from '../components/StudentDetailDrawer'
import { trailStopLabel } from '../lib/stageLabel'
import { colorForIndex } from '../lib/palette'
import { formatSince } from '../lib/positions'

/** "12%", or "<1%" for a non-zero share that would otherwise round to 0%. */
function formatShare(part: number, total: number): string {
  if (total === 0) return '0%'
  const pct = (part / total) * 100
  return part > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

const byName = (a: Student, b: Student): number =>
  a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)

interface TrailGroup {
  category: EventCategory
  color: string
  studentIds: Set<string>
  events: EventRecord[]
}

interface TrailStop {
  stage: number
  groups: TrailGroup[]
  studentIds: Set<string>
  events: EventRecord[]
}

const WORKING_ICON = 'M3 8h18v12H3zM8 8V5h8v3M3 13h18'

function Icon({ d, size = 18 }: { d: string; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function BarList({ rows, limit = 12 }: { rows: { label: string; count: number }[]; limit?: number }): React.JSX.Element {
  const shown = rows.slice(0, limit)
  const max = Math.max(1, ...shown.map((r) => r.count))
  if (shown.length === 0) return <p className="text-dim">No data yet.</p>
  return (
    <div>
      {shown.map((r) => (
        <div className="bar-row" key={r.label}>
          <div className="text-dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <div style={{ textAlign: 'right' }}>{r.count}</div>
        </div>
      ))}
    </div>
  )
}

/** The trail as a row of stops with how many students continued between them, ending in "Working now". */
function TrailSection({
  stats,
  students,
  onNavigate,
  onOpenStudents,
  onOpenStudent
}: {
  stats: DashboardStats
  students: Student[]
  onNavigate: (page: string) => void
  onOpenStudents: (selection: FunnelSelection) => void
  onOpenStudent: (id: string) => void
}): React.JSX.Element {
  const [allEvents, setAllEvents] = useState<EventRecord[]>([])
  const [eventStudentSets, setEventStudentSets] = useState<{ eventId: string; studentIds: string[] }[]>([])
  const [attendanceDates, setAttendanceDates] = useState<AttendanceDate[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [selectedYear, setSelectedYear] = useState<number | 'overall'>('overall')

  useEffect(() => {
    window.api.listEvents().then(setAllEvents)
    window.api.getEventStudentSets().then(setEventStudentSets)
    window.api.getAttendanceDates().then(setAttendanceDates)
    window.api.listCategories().then(setCategories)
  }, [])

  const scopedEvents = useMemo(() => {
    if (selectedYear === 'overall') return allEvents
    return allEvents.filter((e) => e.date?.startsWith(String(selectedYear)))
  }, [allEvents, selectedYear])

  const scopedEventStudentSets = useMemo(() => {
    const ids = new Set(scopedEvents.map((e) => e.id))
    return eventStudentSets.filter((s) => ids.has(s.eventId))
  }, [eventStudentSets, scopedEvents])

  const undatedTrailEvents = allEvents.filter((e) => !e.date && e.categoryStage !== null).length

  // Every group on the trail (even one with no events yet), in the same order
  // the Trail page and pathway diagram use, so colours match across pages.
  const stops = useMemo<TrailStop[]>(() => {
    const studentsByEvent = new Map(scopedEventStudentSets.map((s) => [s.eventId, s.studentIds]))
    const onTrail = categories.filter((c) => c.stageOrder !== null)
    const stages = Array.from(new Set(onTrail.map((c) => c.stageOrder!))).sort((a, b) => a - b)
    return stages.map((stage) => {
      const groups = onTrail
        .filter((c) => c.stageOrder === stage)
        .map((category) => {
          const events = scopedEvents.filter((e) => e.categoryId === category.id)
          const studentIds = new Set(events.flatMap((e) => studentsByEvent.get(e.id) ?? []))
          return { category, color: colorForIndex(onTrail.indexOf(category)), studentIds, events }
        })
      return {
        stage,
        groups,
        studentIds: new Set(groups.flatMap((g) => [...g.studentIds])),
        events: groups.flatMap((g) => g.events)
      }
    })
  }, [categories, scopedEvents, scopedEventStudentSets])

  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const toStudents = (ids: Iterable<string>): Student[] =>
    [...ids].map((id) => studentsById.get(id)).filter((s): s is Student => !!s).sort(byName)

  const onTrailIds = new Set(stops.flatMap((s) => [...s.studentIds]))
  const working = toStudents(onTrailIds).filter((s) => s.position)
  const topOrgs = Object.entries(
    working.reduce<Record<string, number>>((acc, s) => {
      if (s.positionOrg) acc[s.positionOrg] = (acc[s.positionOrg] ?? 0) + 1
      return acc
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const entry = stops[0]
  const last = stops[stops.length - 1]
  const completed =
    stops.length > 1 && entry ? [...entry.studentIds].filter((id) => stops.every((s) => s.studentIds.has(id))).length : 0

  return (
    <>
    <div className="card dash-trail">
      <div className="dash-card-head">
        <div>
          <h2 className="dash-card-title">The trail</h2>
          <p className="dash-card-sub">
            How far students get, stop by stop{selectedYear === 'overall' ? '' : ` — ${selectedYear} only`}.
            {stops.length > 1 && entry && entry.studentIds.size > 0 && (
              <>
                {' '}
                <b>{completed}</b> of {entry.studentIds.size} who started at {trailStopLabel(0, stops.length)} reached{' '}
                {trailStopLabel(stops.length - 1, stops.length)} ({formatShare(completed, entry.studentIds.size)}).
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'overall' ? 'overall' : Number(e.target.value))}
            style={{ width: 130 }}
            aria-label="Year"
          >
            <option value="overall">All years</option>
            {stats.funnelYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedYear !== 'overall' && undatedTrailEvents > 0 && (
        <p className="dash-note">
          {undatedTrailEvents} trail event{undatedTrailEvents === 1 ? ' has' : 's have'} no date, so{' '}
          {undatedTrailEvents === 1 ? "it isn't" : "they aren't"} counted in any single year.
        </p>
      )}

      {stops.length === 0 ? (
        <div className="empty-state" style={{ padding: 32 }}>
          <p style={{ marginTop: 0 }}>No groups are on the trail yet.</p>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('groups')}>
            Set up the trail
          </button>
        </div>
      ) : (
        <div className="dash-journey">
          <div className="dash-journey-line" />
          {stops.map((stop, i) => {
            const next = stops[i + 1]
            const continued = next ? [...stop.studentIds].filter((id) => next.studentIds.has(id)) : []
            return (
              <React.Fragment key={stop.stage}>
                <button
                  className="dash-stop"
                  onClick={() =>
                    onOpenStudents({
                      title: `${trailStopLabel(i, stops.length)} · ${stop.groups.map((g) => g.category.name).join(', ')}`,
                      students: toStudents(stop.studentIds),
                      events: stop.events
                    })
                  }
                >
                  <span className="dash-stop-marker">{i + 1}</span>
                  <span className="dash-stop-label">{trailStopLabel(i, stops.length)}</span>
                  <span className="dash-stop-count">{stop.studentIds.size}</span>
                  <span className="dash-stop-unit">student{stop.studentIds.size === 1 ? '' : 's'}</span>
                  <span className="dash-stop-groups">
                    {stop.groups.map((g) => (
                      <span key={g.category.id} className="dash-stop-group">
                        <span className="trail-dot" style={{ background: g.color }} />
                        <span className="dash-stop-group-name">{g.category.name}</span>
                        <span className="dash-stop-group-count">{g.studentIds.size}</span>
                      </span>
                    ))}
                  </span>
                </button>
                {next && (
                  <button
                    className="dash-link"
                    disabled={continued.length === 0}
                    onClick={() =>
                      onOpenStudents({
                        title: `Continued from ${trailStopLabel(i, stops.length)} to ${trailStopLabel(i + 1, stops.length)}`,
                        students: toStudents(continued)
                      })
                    }
                  >
                    <span className="dash-link-count">{continued.length}</span>
                    <span className="dash-link-text">continued</span>
                    <span className="dash-link-share">{formatShare(continued.length, stop.studentIds.size)}</span>
                  </button>
                )}
              </React.Fragment>
            )
          })}
          <span className="dash-link dash-link-static" aria-hidden="true" />
          <button
            className="dash-stop dash-stop-outcome"
            onClick={() =>
              onOpenStudents({
                title: 'Working now',
                subtitle: `${working.length} of ${onTrailIds.size} students on the trail have a saved position`,
                students: working
              })
            }
          >
            <span className="dash-stop-marker">
              <Icon d={WORKING_ICON} />
            </span>
            <span className="dash-stop-label">Working now</span>
            <span className="dash-stop-count">{working.length}</span>
            <span className="dash-stop-unit">
              with a known position · {formatShare(working.length, onTrailIds.size)}
            </span>
            <span className="dash-stop-groups">
              {topOrgs.length === 0 ? (
                <span className="dash-stop-hint">Look students up on LinkedIn from their profile</span>
              ) : (
                topOrgs.map(([org, count]) => (
                  <span key={org} className="dash-stop-group">
                    <span className="dash-stop-group-name">{org}</span>
                    <span className="dash-stop-group-count">{count}</span>
                  </span>
                ))
              )}
            </span>
          </button>
        </div>
      )}

      {last && last.studentIds.size === 0 && stops.length > 1 && (
        <p className="dash-note">
          Nobody has reached {trailStopLabel(stops.length - 1, stops.length)} yet
          {selectedYear === 'overall' ? '' : ` in ${selectedYear}`} — import its rosters, or check its groups on The
          Trail.
        </p>
      )}

    </div>

    {stops.length > 0 && (
      <div className="card dash-paths">
        <h2 className="dash-card-title">Student paths</h2>
        <p className="dash-card-sub" style={{ marginTop: -10, marginBottom: 16 }}>
          How each student moved along the trail{selectedYear === 'overall' ? '' : ` in ${selectedYear}`}, by the dates
          of the events they attended. Pick a path to see who took it; click a student for their full timeline.
        </p>
        <PathwayExplorer
          events={scopedEvents}
          eventStudentSets={scopedEventStudentSets}
          attendanceDates={attendanceDates}
          categories={categories}
          students={students}
          onOpenStudent={onOpenStudent}
        />
      </div>
    )}
    </>
  )
}

/** Students with a saved position, newest start first, and where they reached on the trail. */
function WhereTheyAreNow({
  students,
  furthestStop,
  onOpenStudent
}: {
  students: Student[]
  furthestStop: Map<string, string>
  onOpenStudent: (id: string) => void
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const working = students
    .filter((s) => s.position)
    .sort((a, b) => (b.positionSince ?? '').localeCompare(a.positionSince ?? '') || byName(a, b))
  const shown = showAll ? working : working.slice(0, 8)
  const orgs = Object.entries(
    working.reduce<Record<string, number>>((acc, s) => {
      if (s.positionOrg) acc[s.positionOrg] = (acc[s.positionOrg] ?? 0) + 1
      return acc
    }, {})
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="dash-outcomes">
      <div className="card" style={{ padding: 0 }}>
        <div className="dash-card-head" style={{ padding: '20px 20px 0' }}>
          <div>
            <h2 className="dash-card-title">Where they are now</h2>
            <p className="dash-card-sub">Positions confirmed from LinkedIn on each student’s profile.</p>
          </div>
        </div>
        {working.length === 0 ? (
          <div className="empty-state" style={{ padding: '28px 20px 32px' }}>
            No positions saved yet. Open a student and use <b>Look up on LinkedIn</b> to add where they work.
          </div>
        ) : (
          <>
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Position</th>
                  <th>Organisation</th>
                  <th>Since</th>
                  <th>Furthest stop</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} onClick={() => onOpenStudent(s.id)}>
                    <td className="dash-table-name">
                      {s.firstName} {s.lastName}
                    </td>
                    <td>{s.position}</td>
                    <td>{s.positionOrg ?? <span className="text-faint">—</span>}</td>
                    <td className="dash-table-since">
                      {s.positionSince ? formatSince(s.positionSince) : <span className="text-faint">—</span>}
                    </td>
                    <td>
                      {furthestStop.get(s.id) ? (
                        <span className="dash-pill">{furthestStop.get(s.id)}</span>
                      ) : (
                        <span className="text-faint">Not on the trail</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {working.length > 8 && (
              <div style={{ padding: '10px 20px 16px' }}>
                <button className="review-link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${working.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="card">
        <h2 className="dash-card-title">Top organisations</h2>
        <p className="dash-card-sub" style={{ marginBottom: 16 }}>
          Where students with a known position work.
        </p>
        <BarList rows={orgs} limit={8} />
      </div>
    </div>
  )
}

export default function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }): React.JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [eventStages, setEventStages] = useState<Map<string, number>>(new Map())
  const [eventStudentSets, setEventStudentSets] = useState<{ eventId: string; studentIds: string[] }[]>([])
  const [selection, setSelection] = useState<FunnelSelection | null>(null)
  const [openStudentId, setOpenStudentId] = useState<string | null>(null)

  const load = (): void => {
    window.api.getDashboardStats().then(setStats)
    window.api.listStudents().then(setStudents)
    window.api.listCategories().then(setCategories)
    window.api.listEvents().then((evs) =>
      setEventStages(new Map(evs.filter((e) => e.categoryStage !== null).map((e) => [e.id, e.categoryStage!])))
    )
    window.api.getEventStudentSets().then(setEventStudentSets)
  }

  useEffect(load, [])

  // Each student's furthest stop along the trail, by label.
  const furthestStop = useMemo(() => {
    const stages = Array.from(
      new Set(categories.filter((c) => c.stageOrder !== null).map((c) => c.stageOrder!))
    ).sort((a, b) => a - b)
    const furthest = new Map<string, number>()
    for (const set of eventStudentSets) {
      const stage = eventStages.get(set.eventId)
      if (stage === undefined) continue
      const index = stages.indexOf(stage)
      for (const id of set.studentIds) furthest.set(id, Math.max(furthest.get(id) ?? -1, index))
    }
    return new Map([...furthest].map(([id, i]) => [id, trailStopLabel(i, stages.length)]))
  }, [categories, eventStages, eventStudentSets])

  if (!stats) return <div className="empty-state">Loading…</div>

  const noData = stats.totalStudents === 0
  const withPosition = students.filter((s) => s.position).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Who comes through your programs, how far they get, and where they go next.</p>
        </div>
      </div>

      {noData ? (
        <div className="card empty-state">
          <h3 style={{ color: 'var(--text)', marginTop: 0 }}>No data yet</h3>
          <p>Import your first attendance spreadsheet to see metrics here.</p>
          <button className="btn btn-primary" onClick={() => onNavigate('import')} style={{ marginTop: 8 }}>
            Go to Import
          </button>
        </div>
      ) : (
        <>
          <div className="grid-4">
            <div className="stat-tile">
              <div className="stat-value">{stats.totalStudents}</div>
              <div className="stat-label">Students</div>
              <div className="stat-sub">{stats.totalAttendances} attendances in total</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{stats.totalEvents}</div>
              <div className="stat-label">Programs &amp; events</div>
              <div className="stat-sub">{stats.avgEventsPerStudent.toFixed(1)} per student on average</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{stats.repeatAttendeeCount}</div>
              <div className="stat-label">Came back</div>
              <div className="stat-sub">{formatShare(stats.repeatAttendeeCount, stats.totalStudents)} attended 2+ events</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{withPosition}</div>
              <div className="stat-label">Known positions</div>
              <div className="stat-sub">{formatShare(withPosition, stats.totalStudents)} of students, from LinkedIn</div>
            </div>
          </div>

          <ReachOut />

          {stats.pendingDuplicates > 0 && (
            <div className="card dash-alert">
              <span>
                <span className="badge badge-warn">{stats.pendingDuplicates} pending</span>{' '}
                <span className="text-dim">
                  possible duplicate student{stats.pendingDuplicates === 1 ? '' : 's'} to review
                </span>
              </span>
              <button className="btn btn-sm" onClick={() => onNavigate('duplicates')}>
                Review now
              </button>
            </div>
          )}

          <TrailSection
            stats={stats}
            students={students}
            onNavigate={onNavigate}
            onOpenStudents={setSelection}
            onOpenStudent={setOpenStudentId}
          />

          <WhereTheyAreNow students={students} furthestStop={furthestStop} onOpenStudent={setOpenStudentId} />

          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2 className="dash-card-title">By college</h2>
              <BarList rows={stats.byCollege} />
            </div>
            <div className="card">
              <h2 className="dash-card-title">By discipline / major</h2>
              <BarList rows={stats.byDiscipline} />
            </div>
          </div>
          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <h2 className="dash-card-title">By year in program</h2>
              <BarList rows={stats.byYear} />
            </div>
            <div className="card">
              <h2 className="dash-card-title">Top programs by attendance</h2>
              <BarList rows={stats.topEvents.map((e) => ({ label: e.name, count: e.count }))} />
            </div>
          </div>
        </>
      )}

      {selection && <FunnelDrillDrawer selection={selection} onClose={() => setSelection(null)} />}
      {openStudentId && (
        <StudentDetailDrawer
          studentId={openStudentId}
          onClose={() => setOpenStudentId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

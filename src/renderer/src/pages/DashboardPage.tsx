import React, { useEffect, useMemo, useState } from 'react'
import type {
  AttendanceDate,
  DashboardStats,
  EventCategory,
  EventRecord,
  FunnelStats,
  Student
} from '../../../shared/types'
import FunnelDiagram from '../components/FunnelDiagram'
import FunnelDrillDrawer, { type FunnelSelection } from '../components/FunnelDrillDrawer'
import EventDetailDrawer from '../components/EventDetailDrawer'
import { stageLabel } from '../lib/stageLabel'

function FunnelSection({ stats, onNavigate }: { stats: DashboardStats; onNavigate: (page: string) => void }): React.JSX.Element {
  const [showTable, setShowTable] = useState(false)
  const [allEvents, setAllEvents] = useState<EventRecord[]>([])
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [eventStudentSets, setEventStudentSets] = useState<{ eventId: string; studentIds: string[] }[]>([])
  const [attendanceDates, setAttendanceDates] = useState<AttendanceDate[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [selection, setSelection] = useState<FunnelSelection | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | 'overall'>('overall')
  const [funnel, setFunnel] = useState<FunnelStats>(stats.funnel)

  const entryStage = funnel.stages[0]
  const entryTotal = funnel.nodes
    .filter((n) => n.stage === entryStage)
    .reduce((sum, n) => sum + n.studentCount, 0)

  useEffect(() => {
    window.api.listEvents().then(setAllEvents)
    window.api.listStudents().then(setAllStudents)
    window.api.getEventStudentSets().then(setEventStudentSets)
    window.api.getAttendanceDates().then(setAttendanceDates)
    window.api.listCategories().then(setCategories)
  }, [])

  useEffect(() => {
    const year = selectedYear === 'overall' ? null : selectedYear
    window.api.getFunnelForYear(year).then(setFunnel)
  }, [selectedYear, stats])

  // The diagram rebuilds its own category→event→student mapping from these
  // two arrays, so they need to be scoped to the same year as `funnel`
  // above — otherwise the node counts (server-filtered) and the ribbon
  // widths (client-computed from these) would disagree.
  const scopedEvents = useMemo(() => {
    if (selectedYear === 'overall') return allEvents
    const prefix = String(selectedYear)
    return allEvents.filter((e) => e.date?.startsWith(prefix))
  }, [allEvents, selectedYear])

  const scopedEventStudentSets = useMemo(() => {
    if (selectedYear === 'overall') return eventStudentSets
    const scopedIds = new Set(scopedEvents.map((e) => e.id))
    return eventStudentSets.filter((s) => scopedIds.has(s.eventId))
  }, [eventStudentSets, scopedEvents, selectedYear])

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Student pathways
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value === 'overall' ? 'overall' : Number(e.target.value))}
            style={{ maxWidth: 140 }}
          >
            <option value="overall">Overall</option>
            {stats.funnelYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Show diagram' : 'Show as table'}
          </button>
        </div>
      </div>
      <p className="text-dim" style={{ marginTop: -4 }}>
        How students move from entry events (hackathons, inspiration events) through classes to SIGMA
        itself{selectedYear === 'overall' ? '' : ` — ${selectedYear} only`}.
      </p>

      {funnel.stages.length > 1 && entryTotal > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span className="stat-value" style={{ fontSize: 20 }}>
            {funnel.fullFunnelCount}
          </span>{' '}
          <span className="text-dim">
            of {entryTotal} entry-stage students ({Math.round((funnel.fullFunnelCount / entryTotal) * 100)}%)
            made it all the way through to {stageLabel(funnel.stages[funnel.stages.length - 1])}
          </span>
        </div>
      )}

      {showTable ? (
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Group</th>
              <th>Students</th>
            </tr>
          </thead>
          <tbody>
            {funnel.nodes.map((n) => (
              <tr key={n.categoryId}>
                <td className="text-dim">{stageLabel(n.stage)}</td>
                <td>{n.categoryName}</td>
                <td>{n.studentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <FunnelDiagram
          funnel={funnel}
          events={scopedEvents}
          eventStudentSets={scopedEventStudentSets}
          attendanceDates={attendanceDates}
          allStudents={allStudents}
          onSelect={setSelection}
          onSelectEvent={setSelectedEventId}
        />
      )}

      <p className="text-faint" style={{ marginTop: 8 }}>
        Click a group to expand it into its individual events; click a flow or &quot;view roster&quot; to
        see the students behind it.
      </p>

      <div style={{ marginTop: 4 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('events')}>
          Manage groups on Programs &amp; Events →
        </button>
      </div>

      {selection && <FunnelDrillDrawer selection={selection} onClose={() => setSelection(null)} />}

      {selectedEventId && (
        <EventDetailDrawer
          eventId={selectedEventId}
          categories={categories}
          onClose={() => setSelectedEventId(null)}
          onDeleted={() => setSelectedEventId(null)}
          onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
        />
      )}
    </div>
  )
}

function BarList({ rows }: { rows: { label: string; count: number }[] }): React.JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.count))
  if (rows.length === 0) return <p className="text-dim">No data yet.</p>
  return (
    <div>
      {rows.map((r) => (
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

export default function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }): React.JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    window.api.getDashboardStats().then(setStats)
  }, [])

  if (!stats) return <div className="empty-state">Loading…</div>

  const noData = stats.totalStudents === 0

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>A deep-dive view into students and their pathways across programs.</p>
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
              <div className="stat-label">Unique students</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{stats.totalEvents}</div>
              <div className="stat-label">Programs / events</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{stats.repeatAttendeeCount}</div>
              <div className="stat-label">Repeat attendees</div>
              <div className="stat-sub">{Math.round(stats.repeatAttendeeRate * 100)}% of all students</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{stats.avgEventsPerStudent.toFixed(1)}</div>
              <div className="stat-label">Avg. events / student</div>
            </div>
          </div>

          {stats.pendingDuplicates > 0 && (
            <div className="card" style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span className="badge badge-warn">{stats.pendingDuplicates} pending</span>{' '}
                <span className="text-dim">possible duplicate student{stats.pendingDuplicates === 1 ? '' : 's'} need review</span>
              </div>
              <button className="btn btn-sm" onClick={() => onNavigate('duplicates')}>
                Review now
              </button>
            </div>
          )}

          <FunnelSection stats={stats} onNavigate={onNavigate} />

          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>
                By college
              </div>
              <BarList rows={stats.byCollege} />
            </div>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>
                By discipline / major
              </div>
              <BarList rows={stats.byDiscipline} />
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>
                By year in program
              </div>
              <BarList rows={stats.byYear} />
            </div>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>
                Top programs by attendance
              </div>
              <BarList rows={stats.topEvents.map((e) => ({ label: e.name, count: e.count }))} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

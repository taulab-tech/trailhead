import React, { useEffect, useMemo, useState } from 'react'
import type { EventCategory, EventRecord } from '../../../shared/types'
import EventDetailDrawer from '../components/EventDetailDrawer'
import { stageLabel } from '../lib/stageLabel'
import { seriesKeyFor } from '../lib/eventSeries'

type EventRow =
  | { kind: 'event'; event: EventRecord }
  | { kind: 'series'; key: string; label: string; events: EventRecord[] }

export default function EventsPage(): React.JSX.Element {
  const [events, setEvents] = useState<EventRecord[]>([])
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set())
  const [movingKey, setMovingKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const toggleSeries = (key: string): void => {
    setExpandedSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const moveSeries = async (rowKey: string, seriesEvents: EventRecord[], categoryId: string | null): Promise<void> => {
    setMovingKey(rowKey)
    await Promise.all(seriesEvents.map((e) => window.api.updateEvent(e.id, { categoryId })))
    refresh()
    setMovingKey(null)
  }

  const refresh = (): void => {
    setLoading(true)
    Promise.all([window.api.listEvents(), window.api.listCategories()]).then(([evs, cats]) => {
      setEvents(evs)
      setCategories(cats)
      setLoading(false)
    })
  }

  useEffect(refresh, [])

  const grouped = useMemo(() => {
    const filtered =
      filterCategoryId === 'all'
        ? events
        : filterCategoryId === 'none'
          ? events.filter((e) => !e.categoryId)
          : events.filter((e) => e.categoryId === filterCategoryId)

    const sorted = [...filtered].sort((a, b) => {
      const sa = a.categoryStage ?? 99
      const sb = b.categoryStage ?? 99
      if (sa !== sb) return sa - sb
      const ca = a.categoryName ?? 'zzz'
      const cb = b.categoryName ?? 'zzz'
      if (ca !== cb) return ca.localeCompare(cb)
      return a.name.localeCompare(b.name)
    })

    // Same-course/event offerings across years ("GE431 2023", "GE431 2024", …)
    // sort adjacently since their name only differs by the trailing year, so
    // folding consecutive same-series rows together here collapses them into
    // one row for viewing without losing the individual-year events.
    const groups: { label: string; rows: EventRow[] }[] = []
    for (const e of sorted) {
      const label = e.categoryName ? `${e.categoryName} · ${stageLabel(e.categoryStage)}` : 'Uncategorized'
      let group = groups[groups.length - 1]
      if (!group || group.label !== label) {
        group = { label, rows: [] }
        groups.push(group)
      }

      const seriesKey = seriesKeyFor(e.name)
      const lastRow = group.rows[group.rows.length - 1]
      if (lastRow && lastRow.kind === 'series' && lastRow.key === seriesKey) {
        lastRow.events.push(e)
      } else if (lastRow && lastRow.kind === 'event' && seriesKeyFor(lastRow.event.name) === seriesKey) {
        group.rows[group.rows.length - 1] = {
          kind: 'series',
          key: seriesKey,
          label: seriesKey,
          events: [lastRow.event, e]
        }
      } else {
        group.rows.push({ kind: 'event', event: e })
      }
    }
    return groups
  }, [events, filterCategoryId])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Programs &amp; Events</h1>
          <p>{events.length} imported roster{events.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="toolbar">
        <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="all">All groups</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({stageLabel(c.stageOrder)})
            </option>
          ))}
          <option value="none">Uncategorized</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : events.length === 0 ? (
          <div className="empty-state">No events yet. Import a spreadsheet to create one.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Source</th>
                <th>Attendees</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => (
                <React.Fragment key={group.label}>
                  <tr>
                    <td colSpan={4} className="text-dim" style={{ background: 'var(--bg-elevated-2)', fontWeight: 600 }}>
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((row) => {
                    if (row.kind === 'event') {
                      const e = row.event
                      return (
                        <tr key={e.id} onClick={() => setSelectedId(e.id)}>
                          <td>
                            <strong>{e.name}</strong>
                          </td>
                          <td className="text-dim">{e.date ?? '—'}</td>
                          <td className="text-faint">{e.sourceFile ?? '—'}</td>
                          <td>
                            <span className="chip">{e.attendeeCount}</span>
                          </td>
                        </tr>
                      )
                    }

                    const rowKey = `${group.label}::${row.key}`
                    const isOpen = expandedSeries.has(rowKey)
                    const total = row.events.reduce((sum, e) => sum + e.attendeeCount, 0)
                    const firstYear = row.events[0]?.date?.slice(0, 4)
                    const lastYear = row.events[row.events.length - 1]?.date?.slice(0, 4)
                    return (
                      <React.Fragment key={rowKey}>
                        <tr onClick={() => toggleSeries(rowKey)} style={{ cursor: 'pointer' }}>
                          <td>
                            <strong>
                              {isOpen ? '▾' : '▸'} {row.label}
                            </strong>
                            <span className="text-faint" style={{ marginLeft: 8 }}>
                              {row.events.length} offerings
                            </span>
                          </td>
                          <td className="text-dim">
                            {firstYear && lastYear ? `${firstYear}–${lastYear}` : '—'}
                          </td>
                          <td onClick={(e) => e.stopPropagation()} className="text-faint">
                            move all to:{' '}
                            <select
                              value={row.events[0]?.categoryId ?? ''}
                              disabled={movingKey === row.key}
                              onChange={(e) => moveSeries(row.key, row.events, e.target.value || null)}
                              style={{ maxWidth: 160 }}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className="chip">{total}</span>
                          </td>
                        </tr>
                        {isOpen &&
                          row.events.map((e) => (
                            <tr
                              key={e.id}
                              onClick={() => setSelectedId(e.id)}
                              style={{ background: 'var(--bg-elevated-2)' }}
                            >
                              <td style={{ paddingLeft: 28 }}>{e.name}</td>
                              <td className="text-dim">{e.date ?? '—'}</td>
                              <td className="text-faint">{e.sourceFile ?? '—'}</td>
                              <td>
                                <span className="chip">{e.attendeeCount}</span>
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && (
        <EventDetailDrawer
          eventId={selectedId}
          categories={categories}
          onClose={() => {
            setSelectedId(null)
            refresh()
          }}
          onDeleted={refresh}
          onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
        />
      )}
    </div>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import type { EventCategory, EventRecord } from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import { colorForIndex } from '../lib/palette'
import { seriesKeyFor } from '../lib/eventSeries'
import { trailStopLabel } from '../lib/stageLabel'
import { STANDARD_GROUPS } from '../../../shared/standardGroups'

type DragItem = { kind: 'group'; id: string } | { kind: 'events'; ids: string[] }

type DropTarget =
  | { kind: 'stage'; index: number }
  | { kind: 'gap'; index: number }
  | { kind: 'off' }
  | { kind: 'group'; id: string }
  | { kind: 'unassigned' }

interface EventSeries {
  key: string
  /** The series name for a multi-year series, or the event's own full name for a one-off. */
  label: string
  ids: string[]
}

const VISIBLE_SERIES = 6

/** Collapses each group's yearly offerings ("495 2021", "495 2022", …) into one draggable chip. */
function seriesFor(events: EventRecord[]): EventSeries[] {
  const map = new Map<string, EventRecord[]>()
  for (const e of events) {
    const key = seriesKeyFor(e.name)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return Array.from(map.entries())
    .map(([key, evs]) => ({ key, label: evs.length === 1 ? evs[0].name : key, ids: evs.map((e) => e.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

function GripIcon(): React.JSX.Element {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      {[2, 7, 12].map((y) => (
        <React.Fragment key={y}>
          <circle cx="2.5" cy={y} r="1.3" />
          <circle cx="7.5" cy={y} r="1.3" />
        </React.Fragment>
      ))}
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  )
}

export default function TrailPage(): React.JSX.Element {
  const { bump } = useDataVersion()
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = async (): Promise<void> => {
    const [cats, evs] = await Promise.all([window.api.listCategories(), window.api.listEvents()])
    setCategories(cats)
    setEvents(evs)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  // listCategories is ordered by stage then name — the same order the
  // dashboard's pathway diagram assigns colors in, so the dots here match it.
  const onTrail = categories.filter((c) => c.stageOrder !== null)
  const offTrail = categories.filter((c) => c.stageOrder === null)
  const colorById = new Map(onTrail.map((c, i) => [c.id, colorForIndex(i)]))

  const stages = useMemo(() => {
    const byStage = new Map<number, EventCategory[]>()
    for (const c of onTrail) {
      if (!byStage.has(c.stageOrder!)) byStage.set(c.stageOrder!, [])
      byStage.get(c.stageOrder!)!.push(c)
    }
    return Array.from(byStage.entries())
      .sort(([a], [b]) => a - b)
      .map(([, cats]) => cats)
  }, [categories])

  const eventsByCategory = useMemo(() => {
    const map = new Map<string | null, EventRecord[]>()
    for (const e of events) {
      if (!map.has(e.categoryId)) map.set(e.categoryId, [])
      map.get(e.categoryId)!.push(e)
    }
    return map
  }, [events])

  const unassigned = eventsByCategory.get(null) ?? []

  /** Writes stage numbers 1..n for the given stop layout; anything not in it goes off the trail. */
  const applyLayout = async (layout: string[][]): Promise<void> => {
    const desired = new Map<string, number | null>()
    layout
      .filter((stop) => stop.length > 0)
      .forEach((stop, i) => stop.forEach((id) => desired.set(id, i + 1)))
    const changed = categories.filter((c) => (desired.get(c.id) ?? null) !== c.stageOrder)
    await Promise.all(
      changed.map((c) => window.api.updateCategory(c.id, { stageOrder: desired.get(c.id) ?? null }))
    )
  }

  const moveGroup = async (id: string, target: DropTarget): Promise<void> => {
    // Empty stops are kept until applyLayout so target indices stay valid.
    const layout = stages.map((stop) => stop.map((c) => c.id).filter((x) => x !== id))
    if (target.kind === 'stage') layout[target.index].push(id)
    else if (target.kind === 'gap') layout.splice(target.index, 0, [id])
    await applyLayout(layout)
  }

  const moveEvents = async (ids: string[], categoryId: string | null): Promise<void> => {
    await Promise.all(ids.map((id) => window.api.updateEvent(id, { categoryId })))
  }

  const handleDrop = async (target: DropTarget): Promise<void> => {
    const item = drag
    setDrag(null)
    setOver(null)
    if (!item) return
    setBusy(true)
    try {
      if (item.kind === 'group') await moveGroup(item.id, target)
      else if (target.kind === 'group') await moveEvents(item.ids, target.id)
      else if (target.kind === 'unassigned') await moveEvents(item.ids, null)
      await refresh()
      bump()
    } finally {
      setBusy(false)
    }
  }

  const startDrag = (e: React.DragEvent, item: DragItem, label: string): void => {
    e.stopPropagation()
    e.dataTransfer.setData('text/plain', label)
    e.dataTransfer.effectAllowed = 'move'
    // Deferred: re-rendering (which reveals the "new stop" gaps) inside
    // dragstart itself makes Chromium cancel the drag.
    setTimeout(() => setDrag(item), 0)
  }

  const endDrag = (): void => {
    setDrag(null)
    setOver(null)
  }

  const dropProps = (key: string, target: DropTarget, accepts: DragItem['kind']) => ({
    onDragOver: (e: React.DragEvent) => {
      if (drag?.kind !== accepts) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver((current) => (current === key ? null : current))
    },
    onDrop: (e: React.DragEvent) => {
      if (drag?.kind !== accepts) return
      e.preventDefault()
      e.stopPropagation()
      handleDrop(target)
    }
  })

  const renameGroup = async (cat: EventCategory, name: string): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === cat.name) return
    await window.api.updateCategory(cat.id, { name: trimmed })
    await refresh()
    bump()
  }

  const deleteGroup = async (cat: EventCategory): Promise<void> => {
    const count = eventsByCategory.get(cat.id)?.length ?? 0
    const msg =
      count > 0
        ? `Delete "${cat.name}"? Its ${count} event${count === 1 ? '' : 's'} will be kept but left without a group.`
        : `Delete "${cat.name}"?`
    if (!confirm(msg)) return
    await window.api.deleteCategory(cat.id)
    await refresh()
    bump()
  }

  const addStandardGroups = async (): Promise<void> => {
    setBusy(true)
    try {
      for (const g of STANDARD_GROUPS) await window.api.createCategory(g.name, g.stageOrder)
      await refresh()
      bump()
    } finally {
      setBusy(false)
    }
  }

  const createGroup = async (): Promise<void> => {
    if (!newName.trim()) return
    await window.api.createCategory(newName.trim(), null)
    setNewName('')
    setAdding(false)
    await refresh()
    bump()
  }

  const renderCard = (cat: EventCategory): React.JSX.Element => (
    <GroupCard
      key={cat.id}
      cat={cat}
      color={colorById.get(cat.id) ?? null}
      series={seriesFor(eventsByCategory.get(cat.id) ?? [])}
      eventCount={eventsByCategory.get(cat.id)?.length ?? 0}
      isDragging={drag?.kind === 'group' && drag.id === cat.id}
      isTarget={over === `group:${cat.id}`}
      onDragStart={(e) => startDrag(e, { kind: 'group', id: cat.id }, cat.name)}
      onDragEnd={endDrag}
      onEventDragStart={(e, s) => startDrag(e, { kind: 'events', ids: s.ids }, s.label)}
      onRename={(name) => renameGroup(cat, name)}
      onDelete={() => deleteGroup(cat)}
      dropProps={dropProps(`group:${cat.id}`, { kind: 'group', id: cat.id }, 'events')}
    />
  )

  const draggingGroup = drag?.kind === 'group'
  const draggingEvents = drag?.kind === 'events'

  return (
    <div className={`trail-page ${busy ? 'is-busy' : ''}`}>
      <div className="page-header">
        <div>
          <h1>The Trail</h1>
          <p>
            The path students take through SIGMA, from their first event to the program itself. Drag a group
            to move it to another stop, or drag an event onto a different group.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          New group
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : categories.length === 0 && !adding ? (
        <div className="card trail-start">
          <div className="trail-start-mark">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 20L9 6l4.5 7.5L16 10l6 10z" />
            </svg>
          </div>
          <h2>Your trail is empty</h2>
          <p>
            Groups are the stops on a student’s path through SIGMA. Start with the usual trail and adjust it,
            or build your own from scratch.
          </p>
          <div className="trail-start-preview" aria-label="Standard trail preview">
            {[
              ['1', 'Hackathon · Inspiration Event'],
              ['2', 'Class'],
              ['3', 'SIGMA']
            ].map(([n, label], i) => (
              <React.Fragment key={n}>
                {i > 0 && <span className="trail-start-dash" />}
                <span className="trail-start-stop">
                  <span className="trail-start-num">{n}</span>
                  {label}
                </span>
              </React.Fragment>
            ))}
          </div>
          <div className="trail-start-actions">
            <button className="btn btn-primary" onClick={addStandardGroups}>
              Add standard groups
            </button>
            <button className="btn" onClick={() => setAdding(true)}>
              Create my own
            </button>
          </div>
          <p className="trail-start-note">Social and Other are added too, off the trail.</p>
        </div>
      ) : (
        <>
          {categories.length > 0 && (
            <div className="card trail-card-surface">
              <div className={`trail ${draggingGroup ? 'is-dragging-group' : ''}`}>
                <div className="trail-track">
                  <div className="trail-line" />
                  {stages.map((stop, i) => (
                    <React.Fragment key={stop.map((c) => c.id).join('|')}>
                      <div
                        className={`trail-gap ${over === `gap:${i}` ? 'is-target' : ''}`}
                        {...dropProps(`gap:${i}`, { kind: 'gap', index: i }, 'group')}
                      >
                        <div className="trail-marker trail-marker-new">+</div>
                      </div>
                      <div className="trail-stop">
                        <div className="trail-marker">{i + 1}</div>
                        <div className="trail-stop-label">{trailStopLabel(i, stages.length)}</div>
                        <div
                          className={`trail-dropzone ${over === `stage:${i}` ? 'is-target' : ''}`}
                          {...dropProps(`stage:${i}`, { kind: 'stage', index: i }, 'group')}
                        >
                          {stop.map(renderCard)}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                  <div className="trail-stop is-new">
                    <div className="trail-marker trail-marker-new">+</div>
                    <div className="trail-stop-label">New stop</div>
                    <div
                      className={`trail-dropzone trail-dropzone-new ${over === 'gap:end' ? 'is-target' : ''}`}
                      {...dropProps('gap:end', { kind: 'gap', index: stages.length }, 'group')}
                    >
                      <span>Drag a group here to add a stop at the end of the trail</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card trail-off">
            <div className="trail-off-head">
              <div>
                <div className="section-title" style={{ margin: 0 }}>
                  Off the trail
                </div>
                <p className="text-dim" style={{ margin: '4px 0 0' }}>
                  Groups here aren’t part of the pathway. Drag one onto a stop to add it.
                </p>
              </div>
            </div>
            <div
              className={`trail-off-grid ${draggingGroup ? 'is-armed' : ''} ${over === 'off' ? 'is-target' : ''}`}
              {...dropProps('off', { kind: 'off' }, 'group')}
            >
              {offTrail.map(renderCard)}
              {adding && (
                <div className="trail-card trail-card-new">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Group name, e.g. Capstone"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createGroup()
                      if (e.key === 'Escape') setAdding(false)
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" disabled={!newName.trim()} onClick={createGroup}>
                      Add group
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {offTrail.length === 0 && !adding && (
                <div className="trail-empty">Every group is on the trail.</div>
              )}
            </div>

            {(unassigned.length > 0 || draggingEvents) && (
              <>
                <div className="section-title">Events without a group</div>
                <div
                  className={`trail-unassigned ${draggingEvents ? 'is-armed' : ''} ${over === 'unassigned' ? 'is-target' : ''}`}
                  {...dropProps('unassigned', { kind: 'unassigned' }, 'events')}
                >
                  {seriesFor(unassigned).map((s) => (
                    <EventChip
                      key={s.key}
                      series={s}
                      onDragStart={(e) => startDrag(e, { kind: 'events', ids: s.ids }, s.label)}
                      onDragEnd={endDrag}
                    />
                  ))}
                  {unassigned.length === 0 && <span className="text-faint">Drop an event here to remove it from its group</span>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function EventChip({
  series,
  onDragStart,
  onDragEnd
}: {
  series: EventSeries
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}): React.JSX.Element {
  return (
    <span
      className="trail-event"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={series.ids.length > 1 ? `${series.ids.length} offerings — drag to move them all` : 'Drag to another group'}
    >
      {series.label}
      {series.ids.length > 1 && <span className="trail-event-count">×{series.ids.length}</span>}
    </span>
  )
}

function GroupCard({
  cat,
  color,
  series,
  eventCount,
  isDragging,
  isTarget,
  onDragStart,
  onDragEnd,
  onEventDragStart,
  onRename,
  onDelete,
  dropProps
}: {
  cat: EventCategory
  color: string | null
  series: EventSeries[]
  eventCount: number
  isDragging: boolean
  isTarget: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onEventDragStart: (e: React.DragEvent, s: EventSeries) => void
  onRename: (name: string) => void
  onDelete: () => void
  dropProps: React.HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cat.name)
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? series : series.slice(0, VISIBLE_SERIES)
  const hidden = series.length - shown.length

  const commit = (): void => {
    setEditing(false)
    onRename(draft)
  }

  return (
    <div
      className={`trail-card ${isDragging ? 'is-dragging' : ''} ${isTarget ? 'is-target' : ''}`}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...dropProps}
    >
      <div className="trail-card-head">
        <span className="trail-grip">
          <GripIcon />
        </span>
        <span className="trail-dot" style={{ background: color ?? 'var(--border)' }} />
        {editing ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(cat.name)
                setEditing(false)
              }
            }}
            className="trail-card-input"
          />
        ) : (
          <span
            className="trail-card-name"
            title="Click to rename"
            onClick={() => {
              setDraft(cat.name)
              setEditing(true)
            }}
          >
            {cat.name}
          </span>
        )}
        <button className="trail-icon-btn" title={`Delete ${cat.name}`} onClick={onDelete}>
          <TrashIcon />
        </button>
      </div>
      <div className="trail-card-meta">
        {eventCount === 0 ? 'No events yet' : `${eventCount} event${eventCount === 1 ? '' : 's'}`}
      </div>
      {series.length > 0 && (
        <div className="trail-events">
          {shown.map((s) => (
            <EventChip key={s.key} series={s} onDragStart={(e) => onEventDragStart(e, s)} onDragEnd={onDragEnd} />
          ))}
          {hidden > 0 && (
            <button className="trail-more" onClick={() => setExpanded(true)}>
              +{hidden} more
            </button>
          )}
          {expanded && series.length > VISIBLE_SERIES && (
            <button className="trail-more" onClick={() => setExpanded(false)}>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}

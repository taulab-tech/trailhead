import React, { useMemo, useRef, useState } from 'react'
import type { AttendanceDate, EventRecord, FunnelStats, Student } from '../../../shared/types'
import { stageLabel, trailStopLabel } from '../lib/stageLabel'
import { colorForIndex } from '../lib/palette'
import { seriesKeyFor } from '../lib/eventSeries'
import type { FunnelSelection } from './FunnelDrillDrawer'

const WIDTH = 880
const BASE_PLOT_HEIGHT = 332
const TOP_MARGIN = 44
const BOTTOM_MARGIN = 14
const SIDE_MARGIN = 175
const NODE_WIDTH = 18
const NODE_GAP = 16
const MIN_NODE_HEIGHT = 18
const MIN_LABEL_HEIGHT = 15

interface Tooltip {
  x: number
  y: number
  lines: string[]
}

interface LogicalNode {
  key: string
  kind: 'category' | 'series' | 'event'
  categoryId: string
  categoryName: string
  eventId?: string
  /** Set only for kind 'series': `${categoryId}::${seriesKey}`, and its constituent events. */
  seriesId?: string
  seriesEvents?: EventRecord[]
  label: string
  stage: number
  studentIds: Set<string>
  expandable: boolean
}

interface NodeLayout extends LogicalNode {
  columnIndex: number
  x: number
  yTop: number
  yBottom: number
  color: string
}

function ribbonPath(x0: number, y0top: number, y0bot: number, x1: number, y1top: number, y1bot: number): string {
  const cx = (x0 + x1) / 2
  return `M${x0},${y0top} C${cx},${y0top} ${cx},${y1top} ${x1},${y1top} L${x1},${y1bot} C${cx},${y1bot} ${cx},${y0bot} ${x0},${y0bot} Z`
}

function ArrowTriangle({
  x,
  y,
  dir,
  color
}: {
  x: number
  y: number
  dir: 'left' | 'right'
  color: string
}): React.JSX.Element {
  const w = 6
  const h = 5
  const tipX = dir === 'right' ? x + w : x - w
  return (
    <polygon
      points={`${x},${y - h} ${x},${y + h} ${tipX},${y}`}
      fill={color}
      style={{ pointerEvents: 'none' }}
    />
  )
}

export default function FunnelDiagram({
  funnel,
  events,
  eventStudentSets,
  attendanceDates,
  allStudents,
  onSelect,
  onSelectEvent
}: {
  funnel: FunnelStats
  events: EventRecord[]
  eventStudentSets: { eventId: string; studentIds: string[] }[]
  attendanceDates: AttendanceDate[]
  allStudents: Student[]
  onSelect: (selection: FunnelSelection) => void
  onSelectEvent: (eventId: string) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const resolved = useMemo(() => {
    const studentsById = new Map(allStudents.map((s) => [s.id, s]))
    const idsByEvent = new Map(eventStudentSets.map((e) => [e.eventId, new Set(e.studentIds)]))
    const eventsByCategory = new Map<string, EventRecord[]>()
    for (const e of events) {
      if (!e.categoryId || e.attendeeCount === 0) continue
      if (!eventsByCategory.has(e.categoryId)) eventsByCategory.set(e.categoryId, [])
      eventsByCategory.get(e.categoryId)!.push(e)
    }
    for (const list of eventsByCategory.values()) {
      list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.name.localeCompare(b.name))
    }

    // Real or inferred date per (student, event) — lets the diagram below
    // draw ribbons in the direction students actually went, instead of
    // always assuming the fixed stage order.
    const dateByStudentEvent = new Map<string, string>()
    for (const d of attendanceDates) dateByStudentEvent.set(`${d.studentId}:${d.eventId}`, d.date)

    // A collapsed node (category or series) represents the union of its
    // events, so a student's "date" there is the earliest known date across
    // whichever of those events they attended.
    function earliestDatePerStudent(evList: EventRecord[]): Map<string, string> {
      const perStudent = new Map<string, string>()
      for (const ev of evList) {
        for (const studentId of idsByEvent.get(ev.id) ?? []) {
          const d = dateByStudentEvent.get(`${studentId}:${ev.id}`)
          if (d && (!perStudent.has(studentId) || d < perStudent.get(studentId)!)) {
            perStudent.set(studentId, d)
          }
        }
      }
      return perStudent
    }

    const earliestDateByCategory = new Map<string, Map<string, string>>()
    for (const [categoryId, catEvents] of eventsByCategory) {
      earliestDateByCategory.set(categoryId, earliestDatePerStudent(catEvents))
    }

    // Same course/event recurring across years ("GE431 2023", "GE431 2024",
    // "Agtech Hackathon 2025", …) gets folded into one "series" per distinct
    // stripped-year name, so expanding a category shows one node per
    // course/event instead of one per year — the split-by-year importer
    // logic still creates the individual year events underneath.
    const seriesByCategory = new Map<string, Map<string, EventRecord[]>>()
    const earliestDateBySeries = new Map<string, Map<string, string>>()
    for (const [categoryId, catEvents] of eventsByCategory) {
      const seriesMap = new Map<string, EventRecord[]>()
      for (const ev of catEvents) {
        const key = seriesKeyFor(ev.name)
        if (!seriesMap.has(key)) seriesMap.set(key, [])
        seriesMap.get(key)!.push(ev)
      }
      seriesByCategory.set(categoryId, seriesMap)
      for (const [seriesKey, seriesEvents] of seriesMap) {
        earliestDateBySeries.set(`${categoryId}::${seriesKey}`, earliestDatePerStudent(seriesEvents))
      }
    }

    return {
      studentsById,
      idsByEvent,
      eventsByCategory,
      dateByStudentEvent,
      earliestDateByCategory,
      seriesByCategory,
      earliestDateBySeries
    }
  }, [allStudents, eventStudentSets, events, attendanceDates])

  const toggleExpand = (categoryId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const layout = useMemo(() => {
    const { stages, nodes } = funnel
    if (stages.length === 0 || nodes.every((n) => n.studentCount === 0)) return null

    function dateForNodeStudent(n: LogicalNode, studentId: string): string | null {
      if (n.kind === 'event') {
        return resolved.dateByStudentEvent.get(`${studentId}:${n.eventId}`) ?? null
      }
      if (n.kind === 'series') {
        return resolved.earliestDateBySeries.get(n.seriesId!)?.get(studentId) ?? null
      }
      return resolved.earliestDateByCategory.get(n.categoryId)?.get(studentId) ?? null
    }

    const plotWidth = WIDTH - SIDE_MARGIN * 2
    const columnX = (i: number): number =>
      stages.length === 1 ? SIDE_MARGIN : SIDE_MARGIN + (plotWidth * i) / (stages.length - 1)

    // Build the logical nodes actually on screen for each stage, honoring
    // which categories are currently expanded. Expanding shows one node per
    // course/event *series* rather than one per year — "GE431 2023" and
    // "GE431 2024" collapse into a single "GE431" node — since a course
    // recurring over six years would otherwise turn "expand" into an
    // unreadable wall of near-duplicate nodes.
    const logicalColumns: LogicalNode[][] = stages.map((stage) => {
      const cats = nodes.filter((n) => n.stage === stage && n.studentCount > 0)
      const result: LogicalNode[] = []
      for (const cat of cats) {
        const catEvents = resolved.eventsByCategory.get(cat.categoryId) ?? []
        if (expanded.has(cat.categoryId) && catEvents.length > 1) {
          const seriesMap = resolved.seriesByCategory.get(cat.categoryId) ?? new Map<string, EventRecord[]>()
          for (const [seriesKey, seriesEvents] of seriesMap) {
            const union = new Set<string>()
            for (const ev of seriesEvents) for (const id of resolved.idsByEvent.get(ev.id) ?? []) union.add(id)
            if (union.size === 0) continue

            if (seriesEvents.length === 1) {
              // Only one offering exists for this course/event — show it as
              // a normal event node (with its year) rather than a series.
              const ev = seriesEvents[0]
              result.push({
                key: `event:${ev.id}`,
                kind: 'event',
                categoryId: cat.categoryId,
                categoryName: cat.categoryName,
                eventId: ev.id,
                label: ev.name,
                stage,
                studentIds: union,
                expandable: false
              })
            } else {
              result.push({
                key: `series:${cat.categoryId}::${seriesKey}`,
                kind: 'series',
                categoryId: cat.categoryId,
                categoryName: cat.categoryName,
                seriesId: `${cat.categoryId}::${seriesKey}`,
                seriesEvents,
                label: seriesKey,
                stage,
                studentIds: union,
                expandable: false
              })
            }
          }
        } else {
          const union = new Set<string>()
          for (const ev of catEvents) for (const id of resolved.idsByEvent.get(ev.id) ?? []) union.add(id)
          result.push({
            key: `category:${cat.categoryId}`,
            kind: 'category',
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            label: cat.categoryName,
            stage,
            studentIds: union,
            expandable: catEvents.length > 1
          })
        }
      }
      return result
    })

    const columnTotals = logicalColumns.map((col) => col.reduce((sum, n) => sum + n.studentIds.size, 0))
    const maxTotal = Math.max(...columnTotals, 1)

    // The plot area has to grow to fit whatever's currently expanded — a
    // fixed height would either clip content or leave dead space. Each
    // column's rendered height is sum(max(count*scale, MIN_NODE_HEIGHT)) +
    // gaps, which depends on plotHeight through scale, so grow plotHeight
    // iteratively until every column actually fits inside it.
    let plotHeight = BASE_PLOT_HEIGHT
    for (let i = 0; i < 6; i++) {
      const scale = plotHeight / maxTotal
      const neededHeights = logicalColumns.map(
        (col) =>
          col.reduce((sum, n) => sum + Math.max(n.studentIds.size * scale, MIN_NODE_HEIGHT), 0) +
          NODE_GAP * Math.max(col.length - 1, 0)
      )
      const needed = Math.max(plotHeight, ...neededHeights)
      if (needed === plotHeight) break
      plotHeight = needed
    }
    const scale = plotHeight / maxTotal

    const nodeLayouts = new Map<string, NodeLayout>()
    logicalColumns.forEach((col, columnIndex) => {
      const heights = col.map((n) => Math.max(n.studentIds.size * scale, MIN_NODE_HEIGHT))
      const totalHeight = heights.reduce((a, b) => a + b, 0) + NODE_GAP * Math.max(col.length - 1, 0)
      let y = TOP_MARGIN + (plotHeight - totalHeight) / 2
      col.forEach((n, i) => {
        const h = heights[i]
        const colorIndex = nodes.findIndex((x) => x.categoryId === n.categoryId)
        nodeLayouts.set(n.key, {
          ...n,
          columnIndex,
          x: columnX(columnIndex),
          yTop: y,
          yBottom: y + h,
          color: colorForIndex(colorIndex)
        })
        y += h + NODE_GAP
      })
    })

    // Flows between EVERY pair of columns with i < j, not just adjacent ones
    // — a student can go Hackathon straight to SIGMA, skipping Class
    // entirely, and that needs its own traceable line rather than being
    // lumped in with students who have no tracked history at all.
    interface Flow {
      from: NodeLayout
      to: NodeLayout
      count: number
      ids: string[]
      skip: boolean
      direction: 'forward' | 'reverse'
      uncertainCount: number
    }
    const flows: Flow[] = []
    for (let i = 0; i < logicalColumns.length; i++) {
      for (let j = i + 1; j < logicalColumns.length; j++) {
        for (const a of logicalColumns[i]) {
          const layoutA = nodeLayouts.get(a.key)!
          for (const b of logicalColumns[j]) {
            const layoutB = nodeLayouts.get(b.key)!
            const ids = Array.from(a.studentIds).filter((id) => b.studentIds.has(id))
            if (ids.length === 0) continue

            // Split by what the real/inferred dates say actually happened —
            // most students have no contradicting evidence and are drawn
            // forward as before; a minority may have gone the other way.
            const forwardIds: string[] = []
            const reverseIds: string[] = []
            let uncertainCount = 0
            for (const id of ids) {
              const dA = dateForNodeStudent(a, id)
              const dB = dateForNodeStudent(b, id)
              if (dA && dB && dA > dB) {
                reverseIds.push(id)
              } else {
                forwardIds.push(id)
                if (!dA || !dB) uncertainCount++
              }
            }
            if (forwardIds.length > 0) {
              flows.push({
                from: layoutA,
                to: layoutB,
                count: forwardIds.length,
                ids: forwardIds,
                skip: j > i + 1,
                direction: 'forward',
                uncertainCount
              })
            }
            if (reverseIds.length > 0) {
              flows.push({
                from: layoutA,
                to: layoutB,
                count: reverseIds.length,
                ids: reverseIds,
                skip: j > i + 1,
                direction: 'reverse',
                uncertainCount: 0
              })
            }
          }
        }
      }
    }

    // Anything in a non-entry node that didn't arrive via any tracked
    // incoming flow "entered directly" at that stage — still real people,
    // just without an earlier tracked event to draw a ribbon from.
    const directEntryIds = new Map<string, string[]>()
    for (const col of logicalColumns.slice(1)) {
      for (const n of col) {
        const trackedIncoming = new Set(flows.filter((f) => f.to.key === n.key).flatMap((f) => f.ids))
        const direct = Array.from(n.studentIds).filter((id) => !trackedIncoming.has(id))
        if (direct.length > 0) directEntryIds.set(n.key, direct)
      }
    }

    const outgoingSlices = new Map<string, { flow: Flow; y0: number; y1: number }[]>()
    const incomingSlices = new Map<string, { flow: Flow; y0: number; y1: number }[]>()
    const directSlices = new Map<string, { ids: string[]; y0: number; y1: number }>()
    for (const node of nodeLayouts.values()) {
      const outFlows = flows
        .filter((f) => f.from.key === node.key)
        .sort((a, b) => a.to.yTop - b.to.yTop)
      let y = node.yTop
      outgoingSlices.set(
        node.key,
        outFlows.map((f) => {
          const h = f.count * scale
          const slice = { flow: f, y0: y, y1: y + h }
          y += h
          return slice
        })
      )

      const inFlows = flows.filter((f) => f.to.key === node.key).sort((a, b) => a.from.yTop - b.from.yTop)
      let yIn = node.yTop
      incomingSlices.set(
        node.key,
        inFlows.map((f) => {
          const h = f.count * scale
          const slice = { flow: f, y0: yIn, y1: yIn + h }
          yIn += h
          return slice
        })
      )

      const direct = directEntryIds.get(node.key)
      if (direct) {
        const h = direct.length * scale
        directSlices.set(node.key, { ids: direct, y0: yIn, y1: yIn + h })
      }
    }

    const ribbons = flows.map((f) => {
      const sSlice = outgoingSlices.get(f.from.key)!.find((s) => s.flow === f)!
      const tSlice = incomingSlices.get(f.to.key)!.find((s) => s.flow === f)!
      // Reverse flows connect the same two node slices geometrically — only
      // the arrow direction flips, at the edge nearer the earlier column, to
      // signal these students actually went backwards relative to it.
      const arrow =
        f.direction === 'reverse'
          ? { x: f.from.x + NODE_WIDTH, y: (sSlice.y0 + sSlice.y1) / 2, dir: 'left' as const }
          : { x: f.to.x, y: (tSlice.y0 + tSlice.y1) / 2, dir: 'right' as const }
      return {
        flow: f,
        path: ribbonPath(f.from.x + NODE_WIDTH, sSlice.y0, sSlice.y1, f.to.x, tSlice.y0, tSlice.y1),
        arrow
      }
    })

    // Category header positions for expanded groups (drawn above the stack).
    const groupHeaders = logicalColumns.flatMap((col) => {
      const byCategory = new Map<string, NodeLayout[]>()
      for (const n of col) {
        const layoutN = nodeLayouts.get(n.key)!
        if (n.kind === 'category') continue
        if (!byCategory.has(n.categoryId)) byCategory.set(n.categoryId, [])
        byCategory.get(n.categoryId)!.push(layoutN)
      }
      return Array.from(byCategory.entries()).map(([categoryId, members]) => ({
        categoryId,
        categoryName: members[0].categoryName,
        x: members[0].x,
        columnIndex: members[0].columnIndex,
        yTop: Math.min(...members.map((m) => m.yTop)),
        studentIds: new Set(members.flatMap((m) => Array.from(m.studentIds)))
      }))
    })

    return {
      nodeLayouts: Array.from(nodeLayouts.values()),
      ribbons,
      stages,
      columnX,
      groupHeaders,
      directSlices,
      svgHeight: TOP_MARGIN + plotHeight + BOTTOM_MARGIN
    }
  }, [funnel, resolved, expanded])

  const showTooltip = (e: React.MouseEvent, lines: string[]): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, lines })
  }

  const selectStudents = (title: string, ids: Iterable<string>, events?: EventRecord[]): void => {
    const students = Array.from(ids)
      .map((id) => resolved.studentsById.get(id))
      .filter((s): s is Student => !!s)
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
    onSelect({ title, students, events })
  }

  if (!layout) {
    return (
      <div className="empty-state">
        No groups are on the trail yet. Place groups on The Trail page to see the pathway map
        here.
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${layout.svgHeight}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {layout.stages.map((stage, i) => (
          <text
            key={stage}
            x={layout.columnX(i) + NODE_WIDTH / 2}
            y={18}
            textAnchor="middle"
            fill="var(--text-dim)"
            fontSize="12"
            fontWeight={600}
          >
            {trailStopLabel(i, layout.stages.length).toUpperCase()}
          </text>
        ))}

        {[...layout.ribbons]
          .sort(
            (a, b) =>
              Number(b.flow.direction === 'reverse') - Number(a.flow.direction === 'reverse') ||
              Number(b.flow.skip) - Number(a.flow.skip)
          )
          .map((r) => {
            const reverse = r.flow.direction === 'reverse'
            const color = reverse ? 'var(--danger)' : r.flow.from.color
            const dashed = reverse || r.flow.skip
            const label = reverse
              ? `${r.flow.to.label} → ${r.flow.from.label}`
              : `${r.flow.from.label} → ${r.flow.to.label}`
            const detail = reverse
              ? `${r.flow.count} student${r.flow.count === 1 ? '' : 's'} went this way first, confirmed by date · click to view`
              : r.flow.uncertainCount > 0
                ? `${r.flow.count} student${r.flow.count === 1 ? '' : 's'} · ${r.flow.count - r.flow.uncertainCount} confirmed by date, ${r.flow.uncertainCount} assumed · click to view`
                : `${r.flow.count} student${r.flow.count === 1 ? '' : 's'} · click to view`
            return (
              <g key={`${r.flow.from.key}->${r.flow.to.key}-${r.flow.direction}`}>
                <path
                  d={r.path}
                  fill={color}
                  fillOpacity={reverse ? 0.28 : r.flow.skip ? 0.2 : 0.32}
                  stroke={dashed ? color : 'none'}
                  strokeWidth={dashed ? 1 : 0}
                  strokeDasharray={dashed ? '4 3' : undefined}
                  onMouseMove={(e) =>
                    showTooltip(e, [
                      reverse
                        ? `${label} (out of the usual order)`
                        : r.flow.skip
                          ? `${label} (skips the middle stage)`
                          : label,
                      detail
                    ])
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => selectStudents(label, r.flow.ids)}
                  style={{ cursor: 'pointer' }}
                />
                <ArrowTriangle x={r.arrow.x} y={r.arrow.y} dir={r.arrow.dir} color={color} />
              </g>
            )
          })}

        {layout.nodeLayouts.map((n) => {
          const direct = layout.directSlices.get(n.key)
          if (!direct) return null
          const stubX0 = n.x - 26
          return (
            <path
              key={`direct-${n.key}`}
              d={ribbonPath(stubX0, direct.y0, direct.y1, n.x, direct.y0, direct.y1)}
              fill="var(--text-faint)"
              fillOpacity={0.35}
              stroke="none"
              onMouseMove={(e) =>
                showTooltip(e, [
                  `Entered directly at ${n.kind === 'event' ? n.label : stageLabel(n.stage)}`,
                  `${direct.ids.length} student${direct.ids.length === 1 ? '' : 's'} · no earlier tracked event · click to view`
                ])
              }
              onMouseLeave={() => setTooltip(null)}
              onClick={() =>
                selectStudents(`Entered directly at ${n.label}`, direct.ids)
              }
              style={{ cursor: 'pointer' }}
            />
          )
        })}

        {layout.nodeLayouts.map((n) => {
          const outgoing = layout.ribbons
            .filter((r) => r.flow.from.key === n.key)
            .reduce((sum, r) => sum + r.flow.count, 0)
          const dropOff = n.studentIds.size - outgoing
          const height = Math.max(n.yBottom - n.yTop, 1)
          const showLabel = height >= MIN_LABEL_HEIGHT
          const isCategory = n.kind === 'category'

          const handleClick = (): void => {
            if (n.kind === 'event') {
              onSelectEvent(n.eventId!)
            } else if (n.kind === 'series') {
              selectStudents(n.label, n.studentIds, n.seriesEvents)
            } else if (n.expandable) {
              toggleExpand(n.categoryId)
            } else {
              const catEvents = resolved.eventsByCategory.get(n.categoryId) ?? []
              if (catEvents.length === 1) onSelectEvent(catEvents[0].id)
            }
          }

          const tooltipLines =
            n.kind === 'event'
              ? [`${n.label}: ${n.studentIds.size} student${n.studentIds.size === 1 ? '' : 's'}`, 'click to view event']
              : n.kind === 'series'
                ? [
                    `${n.label}: ${n.studentIds.size} student${n.studentIds.size === 1 ? '' : 's'}`,
                    `${n.seriesEvents!.length} offerings · click to view roster`
                  ]
                : [
                    `${n.label}: ${n.studentIds.size} student${n.studentIds.size === 1 ? '' : 's'}`,
                    n.expandable
                      ? `${outgoing} continued on · ${dropOff} did not · click to expand`
                      : `${outgoing} continued on · ${dropOff} did not`
                  ]

          return (
            <g key={n.key}>
              <rect
                x={n.x}
                y={n.yTop}
                width={NODE_WIDTH}
                height={height}
                rx={4}
                fill={n.color}
                fillOpacity={n.kind === 'category' ? 1 : 0.85}
                onMouseMove={(e) => showTooltip(e, tooltipLines)}
                onMouseLeave={() => setTooltip(null)}
                onClick={handleClick}
                style={{ cursor: 'pointer' }}
              />
              {showLabel && (
                <>
                  <text
                    x={n.columnIndex === 0 ? n.x - 8 : n.x + NODE_WIDTH + 8}
                    y={(n.yTop + n.yBottom) / 2 - 6}
                    textAnchor={n.columnIndex === 0 ? 'end' : 'start'}
                    fill="var(--text)"
                    fontSize={n.kind === 'category' ? 12 : 11}
                    fontWeight={600}
                  >
                    {n.label}
                  </text>
                  <text
                    x={n.columnIndex === 0 ? n.x - 8 : n.x + NODE_WIDTH + 8}
                    y={(n.yTop + n.yBottom) / 2 + 9}
                    textAnchor={n.columnIndex === 0 ? 'end' : 'start'}
                    fill="var(--text-faint)"
                    fontSize="10.5"
                  >
                    {n.studentIds.size} student{n.studentIds.size === 1 ? '' : 's'}
                    {isCategory && n.expandable ? ' · click to expand' : ''}
                    {n.kind === 'series' ? ` · ${n.seriesEvents!.length} offerings` : ''}
                  </text>
                </>
              )}
              {isCategory && (
                <text
                  x={n.columnIndex === 0 ? n.x - 8 : n.x + NODE_WIDTH + 8}
                  y={(n.yTop + n.yBottom) / 2 + (showLabel ? 22 : 4)}
                  textAnchor={n.columnIndex === 0 ? 'end' : 'start'}
                  fill="var(--accent)"
                  fontSize="10"
                  fontWeight={600}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectStudents(
                      `${n.label} · ${stageLabel(n.stage)}`,
                      n.studentIds,
                      resolved.eventsByCategory.get(n.categoryId) ?? []
                    )
                  }}
                >
                  view roster →
                </text>
              )}
            </g>
          )
        })}

        {layout.groupHeaders.map((h) => (
          <g
            key={`header-${h.categoryId}`}
            onClick={() => toggleExpand(h.categoryId)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={h.columnIndex === 0 ? h.x - 130 : h.x - 12}
              y={h.yTop - 20}
              width={130}
              height={16}
              fill="transparent"
              style={{ pointerEvents: 'all' }}
            />
            <text
              x={h.columnIndex === 0 ? h.x - 8 : h.x + NODE_WIDTH + 8}
              y={h.yTop - 8}
              textAnchor={h.columnIndex === 0 ? 'end' : 'start'}
              fill="var(--accent)"
              fontSize="11"
              fontWeight={700}
            >
              ▾ {h.categoryName} (collapse)
            </text>
          </g>
        ))}
      </svg>

      {tooltip && (
        <div
          className="toast"
          style={{
            position: 'absolute',
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10
          }}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} style={i === 0 ? { fontWeight: 600 } : { color: 'var(--text-dim)' }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

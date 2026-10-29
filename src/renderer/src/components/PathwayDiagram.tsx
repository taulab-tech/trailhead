import React from 'react'
import { pathLinks, type Journey } from '../../../shared/journeys'
import { trailStopLabel } from '../lib/stageLabel'

export type DiagramFocus = { kind: 'stop'; stop: number } | { kind: 'link'; from: number; to: number }

const W = 1000
const MARGIN_X = 80
const NODE_W = 14
const MAX_NODE_H = 150
const CENTER_Y = 130
const FORWARD = '#2e7d5b'
const BACKWARD = '#c97a1e'

/**
 * The trail at a glance: one bar per stop sized by how many students reached
 * it, forward moves as ribbons between stops, and backward moves as arcs
 * underneath so the two never tangle. Bars and flows are clickable.
 */
export default function PathwayDiagram({
  journeys,
  totalStops,
  focus,
  onFocus
}: {
  journeys: Journey[]
  totalStops: number
  focus: DiagramFocus | null
  onFocus: (focus: DiagramFocus | null) => void
}): React.JSX.Element {
  const reached = Array.from({ length: totalStops }, (_, i) => journeys.filter((j) => j.stops.includes(i)).length)
  const links = pathLinks(journeys)
  const forward = links.filter((l) => l.to > l.from).sort((a, b) => a.from - b.from || a.to - b.to)
  const backward = links.filter((l) => l.to < l.from).sort((a, b) => b.count - a.count)

  const max = Math.max(1, ...reached)
  const scale = MAX_NODE_H / max
  const x = (i: number): number => (totalStops === 1 ? W / 2 : MARGIN_X + (i * (W - 2 * MARGIN_X)) / (totalStops - 1))
  const h = (i: number): number => Math.max(4, reached[i] * scale)
  const top = (i: number): number => CENTER_Y - h(i) / 2
  const bottom = (i: number): number => CENTER_Y + h(i) / 2

  // Stack forward ribbons centred on each bar: outgoing on its right edge, incoming on its left.
  // Ribbons get a readable minimum thickness — few students move on compared with how many reach a stop.
  const ribbonWidth = (count: number): number => Math.max(5, count * scale)
  const stackStart = (stop: number, side: 'from' | 'to'): number =>
    CENTER_Y - forward.filter((l) => l[side] === stop).reduce((sum, l) => sum + ribbonWidth(l.count), 0) / 2
  const outOffset = Array.from({ length: totalStops }, (_, i) => stackStart(i, 'from'))
  const inOffset = Array.from({ length: totalStops }, (_, i) => stackStart(i, 'to'))
  const ribbons = forward.map((l) => {
    const w = ribbonWidth(l.count)
    const y0 = outOffset[l.from]
    const y1 = inOffset[l.to]
    outOffset[l.from] += w
    inOffset[l.to] += w
    const x0 = x(l.from) + NODE_W / 2
    const x1 = x(l.to) - NODE_W / 2
    const mid = (x0 + x1) / 2
    const d = `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1 + w} C${mid},${y1 + w} ${mid},${y0 + w} ${x0},${y0 + w} Z`
    // Flows that skip stops cross the flows between those stops, so only neighbouring-stop flows
    // carry a number on the diagram; skips show theirs on hover and in the path list.
    return { ...l, d, w, labelX: mid, labelY: (y0 + y1) / 2 - 6, labelled: l.to - l.from === 1 }
  })

  const lowest = Math.max(...Array.from({ length: totalStops }, (_, i) => bottom(i)))
  const arcs = backward.map((l) => {
    const depth = 34 + 22 * Math.abs(l.from - l.to)
    const y0 = lowest + 10
    const x0 = x(l.from)
    const x1 = x(l.to)
    return {
      ...l,
      d: `M${x0},${y0} C${x0},${y0 + depth} ${x1},${y0 + depth} ${x1},${y0 + 6}`,
      w: Math.min(12, Math.max(2, l.count * scale * 0.6)),
      labelX: (x0 + x1) / 2,
      labelY: y0 + depth * 0.75 + 4
    }
  })
  const height = Math.max(lowest + 30, ...arcs.map((a) => a.labelY + 24))

  const isFocused = (f: DiagramFocus): boolean =>
    !!focus &&
    focus.kind === f.kind &&
    (f.kind === 'stop'
      ? (focus as { stop: number }).stop === f.stop
      : (focus as { from: number }).from === f.from && (focus as { to: number }).to === f.to)
  const dimmed = (f: DiagramFocus): boolean => !!focus && !isFocused(f)
  const toggle = (f: DiagramFocus): void => onFocus(isFocused(f) ? null : f)
  const name = (i: number): string => `${i + 1} · ${trailStopLabel(i, totalStops)}`

  return (
    <svg className="paths-diagram" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Flow of students between trail stops">
      {ribbons.map((r) => {
        const f: DiagramFocus = { kind: 'link', from: r.from, to: r.to }
        return (
          <g key={`f${r.from}-${r.to}`} className="paths-flow" onClick={() => toggle(f)}>
            <title>{`${name(r.from)} → ${name(r.to)}: ${r.count} student${r.count === 1 ? '' : 's'}`}</title>
            <path d={r.d} fill={FORWARD} fillOpacity={isFocused(f) ? 0.55 : dimmed(f) ? 0.1 : 0.32} />
            {r.labelled && (
              <text x={r.labelX} y={r.labelY} textAnchor="middle" className="paths-flow-label">
                {r.count}
              </text>
            )}
          </g>
        )
      })}

      {arcs.map((a) => {
        const f: DiagramFocus = { kind: 'link', from: a.from, to: a.to }
        return (
          <g key={`b${a.from}-${a.to}`} className="paths-flow" onClick={() => toggle(f)}>
            <title>{`${name(a.from)} → back to ${name(a.to)}: ${a.count} student${a.count === 1 ? '' : 's'}`}</title>
            {/* Wide invisible stroke so thin arcs are easy to click. */}
            <path d={a.d} fill="none" stroke="transparent" strokeWidth={Math.max(14, a.w + 8)} />
            <path
              d={a.d}
              fill="none"
              stroke={BACKWARD}
              strokeOpacity={isFocused(f) ? 0.9 : dimmed(f) ? 0.15 : 0.5}
              strokeWidth={a.w}
              strokeLinecap="round"
            />
            <text x={a.labelX} y={a.labelY} textAnchor="middle" className="paths-flow-label is-back">
              {a.count}
            </text>
          </g>
        )
      })}

      {reached.map((count, i) => {
        const f: DiagramFocus = { kind: 'stop', stop: i }
        return (
          <g key={`n${i}`} className="paths-node" onClick={() => toggle(f)}>
            <title>{`${name(i)}: ${count} student${count === 1 ? '' : 's'} reached this stop`}</title>
            <text x={x(i)} y={top(i) - 26} textAnchor="middle" className="paths-node-label">
              {name(i)}
            </text>
            <text x={x(i)} y={top(i) - 10} textAnchor="middle" className="paths-node-count">
              {count}
            </text>
            <rect
              x={x(i) - NODE_W / 2}
              y={top(i)}
              width={NODE_W}
              height={h(i)}
              rx={4}
              className={`paths-node-bar ${isFocused(f) ? 'is-focused' : ''}`}
              opacity={dimmed(f) ? 0.35 : 1}
            />
          </g>
        )
      })}
    </svg>
  )
}

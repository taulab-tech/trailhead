import React from 'react'
import type { Student } from '../../../shared/types'
import { JOURNEY_STATUS_LABELS, type Journey } from '../../../shared/journeys'
import { trailStopLabel } from '../lib/stageLabel'
import { formatSince } from '../lib/positions'

/** "2022-09-01" → "Sep 2022". */
function formatDate(date: string): string {
  const [y, m] = date.split('-').map(Number)
  if (!y || !m) return date
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/**
 * One student's path: every event they attended in date order, marked with
 * its trail stop, ending with where they work now.
 */
export default function JourneyTimeline({
  journey,
  totalStops,
  colorForCategory,
  student,
  onRemove
}: {
  journey: Journey | null
  totalStops: number
  colorForCategory: (categoryId: string | null) => string | null
  student: Student
  /** Shown as a Remove action on each event, when given. */
  onRemove?: (eventId: string) => void
}): React.JSX.Element {
  const steps = journey?.steps ?? []
  return (
    <div className="journey">
      {journey && journey.status !== 'off-trail' && (
        <div className={`journey-verdict is-${journey.status}`}>
          {JOURNEY_STATUS_LABELS[journey.status]}
          <span className="journey-verdict-detail">
            {journey.status === 'in-order' && ' — every stop reached in sequence'}
            {journey.status === 'skipped' && ' — moved forward but missed a stop'}
            {journey.status === 'out-of-order' && ' — reached a later stop before an earlier one'}
            {journey.status === 'single' && ` — only ${trailStopLabel(journey.stops[0], totalStops)} so far`}
            {journey.status === 'unknown' && ' — some events have no date'}
          </span>
        </div>
      )}
      {steps.length === 0 && <p className="text-dim">No events yet.</p>}
      <ol className="journey-steps">
        {steps.map((s) => {
          const color = colorForCategory(s.categoryId)
          return (
            <li key={s.eventId} className={`journey-step ${s.outOfOrder ? 'is-back' : ''}`}>
              <span className="journey-dot" style={{ background: color ?? 'var(--border)' }} />
              <div className="journey-step-main">
                <div className="journey-step-date">
                  {s.date ? formatDate(s.date) : 'No date'}
                  {s.dateInferred && <span title="From the student's enrol term"> · term</span>}
                </div>
                <div className="journey-step-name">{s.eventName}</div>
                <div className="journey-step-meta">
                  {s.stopIndex !== null ? (
                    <span className="journey-stop-pill">
                      {s.stopIndex + 1} · {trailStopLabel(s.stopIndex, totalStops)}
                      {s.categoryName ? ` · ${s.categoryName}` : ''}
                    </span>
                  ) : (
                    <span className="text-faint">{s.categoryName ?? 'No group'} · not on the trail</span>
                  )}
                  {s.outOfOrder && <span className="badge badge-warn">Out of order</span>}
                </div>
              </div>
              {onRemove && (
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(s.eventId)}>
                  Remove
                </button>
              )}
            </li>
          )
        })}
        {student.position && (
          <li className="journey-step is-now">
            <span className="journey-dot is-now" />
            <div className="journey-step-main">
              <div className="journey-step-date">
                Now{student.positionSince ? ` · since ${formatSince(student.positionSince)}` : ''}
              </div>
              <div className="journey-step-name">
                {student.position}
                {student.positionOrg && <span className="text-dim"> · {student.positionOrg}</span>}
              </div>
            </div>
          </li>
        )}
      </ol>
    </div>
  )
}

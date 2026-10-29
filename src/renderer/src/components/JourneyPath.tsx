import React from 'react'
import type { JourneyStatus } from '../../../shared/journeys'
import { trailStopLabel } from '../lib/stageLabel'

/** A compact path: numbered stop markers in the order they were reached. */
export default function JourneyPath({
  path,
  totalStops,
  status
}: {
  path: number[]
  totalStops: number
  status: JourneyStatus
}): React.JSX.Element {
  return (
    <span className={`journey-path is-${status}`} aria-label={path.map((i) => trailStopLabel(i, totalStops)).join(', then ')}>
      {path.map((stop, i) => {
        const backwards = i > 0 && stop < path[i - 1]
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className={`journey-path-link ${backwards ? 'is-back' : ''}`} />}
            <span className={`journey-path-stop ${backwards ? 'is-back' : ''}`} title={trailStopLabel(stop, totalStops)}>
              {stop + 1}
            </span>
          </React.Fragment>
        )
      })}
      {status === 'unknown' && <span className="journey-path-note">order?</span>}
    </span>
  )
}

import React, { useEffect, useState } from 'react'
import type { ReachOutReason, ReachOutSuggestion } from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import StudentDetailDrawer from './StudentDetailDrawer'

const GROUPS: { reason: ReachOutReason; title: string; why: string }[] = [
  {
    reason: 'close_to_finishing',
    title: 'Nearly there',
    why: 'A few credit units short. A word now is the one most likely to finish it.'
  },
  {
    reason: 'final_year',
    title: 'Last year to finish',
    why: 'In their final year with a certificate unfinished. After this they are gone.'
  },
  {
    reason: 'drifting',
    title: 'Gone quiet',
    why: 'Started a certificate, then stopped turning up.'
  }
]

/** How many of each group to show before folding the rest away. */
const SHOWN = 5

/**
 * Who to contact, and why.
 *
 * Deliberately not a score. Each group is one rule anybody can check, and
 * each line carries the figure behind it, so the list can be disagreed
 * with rather than taken on trust. Nobody who has finished appears.
 */
export default function ReachOut(): React.JSX.Element | null {
  const [suggestions, setSuggestions] = useState<ReachOutSuggestion[] | null>(null)
  const [expanded, setExpanded] = useState<Set<ReachOutReason>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { version, bump } = useDataVersion()

  useEffect(() => {
    window.api.getReachOutSuggestions().then(setSuggestions)
  }, [version])

  if (!suggestions) return null

  const groups = GROUPS.map((g) => ({ ...g, people: suggestions.filter((s) => s.reason === g.reason) })).filter(
    (g) => g.people.length > 0
  )

  return (
    <div className="card reach-out">
      <h2 className="dash-card-title">Worth a word</h2>
      {groups.length === 0 ? (
        <p className="text-faint" style={{ margin: 0 }}>
          Nobody stands out right now. This fills in once students have courses on record and a
          certificate to work towards.
        </p>
      ) : (
        groups.map((group) => {
          const open = expanded.has(group.reason)
          const people = open ? group.people : group.people.slice(0, SHOWN)
          return (
            <div key={group.reason} className="reach-group">
              <div className="reach-group-head">
                <strong>{group.title}</strong>
                <span className="chip">{group.people.length}</span>
              </div>
              <p className="reach-why">{group.why}</p>
              <ul className="reach-list">
                {people.map((person) => (
                  <li key={person.studentId}>
                    <button className="reach-person" onClick={() => setSelectedId(person.studentId)}>
                      <span className="reach-name">
                        {person.firstName} {person.lastName}
                      </span>
                      <span className="reach-detail">{person.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {group.people.length > SHOWN && (
                <button
                  className="review-link"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(group.reason)) next.delete(group.reason)
                      else next.add(group.reason)
                      return next
                    })
                  }
                >
                  {open ? 'Show fewer' : `Show all ${group.people.length}`}
                </button>
              )}
            </div>
          )
        })
      )}

      {selectedId && (
        <StudentDetailDrawer
          studentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </div>
  )
}

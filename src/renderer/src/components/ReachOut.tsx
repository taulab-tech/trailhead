import React, { useEffect, useState } from 'react'
import type { ReachOutReason, ReachOutSuggestion } from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import CollapsibleCard from './CollapsibleCard'
import StudentDetailDrawer from './StudentDetailDrawer'

const GROUPS: { reason: ReachOutReason; title: string; short: string; why: string }[] = [
  {
    reason: 'close_to_finishing',
    title: 'Nearly there',
    short: 'nearly there',
    why: 'A few credit units short. A word now is the one most likely to finish it.'
  },
  {
    reason: 'final_year',
    title: 'Last year to finish',
    short: 'in their last year',
    why: 'In their final year with a certificate unfinished. After this they are gone.'
  },
  {
    reason: 'drifting',
    title: 'Gone quiet',
    short: 'gone quiet',
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

  // The header has to be worth reading on its own, because the card is shut:
  // "3 nearly there · 12 in their last year" is a reason to open it.
  const summary =
    groups.length === 0
      ? 'Nobody stands out right now'
      : groups.map((g) => `${g.people.length} ${g.short}`).join(' · ')

  return (
    <CollapsibleCard title="Worth a word" count={suggestions.length} summary={summary} className="reach-out">
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
    </CollapsibleCard>
  )
}

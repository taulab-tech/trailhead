import React, { useEffect, useState } from 'react'
import type { RecentContact } from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import CollapsibleCard from './CollapsibleCard'
import StudentDetailDrawer from './StudentDetailDrawer'

/** How many to list before folding the rest away. */
const SHOWN = 8

/** "2026-09-14" → "14 Sep 2026", and "Sep 2026" when the day is a stand-in. */
function formatSeen(date: string, fromTerm: boolean): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month) return date
  const when = new Date(year, month - 1, day || 1)
  return when.toLocaleDateString(undefined, {
    ...(fromTerm ? {} : { day: 'numeric' }),
    month: 'short',
    year: 'numeric'
  })
}

/**
 * The students seen most recently, and what following each one up is worth.
 *
 * The companion to "Worth a word", and the opposite question: that card is
 * people who have gone quiet or are nearly done, this one is people who
 * were here lately and are still warm. Ordered by date and never by
 * promise — a recency list sorted by score is no longer a recency list,
 * and the promise is on the line beside each name instead, where it can
 * be read and disagreed with.
 */
export default function RecentContacts(): React.JSX.Element | null {
  const [contacts, setContacts] = useState<RecentContact[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { version, bump } = useDataVersion()

  useEffect(() => {
    window.api.getRecentContacts().then(setContacts)
  }, [version])

  if (!contacts) return null

  const promising = contacts.filter((c) => c.promising).length
  const latest = contacts[0]
  // Worth reading with the card shut: when the last sign of anybody was,
  // and whether any of them are close enough to be worth the afternoon.
  const summary =
    contacts.length === 0
      ? 'Nobody on record yet'
      : `Last seen ${formatSeen(latest.lastSeen, latest.where.includes(','))}` +
        (promising > 0 ? ` · ${promising} close to finishing` : '')

  const shown = showAll ? contacts : contacts.slice(0, SHOWN)

  return (
    <CollapsibleCard
      title="Recently seen"
      count={contacts.length === 0 ? undefined : contacts.length}
      summary={summary}
      className="recent-contacts"
    >
      {contacts.length === 0 ? (
        <p className="text-faint" style={{ margin: 0 }}>
          Nobody yet. This fills in from event dates and the terms students were registered in.
        </p>
      ) : (
        <>
          <p className="reach-why">
            Who has been through lately, newest first. The second line is what following them up
            would be worth.
          </p>
          <ul className="reach-list">
            {shown.map((person) => (
              <li key={person.studentId}>
                <button className="recent-person" onClick={() => setSelectedId(person.studentId)}>
                  <span className="recent-when">
                    {formatSeen(person.lastSeen, person.where.includes(','))}
                  </span>
                  <span className="recent-main">
                    <span className="reach-name">
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="recent-where">{person.where}</span>
                  </span>
                  <span className={`recent-promise${person.promising ? ' is-promising' : ''}`}>
                    {person.promise}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {contacts.length > SHOWN && (
            <button className="review-link" onClick={() => setShowAll((was) => !was)}>
              {showAll ? 'Show fewer' : `Show all ${contacts.length}`}
            </button>
          )}
        </>
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

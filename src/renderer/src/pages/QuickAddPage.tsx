import React, { useEffect, useMemo, useState } from 'react'
import type { EventCategory, QuickAddPerson, QuickAddResult } from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import StudentDetailDrawer from '../components/StudentDetailDrawer'

/** "2026-09-14" → "14 Sep 2026". */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month) return date
  return new Date(year, month - 1, day || 1).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

const PLACEHOLDER = `Amara Okonkwo
Bence Lindqvist - wants to join a capstone team
Chidi Hollis, chidi@example.com
Okonkwo, Rosa — asked about the certificate`

/**
 * One person, as the app sees them the moment they are added.
 *
 * The card leads with whether they are new, because that is the thing the
 * person at the table needs before they open their mouth. Everything under
 * it is the evidence for the suggested next step, so the suggestion can be
 * ignored on an informed basis rather than taken on trust.
 */
function PersonCard({
  person,
  onOpen
}: {
  person: QuickAddPerson
  onOpen: (id: string) => void
}): React.JSX.Element {
  const certificate = person.certificates[0]

  return (
    <li className={`qa-person${person.isNew ? ' is-new' : ''}`}>
      <div className="qa-person-head">
        <button className="qa-name" onClick={() => onOpen(person.studentId)}>
          {person.firstName} {person.lastName}
        </button>
        {person.isNew ? (
          <span className="badge badge-new">First outreach</span>
        ) : (
          <span className="badge chip-neutral">
            {person.attendanceCount === 1 ? '1 event' : `${person.attendanceCount} events`}
          </span>
        )}
      </div>

      <p className="qa-history">
        {person.isNew
          ? 'Nobody by this name was on record before today.'
          : person.previouslySeen
            ? `Last seen ${formatDate(person.previouslySeen)}${person.previouslySeenAt ? ` at ${person.previouslySeenAt}` : ''}.`
            : 'On record already, with no dated event before today.'}
      </p>

      {(certificate || person.furthestStop || person.connections.length > 0) && (
        <dl className="qa-facts">
          {person.furthestStop && (
            <div>
              <dt>Trail</dt>
              <dd>as far as {person.furthestStop}</dd>
            </div>
          )}
          {certificate && (
            <div>
              <dt>Certificate</dt>
              <dd>
                {certificate.complete
                  ? `finished ${certificate.name}`
                  : `${certificate.percent}% through ${certificate.name}${
                      certificate.unitsRemaining <= 6 ? ` — ${certificate.unitsRemaining} CU to go` : ''
                    }`}
              </dd>
            </div>
          )}
          {person.connections.length > 0 && (
            <div>
              <dt>Comes with</dt>
              <dd>
                {person.connections.map((c, i) => (
                  <span key={c.studentId}>
                    {i > 0 && ', '}
                    <button className="qa-link" onClick={() => onOpen(c.studentId)}>
                      {c.firstName} {c.lastName}
                    </button>
                    <span className="text-faint"> ×{c.sharedEvents}</span>
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      {person.updates.length > 0 && (
        <p className="qa-updated">
          Updated: {person.updates.map((u) => u.label.toLowerCase()).join(', ')}
        </p>
      )}

      {person.line.note && <p className="qa-note">“{person.line.note}”</p>}

      <p className="qa-next">
        <strong>{person.nextStep}</strong>
        <span className="text-faint"> — {person.nextStepBecause}</span>
      </p>
    </li>
  )
}

/**
 * Adding people from a list typed at an event.
 *
 * The Import screen is for spreadsheets somebody exported. This is for the
 * other half of the job: standing at a table with a list of names and
 * wanting both to record them and to know, right then, who you are talking
 * to. Nothing is written until the preview has been looked at.
 */
export default function QuickAddPage({
  onNavigate
}: {
  onNavigate: (page: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10))
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [preview, setPreview] = useState<QuickAddResult | null>(null)
  const [added, setAdded] = useState<QuickAddResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { bump } = useDataVersion()

  useEffect(() => {
    window.api.listCategories().then(setCategories)
  }, [])

  const lineCount = useMemo(() => text.split('\n').filter((l) => l.trim()).length, [text])
  const result = added ?? preview

  const run = async (previewOnly: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await window.api.quickAdd({
        text,
        eventName: eventName.trim() || null,
        eventDate: eventName.trim() ? eventDate || null : null,
        categoryId: categoryId || null,
        previewOnly
      })
      if (previewOnly) {
        setPreview(outcome)
        setAdded(null)
      } else {
        setAdded(outcome)
        setPreview(null)
        bump()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startOver = (): void => {
    setText('')
    setPreview(null)
    setAdded(null)
    setError(null)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Add people</h1>
          <p>
            Type or paste a list of names — one per line. You get told who is new and who you have met
            before, and what to say to each of them, before anything is saved.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="qa-form">
          <div className="qa-names">
            <label htmlFor="qa-text">Names</label>
            <textarea
              id="qa-text"
              rows={9}
              value={text}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value)
                setPreview(null)
                setAdded(null)
              }}
            />
            <p className="text-faint qa-hint">
              One person per line. An email, a phone number or a note after a dash is picked up too.
              &ldquo;Okonkwo, Rosa&rdquo; is read as surname first.
            </p>
          </div>

          <div className="qa-event">
            <label htmlFor="qa-event-name">Event (optional)</label>
            <input
              id="qa-event-name"
              type="text"
              placeholder="e.g. Pitch Night"
              value={eventName}
              onChange={(e) => {
                setEventName(e.target.value)
                setPreview(null)
                setAdded(null)
              }}
            />
            <label htmlFor="qa-event-date">Date</label>
            <input
              id="qa-event-date"
              type="date"
              value={eventDate}
              disabled={!eventName.trim()}
              onChange={(e) => setEventDate(e.target.value)}
            />
            <label htmlFor="qa-category">Trail stop</label>
            <select
              id="qa-category"
              value={categoryId}
              disabled={!eventName.trim()}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Not on the trail</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-faint qa-hint">
              Leave the event blank to add people without recording attendance.
            </p>
          </div>
        </div>

        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button
            className="btn btn-primary"
            disabled={busy || lineCount === 0 || !!added}
            onClick={() => run(!preview)}
          >
            {busy ? 'Working…' : preview ? `Add ${preview.people.length} people` : `Check ${lineCount} lines`}
          </button>
          {(preview || added) && (
            <button className="btn" disabled={busy} onClick={startOver}>
              Start over
            </button>
          )}
          {added && (
            <button className="btn" onClick={() => onNavigate('students')}>
              Go to Students
            </button>
          )}
          <div className="spacer" />
          {error && <span className="text-danger">{error}</span>}
        </div>
      </div>

      {result && (
        <div className="card">
          <h2 className="dash-card-title">
            {added ? 'Added' : 'This is what will happen'}
            {result.eventName && <span className="text-faint"> · {result.eventName}</span>}
          </h2>
          <p className="text-faint" style={{ marginTop: 0 }}>
            {result.newStudents} new {result.newStudents === 1 ? 'person' : 'people'}, {result.returning}{' '}
            already on record
            {added ? '.' : ' — nothing is saved yet.'}
          </p>

          {result.unreadable.length > 0 && (
            <div className="qa-problems">
              <strong>
                {result.unreadable.length} {result.unreadable.length === 1 ? 'line' : 'lines'} could not
                be read
              </strong>
              <ul>
                {result.unreadable.map((line, i) => (
                  <li key={i}>
                    <code>{line.raw.trim() || '(blank)'}</code> <span className="text-faint">{line.problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="qa-people">
            {result.people.map((person) => (
              <PersonCard key={person.studentId} person={person} onOpen={setOpenId} />
            ))}
          </ul>
        </div>
      )}

      {openId && <StudentDetailDrawer studentId={openId} onClose={() => setOpenId(null)} onChanged={bump} />}
    </div>
  )
}

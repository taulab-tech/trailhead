import React, { useState } from 'react'
import type { PositionCandidate, PositionSearchResult, Student } from '../../../shared/types'

/** What gets saved as the student's position: "Headline · Company", or whichever part exists. */
function positionText(c: PositionCandidate): string {
  if (c.headline && c.experience && !c.headline.toLowerCase().includes(c.experience.toLowerCase())) {
    return `${c.headline} · ${c.experience}`
  }
  return c.headline ?? c.experience ?? 'See LinkedIn profile'
}

function safeUrl(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}

/**
 * The student's saved position, plus an on-click LinkedIn lookup. Nothing is
 * searched until the button is pressed, and nothing is saved until the user
 * picks the right person — common names return several different people.
 */
export default function PositionLookup({
  student,
  onSaved
}: {
  student: Student
  onSaved: () => void
}): React.JSX.Element {
  const [extra, setExtra] = useState('')
  const [searching, setSearching] = useState(false)
  const [lookup, setLookup] = useState<PositionSearchResult | null>(null)
  const candidates = lookup?.candidates ?? null
  const [error, setError] = useState<string | null>(null)

  const search = async (): Promise<void> => {
    setSearching(true)
    setError(null)
    setLookup(null)
    try {
      setLookup(await window.api.findPosition(student.id, extra.trim()))
    } catch (err) {
      // IPC wraps thrown errors as "Error invoking remote method '…': Error: <message>".
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
    } finally {
      setSearching(false)
    }
  }

  const choose = async (c: PositionCandidate): Promise<void> => {
    await window.api.updateStudent(student.id, {
      position: positionText(c),
      positionUrl: safeUrl(c.url),
      positionFoundAt: new Date().toISOString()
    })
    setLookup(null)
    onSaved()
  }

  const clear = async (): Promise<void> => {
    await window.api.updateStudent(student.id, { position: null, positionUrl: null, positionFoundAt: null })
    onSaved()
  }

  const savedUrl = safeUrl(student.positionUrl)

  return (
    <div>
      {student.position ? (
        <div className="position-saved">
          <div className="position-title">{student.position}</div>
          <div className="position-meta">
            {savedUrl && (
              <a href={savedUrl} target="_blank" rel="noreferrer">
                LinkedIn profile ↗
              </a>
            )}
            {student.positionFoundAt && (
              <span>
                Saved{' '}
                {new Date(student.positionFoundAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </span>
            )}
            <button className="review-link" onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <p className="text-faint" style={{ margin: '0 0 10px' }}>
          No position saved yet.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="Extra words (optional), e.g. Saskatoon"
          aria-label="Extra words to narrow the search"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !searching) search()
          }}
        />
        <button className="btn btn-sm" onClick={search} disabled={searching}>
          {searching ? 'Searching…' : student.position ? 'Look up again' : 'Look up on LinkedIn'}
        </button>
      </div>
      <p className="position-note">
        Searches the web for “{student.firstName} {student.lastName}” on LinkedIn — only when you click. The
        name is added for you.
      </p>

      {error && <p className="position-error">{error}</p>}

      {lookup && (
        <p className="position-searched">
          {lookup.broadenedFrom && (
            <>
              Nothing matched <span className="mono">{lookup.broadenedFrom}</span>, so this searched the name
              alone.{' '}
            </>
          )}
          Searched <span className="mono">{lookup.query}</span> · {lookup.resultCount} result
          {lookup.resultCount === 1 ? '' : 's'}
          {lookup.resultCount > 0 && lookup.candidates.length === 0 && ', none of them LinkedIn profiles'}
        </p>
      )}

      {candidates && candidates.length === 0 && (
        <p className="text-dim" style={{ fontSize: 13, margin: '6px 0 0' }}>
          No LinkedIn profiles found. The search engine may also be limiting searches — try again in a minute.
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div className="position-candidates">
          <div className="position-candidates-hint">Pick the right person — names are often shared.</div>
          {candidates.map((c) => (
            <div key={c.url} className="position-candidate">
              <div className="position-candidate-main">
                <div className="position-candidate-name">{c.name}</div>
                {c.headline && <div className="position-candidate-headline">{c.headline}</div>}
                <dl className="position-facts">
                  {c.experience && (
                    <>
                      <dt>Experience</dt>
                      <dd>{c.experience}</dd>
                    </>
                  )}
                  {c.education && (
                    <>
                      <dt>Education</dt>
                      <dd>{c.education}</dd>
                    </>
                  )}
                  {c.location && (
                    <>
                      <dt>Location</dt>
                      <dd>{c.location}</dd>
                    </>
                  )}
                </dl>
              </div>
              <div className="position-candidate-actions">
                <button className="btn btn-primary btn-sm" onClick={() => choose(c)}>
                  This is them
                </button>
                {safeUrl(c.url) && (
                  <a href={safeUrl(c.url)!} target="_blank" rel="noreferrer" className="position-open">
                    Open profile ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

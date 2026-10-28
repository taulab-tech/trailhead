import React, { useState } from 'react'
import type { PositionCandidate, PositionSearchResult, Student } from '../../../shared/types'

function safeUrl(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}

/** A position being confirmed or edited before it's saved. */
interface Draft {
  text: string
  url: string | null
}

/**
 * The student's saved position, plus an on-click LinkedIn lookup. Nothing is
 * searched until the button is pressed, and nothing is saved until the user
 * picks the right person and confirms the title — search results only carry
 * a snippet of the profile, which often lacks the job title.
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
  const [draft, setDraft] = useState<Draft | null>(null)

  const search = async (): Promise<void> => {
    setSearching(true)
    setError(null)
    setLookup(null)
    setDraft(null)
    try {
      setLookup(await window.api.findPosition(student.id, extra.trim()))
    } catch (err) {
      // IPC wraps thrown errors as "Error invoking remote method '…': Error: <message>".
      setError(err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err))
    } finally {
      setSearching(false)
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft || !draft.text.trim()) return
    await window.api.updateStudent(student.id, {
      position: draft.text.trim(),
      positionUrl: draft.url,
      positionFoundAt: new Date().toISOString()
    })
    setDraft(null)
    setLookup(null)
    onSaved()
  }

  const clear = async (): Promise<void> => {
    await window.api.updateStudent(student.id, { position: null, positionUrl: null, positionFoundAt: null })
    onSaved()
  }

  const savedUrl = safeUrl(student.positionUrl)

  const draftEditor = draft && (
    <div className="position-draft">
      <label htmlFor="position-draft">Position</label>
      <input
        id="position-draft"
        type="text"
        autoFocus
        placeholder="e.g. Software Developer at Acme"
        value={draft.text}
        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') saveDraft()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      {!draft.text.trim() && draft.url && (
        <p className="position-note">
          The search result didn’t include a job title —{' '}
          <a href={draft.url} target="_blank" rel="noreferrer">
            open the profile
          </a>{' '}
          and copy it here.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" disabled={!draft.text.trim()} onClick={saveDraft}>
          Save position
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div>
      {student.position && !(draft && !lookup) ? (
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
            <button className="review-link" onClick={() => setDraft({ text: student.position ?? '', url: savedUrl })}>
              Edit
            </button>
            <button className="review-link" onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      ) : !draft ? (
        <p className="text-faint" style={{ margin: '0 0 10px' }}>
          No position saved yet.
        </p>
      ) : null}

      {draft && !lookup && draftEditor}

      <div style={{ display: 'flex', gap: 8, marginTop: draft && !lookup ? 14 : 0 }}>
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
          <div className="position-candidates-hint">
            Pick the right person — names are often shared. Details come from the search result, which only
            shows part of the profile.
          </div>
          {candidates.map((c: PositionCandidate) => {
            const url = safeUrl(c.url)
            const chosen = draft !== null && draft.url === url
            return (
              <div key={c.url} className={`position-candidate ${chosen ? 'is-chosen' : ''}`}>
                <div className="position-candidate-row">
                  <div className="position-candidate-main">
                    <div className="position-candidate-name">{c.name}</div>
                    {c.headline ? (
                      <div className="position-candidate-headline">{c.headline}</div>
                    ) : (
                      <div className="position-candidate-headline text-faint">No title in the search result</div>
                    )}
                    <dl className="position-facts">
                      {c.experience && (
                        <>
                          <dt>Latest experience</dt>
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
                    {!chosen && (
                      <button className="btn btn-primary btn-sm" onClick={() => setDraft({ text: c.headline ?? '', url })}>
                        This is them
                      </button>
                    )}
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="position-open">
                        Open profile ↗
                      </a>
                    )}
                  </div>
                </div>
                {c.snippet && <p className="position-snippet">{c.snippet}</p>}
                {chosen && draftEditor}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

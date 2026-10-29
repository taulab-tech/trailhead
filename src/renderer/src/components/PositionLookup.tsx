import React, { useEffect, useState } from 'react'
import type { PositionCandidate, PositionSearchResult, Student } from '../../../shared/types'
import { formatSince } from '../lib/positions'
import { namesSwapped, suggestedPosition } from '../../../shared/positions'

function safeUrl(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}

/** A position being confirmed or edited before it's saved. */
interface Draft {
  title: string
  org: string
  /** "YYYY-MM" from a month input, or '' when unknown. */
  since: string
  url: string | null
}

function draftFrom(c: PositionCandidate): Draft {
  return { ...suggestedPosition(c), since: '', url: safeUrl(c.url) }
}

/**
 * The student's saved position, plus an on-click LinkedIn lookup. Nothing is
 * searched until the button is pressed, and nothing is saved until the user
 * picks the right person and confirms the details — search results only carry
 * a snippet of the profile, which never includes a start date and often lacks
 * the job title.
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
  const [hasInstitution, setHasInstitution] = useState(true)

  useEffect(() => {
    window.api.getSettings().then((s) => setHasInstitution(s.institutionNames.length > 0))
  }, [])

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
    if (!draft || !draft.title.trim()) return
    await window.api.updateStudent(student.id, {
      position: draft.title.trim(),
      positionOrg: draft.org.trim() || null,
      positionSince: draft.since || null,
      positionUrl: draft.url,
      positionFoundAt: new Date().toISOString()
    })
    setDraft(null)
    setLookup(null)
    onSaved()
  }

  const clear = async (): Promise<void> => {
    await window.api.updateStudent(student.id, {
      position: null,
      positionOrg: null,
      positionSince: null,
      positionUrl: null,
      positionFoundAt: null
    })
    onSaved()
  }

  const savedUrl = safeUrl(student.positionUrl)

  const swapNames = async (): Promise<void> => {
    await window.api.updateStudent(student.id, { firstName: student.lastName, lastName: student.firstName })
    onSaved()
  }

  const draftEditor = draft && (
    <div className="position-draft">
      <div className="field-row">
        <div>
          <label htmlFor="position-title">Title</label>
          <input
            id="position-title"
            type="text"
            autoFocus
            placeholder="e.g. Software Developer"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDraft()
              if (e.key === 'Escape') setDraft(null)
            }}
          />
        </div>
        <div>
          <label htmlFor="position-org">Organisation</label>
          <input
            id="position-org"
            type="text"
            placeholder="e.g. Acme Corp"
            value={draft.org}
            onChange={(e) => setDraft({ ...draft, org: e.target.value })}
          />
        </div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor="position-since">Since (optional)</label>
          <input
            id="position-since"
            type="month"
            value={draft.since}
            onChange={(e) => setDraft({ ...draft, since: e.target.value })}
          />
        </div>
        <p className="position-note" style={{ alignSelf: 'end', marginBottom: 6 }}>
          Search results don’t include start dates
          {draft.url ? (
            <>
              {' '}
              —{' '}
              <a href={draft.url} target="_blank" rel="noreferrer">
                check the profile
              </a>
            </>
          ) : null}
          .
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={!draft.title.trim()} onClick={saveDraft}>
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
          <div className="position-title">
            {student.position}
            {student.positionOrg && <span className="position-org"> · {student.positionOrg}</span>}
          </div>
          <div className="position-meta">
            {student.positionSince && <span>Since {formatSince(student.positionSince)}</span>}
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
            <button
              className="review-link"
              onClick={() =>
                setDraft({
                  title: student.position ?? '',
                  org: student.positionOrg ?? '',
                  since: student.positionSince ?? '',
                  url: savedUrl
                })
              }
            >
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
              Nothing matched <span className="mono">{lookup.broadenedFrom}</span>, so this searched more
              broadly.{' '}
            </>
          )}
          Searched <span className="mono">{lookup.query}</span> · {lookup.resultCount} result
          {lookup.resultCount === 1 ? '' : 's'}
          {lookup.resultCount > 0 &&
            lookup.candidates.length === 0 &&
            !lookup.otherNamesHidden &&
            ', none of them LinkedIn profiles'}
          {lookup.otherNamesHidden > 0 &&
            ` · ${lookup.otherNamesHidden} profile${lookup.otherNamesHidden === 1 ? '' : 's'} for other people hidden`}
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
            Pick the right person — names are often shared.{' '}
            {hasInstitution
              ? 'People who mention your institution are listed first.'
              : 'Tip: add your institution in Settings to highlight likely matches.'}
          </div>
          {candidates.map((c) => {
            const url = safeUrl(c.url)
            const chosen = draft !== null && draft.url === url
            return (
              <div key={c.url} className={`position-candidate ${chosen ? 'is-chosen' : ''}`}>
                <div className="position-candidate-row">
                  <div className="position-candidate-main">
                    <div className="position-candidate-name">
                      {c.name}
                      {c.institutionMatch && (
                        <span className="position-match">Studied at {c.institutionMatch}</span>
                      )}
                    </div>
                    {namesSwapped(c.name, student.firstName, student.lastName) && (
                      <div className="position-swap">
                        This profile says “{c.name}”, so the first and last name may be swapped in your records.{' '}
                        <button className="review-link" onClick={swapNames}>
                          Swap first and last name
                        </button>
                      </div>
                    )}
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
                      <button className="btn btn-primary btn-sm" onClick={() => setDraft(draftFrom(c))}>
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

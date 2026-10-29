import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { LookupItem, LookupStatus, PositionCandidate } from '../../../shared/types'
import { strongMatch, suggestedPosition } from '../../../shared/positions'
import { useDataVersion } from '../DataContext'

interface Choice {
  url: string
  title: string
  org: string
}

const POLL_MS = 2000

function safeUrl(url: string): string | null {
  return /^https:\/\//i.test(url) ? url : null
}

function choiceFrom(c: PositionCandidate): Choice {
  return { url: c.url, ...suggestedPosition(c) }
}

function minutesLeft(status: LookupStatus): string {
  const seconds = status.queued * status.secondsPerSearch
  return seconds < 90 ? 'about a minute left' : `about ${Math.round(seconds / 60)} min left`
}

/**
 * Review of background LinkedIn lookups, shown as a tab on the Students page. Strong matches are
 * pre-ticked; everything else waits for a person to pick or skip. Nothing is
 * saved to a student until "Save" is pressed.
 */
export default function LinkedInMatches({ onNavigate }: { onNavigate: (page: string) => void }): React.JSX.Element {
  const { bump } = useDataVersion()
  const [status, setStatus] = useState<LookupStatus | null>(null)
  const [items, setItems] = useState<LookupItem[]>([])
  const [hasInstitution, setHasInstitution] = useState(true)
  // Per student: the profile chosen and its (editable) title/organisation; null = unticked.
  const [choices, setChoices] = useState<Record<string, Choice | null>>({})
  const [saving, setSaving] = useState(false)
  const lastStatus = useRef<LookupStatus | null>(null)

  const reload = async (): Promise<void> => {
    const [s, list] = await Promise.all([window.api.getLookupStatus(), window.api.listLookups()])
    lastStatus.current = s
    setStatus(s)
    setItems(list)
    // Pre-tick strong matches the first time they appear; never override the user's edits.
    setChoices((prev) => {
      const next = { ...prev }
      for (const item of list) {
        if (item.student.id in next || !item.result) continue
        const strong = strongMatch(item.result.candidates, item.student.lastName)
        if (strong) next[item.student.id] = choiceFrom(strong)
      }
      return next
    })
  }

  useEffect(() => {
    reload()
    window.api.getSettings().then((s) => setHasInstitution(s.institutionNames.length > 0))
    // Refresh the list only when the counts move, i.e. a search finished.
    const timer = setInterval(async () => {
      const s = await window.api.getLookupStatus()
      const prev = lastStatus.current
      lastStatus.current = s
      setStatus(s)
      if (!prev || prev.done !== s.done || prev.failed !== s.failed || prev.queued !== s.queued) reload()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const groups = useMemo(() => {
    const strong: LookupItem[] = []
    const choose: LookupItem[] = []
    const none: LookupItem[] = []
    const failed: LookupItem[] = []
    for (const item of items) {
      if (item.status === 'failed') failed.push(item)
      else if (item.status !== 'done' || !item.result) continue
      else if (item.result.candidates.length === 0) none.push(item)
      else if (strongMatch(item.result.candidates, item.student.lastName)) strong.push(item)
      else choose.push(item)
    }
    return { strong, choose, none, failed }
  }, [items])

  const toSave = Object.entries(choices).filter(
    (entry): entry is [string, Choice] => !!entry[1] && !!entry[1].title.trim()
  )

  const setChoice = (studentId: string, choice: Choice | null): void =>
    setChoices((prev) => ({ ...prev, [studentId]: choice }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      for (const [studentId, c] of toSave) {
        await window.api.updateStudent(studentId, {
          position: c.title.trim(),
          positionOrg: c.org.trim() || null,
          positionUrl: safeUrl(c.url),
          positionFoundAt: now
        })
      }
      await window.api.dismissLookups(toSave.map(([id]) => id))
      setChoices((prev) => {
        const next = { ...prev }
        for (const [id] of toSave) delete next[id]
        return next
      })
      bump()
      await reload()
    } finally {
      setSaving(false)
    }
  }

  const skip = async (studentIds: string[]): Promise<void> => {
    await window.api.dismissLookups(studentIds)
    setChoices((prev) => {
      const next = { ...prev }
      for (const id of studentIds) delete next[id]
      return next
    })
    await reload()
  }

  const total = status ? status.queued + status.done + status.failed : 0
  const finished = status ? status.done + status.failed : 0
  const nothing = items.length === 0 && status !== null && status.queued === 0

  const choiceEditor = (studentId: string, c: Choice): React.JSX.Element => (
    <div className="lookup-edit">
      <input
        type="text"
        aria-label="Title"
        placeholder="Title"
        value={c.title}
        onChange={(e) => setChoice(studentId, { ...c, title: e.target.value })}
      />
      <input
        type="text"
        aria-label="Organisation"
        placeholder="Organisation"
        value={c.org}
        onChange={(e) => setChoice(studentId, { ...c, org: e.target.value })}
      />
    </div>
  )

  return (
    <div className="lookups-page">
      <p className="lookup-intro">
        Possible LinkedIn profiles for students, found in the background. Nothing is saved until you approve it.
      </p>

      {!hasInstitution && (
        <div className="card lookup-banner">
          <span>
            Add your institution in <b>Settings</b> — it’s how a profile counts as a strong match.
          </span>
          <button className="btn btn-sm" onClick={() => onNavigate('settings')}>
            Open Settings
          </button>
        </div>
      )}

      {status && total > 0 && (status.queued > 0 || status.running || status.pausedReason) && (
        <div className="card lookup-progress">
          <div className="lookup-progress-head">
            <div>
              {status.pausedReason ? (
                <>
                  <b>Paused.</b> <span className="text-dim">{status.pausedReason}</span>
                </>
              ) : status.running ? (
                <>
                  <b>
                    Searching {Math.min(finished + 1, total)} of {total}
                  </b>{' '}
                  <span className="text-dim">
                    · {minutesLeft(status)} · one search every {status.secondsPerSearch} seconds so the search engine
                    doesn’t block you
                  </span>
                </>
              ) : (
                <>
                  <b>{status.queued} waiting.</b> <span className="text-dim">Searching is stopped.</span>
                </>
              )}
            </div>
            {status.running ? (
              <button className="btn btn-sm" onClick={() => window.api.stopLookups().then(reload)}>
                Stop
              </button>
            ) : status.queued > 0 ? (
              <button className="btn btn-sm" onClick={() => window.api.startLookups().then(reload)}>
                Resume
              </button>
            ) : null}
          </div>
          <div className="bar-track" style={{ marginTop: 12 }}>
            <div className="bar-fill" style={{ width: `${total ? (finished / total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {nothing && (
        <div className="card empty-state">
          <h3 style={{ color: 'var(--text)', marginTop: 0 }}>Nothing to review</h3>
          <p>
            After importing a roster, use <b>Find LinkedIn matches</b> on the import screen to look up the new students
            here.
          </p>
        </div>
      )}

      {groups.strong.length > 0 && (
        <div className="card lookup-section">
          <div className="lookup-section-head">
            <div>
              <h2 className="dash-card-title">Strong matches ({groups.strong.length})</h2>
              <p className="dash-card-sub">
                Exactly one profile mentions your institution. Ticked ones are saved — check the title and
                organisation first.
              </p>
            </div>
          </div>
          <table className="lookup-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Student</th>
                <th>LinkedIn profile</th>
                <th>Title · Organisation to save</th>
              </tr>
            </thead>
            <tbody>
              {groups.strong.map((item) => {
                const c = strongMatch(item.result!.candidates, item.student.lastName)!
                const choice = choices[item.student.id]
                const url = safeUrl(c.url)
                return (
                  <tr key={item.student.id} className={choice ? '' : 'is-off'}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Save position for ${item.student.firstName} ${item.student.lastName}`}
                        checked={!!choice}
                        onChange={(e) => setChoice(item.student.id, e.target.checked ? choiceFrom(c) : null)}
                      />
                    </td>
                    <td className="lookup-student">
                      {item.student.firstName} {item.student.lastName}
                    </td>
                    <td>
                      <div className="lookup-headline">{c.headline}</div>
                      <div className="lookup-meta">
                        <span className="position-match">Studied at {c.institutionMatch}</span>
                        {c.location && <span>{c.location}</span>}
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer">
                            Open profile ↗
                          </a>
                        )}
                      </div>
                    </td>
                    <td>{choice ? choiceEditor(item.student.id, choice) : <span className="text-faint">Won’t be saved</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {groups.choose.length > 0 && (
        <div className="card lookup-section">
          <h2 className="dash-card-title">Needs your choice ({groups.choose.length})</h2>
          <p className="dash-card-sub" style={{ marginTop: -10, marginBottom: 14 }}>
            Several possible profiles, or none that mention your institution. Pick the right one, or skip.
          </p>
          {groups.choose.map((item) => {
            const choice = choices[item.student.id]
            return (
              <div key={item.student.id} className="lookup-choose">
                <div className="lookup-choose-head">
                  <span className="lookup-student">
                    {item.student.firstName} {item.student.lastName}
                  </span>
                  <span className="text-faint">
                    {item.result!.candidates.length} profile{item.result!.candidates.length === 1 ? '' : 's'}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-ghost btn-sm" onClick={() => skip([item.student.id])}>
                    Skip
                  </button>
                </div>
                <div className="lookup-options">
                  {item.result!.candidates.map((c) => {
                    const picked = choice?.url === c.url
                    const url = safeUrl(c.url)
                    return (
                      <div key={c.url} className={`lookup-option ${picked ? 'is-picked' : ''}`}>
                        <div className="lookup-headline">{c.headline ?? <span className="text-faint">No title in the result</span>}</div>
                        <div className="lookup-meta">
                          {c.institutionMatch && <span className="position-match">Studied at {c.institutionMatch}</span>}
                          {c.education && !c.institutionMatch && <span>{c.education}</span>}
                          {c.location && <span>{c.location}</span>}
                          {url && (
                            <a href={url} target="_blank" rel="noreferrer">
                              Open ↗
                            </a>
                          )}
                        </div>
                        {picked ? (
                          <>
                            {choiceEditor(item.student.id, choice!)}
                            <button className="review-link" onClick={() => setChoice(item.student.id, null)}>
                              Undo
                            </button>
                          </>
                        ) : (
                          <button className="btn btn-sm" onClick={() => setChoice(item.student.id, choiceFrom(c))}>
                            This is them
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(groups.none.length > 0 || groups.failed.length > 0) && (
        <div className="grid-2" style={{ marginTop: 16 }}>
          {groups.none.length > 0 && (
            <div className="card">
              <h2 className="dash-card-title">No profile found ({groups.none.length})</h2>
              <p className="lookup-names">
                {groups.none.map((i) => `${i.student.firstName} ${i.student.lastName}`).join(', ')}
              </p>
              <button className="btn btn-sm" onClick={() => skip(groups.none.map((i) => i.student.id))}>
                Clear list
              </button>
            </div>
          )}
          {groups.failed.length > 0 && (
            <div className="card">
              <h2 className="dash-card-title">Couldn’t search ({groups.failed.length})</h2>
              <p className="lookup-names">{groups.failed[groups.failed.length - 1].error}</p>
              <button className="btn btn-sm" onClick={() => window.api.retryFailedLookups().then(reload)}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {toSave.length > 0 && (
        <div className="lookup-savebar">
          <span>
            <b>{toSave.length}</b> position{toSave.length === 1 ? '' : 's'} ready to save
          </span>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : `Save ${toSave.length} position${toSave.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import type { PossibleDuplicate } from '../../../shared/types'

function StudentCard({ s }: { s: PossibleDuplicate['studentA'] }): React.JSX.Element {
  return (
    <div className="card" style={{ flex: 1, marginTop: 0 }}>
      <strong>
        {s.firstName} {s.lastName}
      </strong>
      <div className="text-dim" style={{ marginTop: 4 }}>
        {s.emails.join(', ') || 'no email'}
      </div>
      {s.nsid && <div className="text-faint mono">ID: {s.nsid}</div>}
      <div className="text-faint" style={{ marginTop: 6 }}>
        {[s.college, s.discipline, s.degree].filter(Boolean).join(' · ') || 'no program info'}
      </div>
      <div style={{ marginTop: 8 }}>
        <span className="chip">{s.attendanceCount} event(s) attended</span>
      </div>
    </div>
  )
}

/** Pairs of student records that may be the same person, to merge or dismiss. Shown on the Settings page. */
export default function DuplicatesReview({ onChanged }: { onChanged: () => void }): React.JSX.Element {
  const [dupes, setDupes] = useState<PossibleDuplicate[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = (): void => {
    setLoading(true)
    window.api.listDuplicates('pending').then((rows) => {
      setDupes(rows)
      setLoading(false)
    })
  }

  useEffect(refresh, [])

  const merge = async (dup: PossibleDuplicate, keepId: string): Promise<void> => {
    setBusyId(dup.id)
    await window.api.mergeDuplicate(dup.id, keepId)
    onChanged()
    refresh()
    setBusyId(null)
  }

  const dismiss = async (dup: PossibleDuplicate): Promise<void> => {
    setBusyId(dup.id)
    await window.api.dismissDuplicate(dup.id)
    onChanged()
    refresh()
    setBusyId(null)
  }

  return (
    <section id="duplicates" className="settings-section">
      <div className="settings-section-head">
        <h2>
          Possible duplicates
          {!loading && dupes.length > 0 && <span className="nav-badge settings-count">{dupes.length}</span>}
        </h2>
        <p>
          Flagged when two records have a very similar name but no matching student ID or email — merge them, or
          dismiss if they&rsquo;re really two different people. Where the same name appears both ways round, one
          of the two has the first and last name swapped; a class list writes names as &ldquo;Last, First&rdquo;,
          so where one has been imported it settles which is right.
        </p>
      </div>

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : dupes.length === 0 ? (
        <div className="card empty-state" style={{ padding: 28 }}>No possible duplicates to review.</div>
      ) : (
        dupes.map((dup) => (
          <div className="card" key={dup.id}>
            <div className="dup-head">
              <span className="badge badge-warn">
                {dup.reversedName ? 'Name the wrong way round' : `${Math.round(dup.score * 100)}% name match`}
              </span>
              <p className="text-faint dup-reason">{dup.reason}</p>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              <StudentCard s={dup.studentA} />
              <StudentCard s={dup.studentB} />
            </div>
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <button
                className={`btn btn-sm${dup.confirmedNameSide === 'a' ? ' btn-primary' : ''}`}
                disabled={busyId === dup.id}
                onClick={() => merge(dup, dup.studentA.id)}
              >
                Merge → keep &quot;{dup.studentA.firstName} {dup.studentA.lastName}&quot;
                {dup.confirmedNameSide === 'a' && ' — name confirmed'}
              </button>
              <button
                className={`btn btn-sm${dup.confirmedNameSide === 'b' ? ' btn-primary' : ''}`}
                disabled={busyId === dup.id}
                onClick={() => merge(dup, dup.studentB.id)}
              >
                Merge → keep &quot;{dup.studentB.firstName} {dup.studentB.lastName}&quot;
                {dup.confirmedNameSide === 'b' && ' — name confirmed'}
              </button>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={busyId === dup.id} onClick={() => dismiss(dup)}>
                Not a duplicate
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  )
}

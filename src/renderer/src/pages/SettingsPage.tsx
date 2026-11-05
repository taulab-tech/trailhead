import React, { useEffect, useState } from 'react'
import DuplicatesReview from '../components/DuplicatesReview'

const splitNames = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean)

export default function SettingsPage({
  focus,
  onChanged
}: {
  /** A section to scroll to on open, e.g. "duplicates". */
  focus?: string | null
  onChanged: () => void
}): React.JSX.Element {
  const [saved, setSaved] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [helperDraft, setHelperDraft] = useState('')
  const [helperStatus, setHelperStatus] = useState<string | null>(null)
  const [wiping, setWiping] = useState(false)
  const [wipeStatus, setWipeStatus] = useState<string | null>(null)

  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ block: 'start' })
  }, [focus])

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSaved(s.institutionNames)
      setDraft(s.institutionNames.join(', '))
      setHelperDraft(s.lookupHelperUrl ?? '')
      setLoading(false)
    })
  }, [])

  const dirty = splitNames(draft).join('|') !== saved.join('|')

  const save = async (): Promise<void> => {
    const result = await window.api.setInstitutionNames(splitNames(draft))
    setSaved(result)
    setDraft(result.join(', '))
    setStatus(result.length ? 'Saved.' : 'Cleared.')
  }

  const wipeAll = async (): Promise<void> => {
    if (
      !confirm(
        'Wipe ALL data — every student, event, course and attendance record? A copy is saved first, but this cannot be undone from inside the app. Continue?'
      )
    ) {
      return
    }
    setWiping(true)
    setWipeStatus(null)
    try {
      const safety = await window.api.wipeDatabase()
      setWipeStatus(safety ? `Wiped. A copy was saved as ${safety}.` : 'Wiped.')
      onChanged()
    } catch (err) {
      setWipeStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setWiping(false)
    }
  }

  const saveHelper = async (): Promise<void> => {
    try {
      const saved = await window.api.setLookupHelperUrl(helperDraft.trim() || null)
      setHelperDraft(saved ?? '')
      setHelperStatus(saved ? 'Saved.' : 'Cleared.')
    } catch (err) {
      setHelperStatus(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Details about your program, and housekeeping for your student records.</p>
        </div>
      </div>

      {window.api.capabilities.usesLocalLookupHelper && (
        <div className="card settings-card">
          <div className="settings-row">
            <div className="settings-copy">
              <h3>Looking people up</h3>
              <p>
                A web page can&rsquo;t search for somebody: a search engine won&rsquo;t let a page read
                its reply. So the search runs in a small program on this computer and the app asks it
                — which also means the search goes out from your own connection, not a server&rsquo;s.
              </p>
              <p>
                Run <code>pip install ddgs</code> once, then{' '}
                <code>python trailhead_lookup.py</code> from the <code>lookup-helper</code> folder.
                That is all &mdash; the app looks for it at its usual address and uses it when it is
                there. Only fill this in if you started it on a different port. When it isn&rsquo;t
                running, the app offers to open the search in a tab instead.
              </p>
            </div>
            <div className="settings-control">
              <label htmlFor="helper-url">Helper address (only if you changed the port)</label>
              <input
                id="helper-url"
                type="text"
                placeholder="http://127.0.0.1:8765"
                value={helperDraft}
                onChange={(e) => {
                  setHelperDraft(e.target.value)
                  setHelperStatus(null)
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={saveHelper}>
                  Save
                </button>
                <button
                  className="btn btn-sm"
                  disabled={!helperDraft.trim()}
                  onClick={async () => {
                    setHelperStatus('Checking…')
                    const running = await window.api.checkLookupHelper(helperDraft.trim())
                    setHelperStatus(running ? 'Running — the lookup is ready.' : 'No answer. Is it started?')
                  }}
                >
                  Check it&rsquo;s running
                </button>
                {helperStatus && <span className="text-faint">{helperStatus}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card settings-card">
        <div className="settings-row">
          <div className="settings-copy">
            <h3>Your institution</h3>
            <p>
              When you look a student up on LinkedIn, profiles that mention your institution are listed first
              and marked as likely matches. Add every name people use for it, separated by commas — for example
              the full name and its short forms.
            </p>
          </div>
          <div className="settings-control">
            <label htmlFor="institution-names">Names</label>
            <input
              id="institution-names"
              type="text"
              placeholder="e.g. University of Saskatchewan, USask, U of S"
              value={draft}
              disabled={loading}
              onChange={(e) => {
                setDraft(e.target.value)
                setStatus(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dirty) save()
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={!dirty || loading} onClick={save}>
                Save
              </button>
              {status && <span className="settings-status">{status}</span>}
            </div>
          </div>
        </div>
      </div>

      <DuplicatesReview onChanged={onChanged} />
      <div className="card settings-card settings-danger">
        <div className="settings-row">
          <div className="settings-copy">
            <h3>Wipe all data</h3>
            <p>
              Deletes every student, event, course and attendance record in the database that is
              open. A copy is saved first, but this can&rsquo;t be undone from inside the app.
            </p>
          </div>
          <div className="settings-control">
            <button className="btn btn-danger" disabled={wiping} onClick={wipeAll}>
              {wiping ? 'Wiping…' : 'Wipe all data'}
            </button>
            {wipeStatus && (
              <div className="text-faint" style={{ marginTop: 10 }}>
                {wipeStatus}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

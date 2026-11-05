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
  const [keyDraft, setKeyDraft] = useState('')
  const [keyStatus, setKeyStatus] = useState<string | null>(null)
  const [checkingKey, setCheckingKey] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [wipeStatus, setWipeStatus] = useState<string | null>(null)

  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ block: 'start' })
  }, [focus])

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSaved(s.institutionNames)
      setDraft(s.institutionNames.join(', '))
      setKeyDraft(s.searchApiKey ?? '')
      setLoading(false)
    })
  }, [])

  const dirty = splitNames(draft).join('|') !== saved.join('|')

  const saveKey = async (): Promise<void> => {
    setCheckingKey(true)
    setKeyStatus(null)
    try {
      const trimmed = keyDraft.trim()
      if (trimmed && !(await window.api.checkSearchApiKey(trimmed))) {
        setKeyStatus('That key was not accepted. Check it and try again.')
        return
      }
      const stored = await window.api.setSearchApiKey(trimmed || null)
      setKeyDraft(stored ?? '')
      setKeyStatus(stored ? 'Working — lookups will run in the app now.' : 'Cleared.')
      onChanged()
    } catch (err) {
      setKeyStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setCheckingKey(false)
    }
  }

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Details about your program, and housekeeping for your student records.</p>
        </div>
      </div>

      {window.api.capabilities.needsSearchKey && (
        <div className="card settings-card" id="lookup-key">
          <div className="settings-row">
            <div className="settings-copy">
              <h3>Looking people up</h3>
              <p>
                Without a key, the LinkedIn button opens a search in a new tab for you to read. With
                one, the app does the search itself and shows you the profiles to pick from — which
                is the only version that works on a computer you can&rsquo;t install anything on.
              </p>
              <p>
                Get one free at <code>serper.dev</code> — sign in, copy the key from the dashboard,
                paste it here. It is 2,500 searches and asks for no card. The key is saved in your
                database file. The only thing ever sent is the name you are searching for, which is
                what the tab was carrying anyway.
              </p>
            </div>
            <div className="settings-control">
              <label htmlFor="search-key">Search key</label>
              <input
                id="search-key"
                type="password"
                autoComplete="off"
                placeholder="paste it here"
                value={keyDraft}
                disabled={loading}
                onChange={(e) => {
                  setKeyDraft(e.target.value)
                  setKeyStatus(null)
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" disabled={checkingKey} onClick={saveKey}>
                  {checkingKey ? 'Checking…' : 'Save'}
                </button>
                {keyStatus && <span className="text-faint">{keyStatus}</span>}
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

import React, { useEffect, useState } from 'react'

const splitNames = (raw: string): string[] =>
  raw
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean)

export default function SettingsPage(): React.JSX.Element {
  const [saved, setSaved] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSaved(s.institutionNames)
      setDraft(s.institutionNames.join(', '))
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Details about your program that Trailhead uses behind the scenes.</p>
        </div>
      </div>

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
    </div>
  )
}

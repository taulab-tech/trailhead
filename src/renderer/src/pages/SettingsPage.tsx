import React, { useEffect, useState } from 'react'
import { useDataVersion } from '../DataContext'

export default function SettingsPage(): React.JSX.Element {
  const { bump } = useDataVersion()
  const [saved, setSaved] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSaved(s.schoolEmailDomain)
      setDomain(s.schoolEmailDomain ?? '')
      setLoading(false)
    })
  }, [])

  const dirty = domain.trim().toLowerCase().replace(/^@/, '') !== (saved ?? '')

  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      const result = await window.api.setSchoolEmailDomain(domain)
      setSaved(result)
      setDomain(result ?? '')
      setStatus({
        kind: 'ok',
        text: result ? `Saved. IDs written as …@${result} now match the bare ID.` : 'Cleared.'
      })
      bump()
    } catch (err) {
      // IPC wraps thrown errors as "Error invoking remote method '…': Error: <message>".
      const message = err instanceof Error ? err.message.replace(/^.*Error: /, '') : String(err)
      setStatus({ kind: 'error', text: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Adjust how Trailhead reads your rosters.</p>
        </div>
      </div>

      <div className="card settings-card">
        <div className="settings-row">
          <div className="settings-copy">
            <h3>School email domain</h3>
            <p>
              Some rosters list a student’s ID on its own (<span className="mono">abc123</span>) and others as
              their school email (<span className="mono">abc123@school.edu</span>). Enter your school’s domain
              so both count as the same student. Leave it blank if your IDs aren’t email-based.
            </p>
          </div>
          <div className="settings-control">
            <label htmlFor="school-domain">Domain</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="school-domain"
                type="text"
                placeholder="e.g. school.edu"
                value={domain}
                disabled={loading}
                onChange={(e) => {
                  setDomain(e.target.value)
                  setStatus(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dirty) save()
                }}
              />
              <button className="btn btn-primary" disabled={!dirty || saving || loading} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {status && (
              <p className={`settings-status ${status.kind === 'error' ? 'is-error' : ''}`}>{status.text}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

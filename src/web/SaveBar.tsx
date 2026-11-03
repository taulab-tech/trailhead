import React, { useEffect, useState } from 'react'
import { downloadDatabase, save, saveAs, sessionState, subscribeToSession, type SessionState } from './session'
import { createDatabaseFile, supportsFileHandles } from './storage'

function savedAgo(at: Date): string {
  const seconds = Math.round((Date.now() - at.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * A strip along the bottom saying where the data is and whether it has been
 * written yet. The desktop app never needed one — it owns its file and saves
 * continuously. On the web, people are right to want to see that.
 */
export default function SaveBar(): React.JSX.Element {
  const [state, setState] = useState<SessionState>(sessionState)
  const [, setTick] = useState(0)

  useEffect(() => subscribeToSession(setState), [])
  // Keeps "saved 2 min ago" honest without any other reason to re-render.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  const chooseFile = async (): Promise<void> => {
    const handle = await createDatabaseFile()
    if (handle) await saveAs(handle)
  }

  let status: React.ReactNode
  if (state.error) status = <span className="savebar-error">{state.error}</span>
  else if (state.saving) status = <span>Saving…</span>
  else if (state.savesInPlace) {
    status = state.unsavedChanges ? (
      <span>Unsaved changes</span>
    ) : (
      <span className="savebar-ok">Saved{state.lastSavedAt ? ` ${savedAgo(state.lastSavedAt)}` : ''}</span>
    )
  } else {
    status = (
      <span className="savebar-warn">
        Kept in this browser — download to keep a copy
      </span>
    )
  }

  return (
    <div className="savebar">
      <span className="savebar-file" title={state.fileName ?? undefined}>
        {state.fileName}
      </span>
      <span className="savebar-status">{status}</span>
      <div className="savebar-actions">
        {state.savesInPlace ? (
          <button className="btn btn-sm" onClick={() => void save()} disabled={state.saving || !state.unsavedChanges}>
            Save now
          </button>
        ) : (
          supportsFileHandles() && (
            <button className="btn btn-sm" onClick={() => void chooseFile()}>
              Save to a file…
            </button>
          )
        )}
        <button className="btn btn-sm" onClick={() => downloadDatabase()}>
          Download a copy
        </button>
      </div>
    </div>
  )
}

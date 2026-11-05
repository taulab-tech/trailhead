import React, { useEffect, useState } from 'react'
import Logo from '../renderer/src/components/Logo'
import { discardRecoveryCopy, openSession, recoverSession, startNewSession } from './session'
import {
  createDatabaseFile,
  loadRecoveryCopy,
  pickDatabaseFile,
  readDroppedDatabase,
  recallFileHandle,
  reopenRememberedFile,
  supportsFileHandles
} from './storage'

/**
 * The first thing someone sees on the web: a prompt to open their Trailhead
 * file, because until they do there is no data and nothing to show.
 *
 * This screen is the whole privacy story in one place. The file is opened
 * from their own disk, by them. Nothing is uploaded, and there is nowhere to
 * upload it to.
 */
export default function StartGate({ onOpened }: { onOpened: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFile, setLastFile] = useState<FileSystemFileHandle | null>(null)
  const [recovery, setRecovery] = useState<Uint8Array | null>(null)
  const [dragging, setDragging] = useState(false)
  const inPlace = supportsFileHandles()

  useEffect(() => {
    void recallFileHandle().then(setLastFile)
    void loadRecoveryCopy().then(setRecovery)
  }, [])

  /** Runs an action that opens a database, surfacing anything that goes wrong. */
  const attempt = async (action: () => Promise<boolean>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (await action()) onOpened()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openExisting = (): Promise<void> =>
    attempt(async () => {
      const file = await pickDatabaseFile()
      if (!file) return false
      await openSession(file)
      return true
    })

  const startFresh = (): Promise<void> =>
    attempt(async () => {
      // Asked again here rather than reused from render, so the answer is
      // always the browser's current one. Without file handles there is
      // nothing to point at yet; the database lives in the tab until it's
      // downloaded.
      const canSaveInPlace = supportsFileHandles()
      const handle = canSaveInPlace ? await createDatabaseFile() : null
      if (canSaveInPlace && !handle) return false
      await startNewSession(handle)
      return true
    })

  const reopenLast = (handle: FileSystemFileHandle): Promise<void> =>
    attempt(async () => {
      const file = await reopenRememberedFile(handle)
      if (!file) {
        setError('That file could not be reopened. It may have been moved or renamed.')
        return false
      }
      await openSession(file)
      return true
    })

  const restoreRecovery = (bytes: Uint8Array): Promise<void> =>
    attempt(async () => {
      await recoverSession(bytes)
      return true
    })

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    void attempt(async () => {
      await openSession(await readDroppedDatabase(file))
      return true
    })
  }

  return (
    <div className="gate">
      <div
        className={`gate-card ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="gate-brand">
          <Logo />
          <h1>Trailhead</h1>
        </div>
        <p className="gate-lede">
          Attendance and student-pathway tracking. Open your database file to begin — it stays on this
          computer, and nothing is sent anywhere.
        </p>

        {lastFile && (
          <button className="btn btn-primary gate-action" disabled={busy} onClick={() => reopenLast(lastFile)}>
            Reopen {lastFile.name}
          </button>
        )}

        <div className="gate-actions">
          <button className={`btn ${lastFile ? '' : 'btn-primary'}`} disabled={busy} onClick={openExisting}>
            Open a database…
          </button>
          <button className="btn" disabled={busy} onClick={startFresh}>
            Start a new one
          </button>
        </div>

        <p className="gate-hint">
          or drop a .db file here &mdash; spreadsheets go on the Import screen, once a database is open
        </p>

        {recovery && (
          <div className="gate-recovery">
            <strong>Unsaved work found.</strong> A database was left open in this browser without being
            saved to a file. The copy is on this computer, in this browser’s own storage for this site —
            it was never sent anywhere.
            <div className="gate-recovery-actions">
              <button className="review-link" disabled={busy} onClick={() => restoreRecovery(recovery)}>
                Open it
              </button>
              <button
                className="review-link"
                disabled={busy}
                onClick={async () => {
                  if (!confirm('Delete the copy this browser is holding? Anything in it that was never saved to a file is gone.')) return
                  await discardRecoveryCopy()
                  setRecovery(null)
                }}
              >
                Delete it
              </button>
            </div>
          </div>
        )}

        {error && <p className="gate-error">{error}</p>}

        <p className="gate-note">
          {inPlace
            ? 'Your changes save straight back to the file you pick, the way a desktop app would.'
            : 'This browser can’t save back to a file on its own, so your work is kept in the browser and you download the database when you’re done. Edge or Chrome can save in place.'}
        </p>
      </div>
    </div>
  )
}

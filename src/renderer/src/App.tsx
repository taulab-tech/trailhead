import React, { useEffect, useState } from 'react'
import { DataProvider, useDataVersion } from './DataContext'
import ImportPage from './pages/ImportPage'
import StudentsPage from './pages/StudentsPage'
import EventsPage from './pages/EventsPage'
import DuplicatesPage from './pages/DuplicatesPage'
import DashboardPage from './pages/DashboardPage'
import GroupsPage from './pages/GroupsPage'

type Page = 'import' | 'students' | 'events' | 'duplicates' | 'dashboard' | 'groups'

type DbAction = 'export' | 'restore' | 'wipe' | null

function Shell(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')
  const [pendingDuplicates, setPendingDuplicates] = useState(0)
  const [dbAction, setDbAction] = useState<DbAction>(null)
  const [dbStatus, setDbStatus] = useState<string | null>(null)
  const { version, bump } = useDataVersion()

  useEffect(() => {
    window.api.listDuplicates('pending').then((rows) => setPendingDuplicates(rows.length))
  }, [version])

  const exportBackup = async (): Promise<void> => {
    setDbAction('export')
    setDbStatus(null)
    try {
      const savedAs = await window.api.backupDatabase()
      setDbStatus(savedAs ? `Saved ${savedAs}` : null)
    } catch (err) {
      setDbStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setDbAction(null)
    }
  }

  const restoreBackup = async (): Promise<void> => {
    if (
      !confirm(
        'Restore will replace all current students, events, and attendance records with the selected backup file. A safety copy of the current database is saved first. Continue?'
      )
    ) {
      return
    }
    setDbAction('restore')
    setDbStatus(null)
    try {
      const restoredFrom = await window.api.restoreDatabase()
      // On success the main process reloads this window, so this only ever
      // runs when the file picker was canceled.
      if (!restoredFrom) setDbAction(null)
    } catch (err) {
      setDbStatus(err instanceof Error ? err.message : String(err))
      setDbAction(null)
    }
  }

  const wipeAll = async (): Promise<void> => {
    if (
      !confirm(
        'Wipe ALL data — every student, event, and attendance record? A safety backup is saved first, but this cannot be undone from inside the app. Continue?'
      )
    ) {
      return
    }
    setDbAction('wipe')
    setDbStatus(null)
    try {
      const safetyBackup = await window.api.wipeDatabase()
      setDbStatus(safetyBackup ? `Wiped. Safety copy: ${safetyBackup}` : null)
      bump()
    } catch (err) {
      setDbStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setDbAction(null)
    }
  }

  const nav: { key: Page; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'import', label: 'Import' },
    { key: 'students', label: 'Students' },
    { key: 'events', label: 'Programs & Events' },
    { key: 'groups', label: 'Funnel Groups' },
    { key: 'duplicates', label: 'Duplicates' }
  ]

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          SIGMA<span>Track</span>
        </div>
        {nav.map((item) => (
          <div
            key={item.key}
            className={`nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            <span>{item.label}</span>
            {item.key === 'duplicates' && pendingDuplicates > 0 && (
              <span className="nav-badge">{pendingDuplicates}</span>
            )}
          </div>
        ))}
        <div className="sidebar-footer">
          <div className="text-faint" style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em', marginBottom: 6 }}>
            Data
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              disabled={dbAction !== null}
              onClick={exportBackup}
            >
              {dbAction === 'export' ? 'Exporting…' : 'Export backup…'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              disabled={dbAction !== null}
              onClick={restoreBackup}
            >
              {dbAction === 'restore' ? 'Restoring…' : 'Restore from backup…'}
            </button>
            <button
              className="btn btn-danger btn-sm"
              style={{ width: '100%' }}
              disabled={dbAction !== null}
              onClick={wipeAll}
            >
              {dbAction === 'wipe' ? 'Wiping…' : 'Wipe all data'}
            </button>
          </div>
          {dbStatus && <div style={{ marginTop: 6 }}>{dbStatus}</div>}
          <div style={{ marginTop: 10 }}>
            Local &amp; offline.
            <br />
            Your data never leaves this computer.
          </div>
        </div>
      </div>
      <div className="content">
        {page === 'dashboard' && <DashboardPage onNavigate={setPage as (p: string) => void} />}
        {page === 'import' && <ImportPage onImported={bump} />}
        {page === 'students' && <StudentsPage />}
        {page === 'events' && <EventsPage />}
        {page === 'groups' && <GroupsPage />}
        {page === 'duplicates' && <DuplicatesPage onChanged={bump} />}
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

import React, { useEffect, useState } from 'react'
import { DataProvider, useDataVersion } from './DataContext'
import ImportPage from './pages/ImportPage'
import StudentsPage, { type StudentsView } from './pages/StudentsPage'
import EventsPage from './pages/EventsPage'
import DashboardPage from './pages/DashboardPage'
import TrailPage from './pages/TrailPage'
import SettingsPage from './pages/SettingsPage'
import Logo from './components/Logo'

type Page = 'import' | 'students' | 'events' | 'dashboard' | 'groups' | 'settings'

type DbAction = 'export' | 'restore' | 'wipe' | null

/** Minimal stroked line icon; `d` is one SVG path on a 24×24 grid. */
function Icon({ d, size = 16 }: { d: string; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

function Shell(): React.JSX.Element {
  const [page, setPage] = useState<Page>('dashboard')
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null)
  const [studentsView, setStudentsView] = useState<StudentsView>('list')

  /**
   * Pages link to each other by name. "duplicates" is a section of Settings
   * and "lookups" (LinkedIn matches) a tab of Students.
   */
  const navigate = (target: string): void => {
    setSettingsFocus(target === 'duplicates' ? 'duplicates' : null)
    setStudentsView(target === 'lookups' ? 'matches' : 'list')
    if (target === 'duplicates') setPage('settings')
    else if (target === 'lookups') setPage('students')
    else setPage(target as Page)
  }
  const [pendingDuplicates, setPendingDuplicates] = useState(0)
  const [dbAction, setDbAction] = useState<DbAction>(null)
  const [dbStatus, setDbStatus] = useState<string | null>(null)
  const { version, bump } = useDataVersion()

  useEffect(() => {
    window.api.listDuplicates('pending').then((rows) => setPendingDuplicates(rows.length))
  }, [version])

  // Background LinkedIn lookups finish while the user is elsewhere; keep the badge current.
  const [lookupsToReview, setLookupsToReview] = useState(0)
  useEffect(() => {
    const refresh = (): void => {
      window.api.getLookupStatus().then((s) => setLookupsToReview(s.done + s.failed))
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
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

  const nav: { key: Page; label: string; icon: React.JSX.Element }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <Icon d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" /> },
    { key: 'import', label: 'Import', icon: <Icon d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /> },
    {
      key: 'students',
      label: 'Students',
      icon: <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    },
    { key: 'events', label: 'Programs & Events', icon: <Icon d="M3 5h18v16H3zM16 3v4M8 3v4M3 10h18" /> },
    {
      key: 'groups',
      label: 'The Trail',
      icon: <Icon d="M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 17V11a4 4 0 0 1 4-4h6M18 7v6a4 4 0 0 1-4 4H8" />
    }
  ]

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Logo size={34} />
          </div>
          <div>
            <div className="brand-name">Trailhead</div>
            <div className="brand-sub">Attendance &amp; pathways</div>
          </div>
        </div>
        <div className="nav-section-label">Workspace</div>
        {nav.map((item) => (
          <div
            key={item.key}
            className={`nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => navigate(item.key)}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
            {item.key === 'students' && lookupsToReview > 0 && (
              <span className="nav-badge" title={`${lookupsToReview} LinkedIn match${lookupsToReview === 1 ? '' : 'es'} to review`}>
                {lookupsToReview}
              </span>
            )}
          </div>
        ))}
        <div className="sidebar-footer">
          <div
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
            style={{ marginBottom: 12 }}
          >
            <Icon d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
            <span className="nav-label">Settings</span>
            {pendingDuplicates > 0 && (
              <span className="nav-badge" title={`${pendingDuplicates} possible duplicate${pendingDuplicates === 1 ? '' : 's'} to review`}>
                {pendingDuplicates}
              </span>
            )}
          </div>
          <div className="nav-section-label">Data</div>
          <button className="sidebar-action" disabled={dbAction !== null} onClick={exportBackup}>
            <Icon d="M12 3v12M7 10l5 5 5-5M4 21h16" />
            {dbAction === 'export' ? 'Exporting…' : 'Export backup…'}
          </button>
          <button className="sidebar-action" disabled={dbAction !== null} onClick={restoreBackup}>
            <Icon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
            {dbAction === 'restore' ? 'Restoring…' : 'Restore from backup…'}
          </button>
          <button className="sidebar-action danger" disabled={dbAction !== null} onClick={wipeAll}>
            <Icon d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            {dbAction === 'wipe' ? 'Wiping…' : 'Wipe all data'}
          </button>
          {dbStatus && <div className="sidebar-status">{dbStatus}</div>}
          <div className="sidebar-note">
            <Icon d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" size={14} />
            Stored locally · works offline
          </div>
        </div>
      </div>
      <div className="content">
        {page === 'dashboard' && <DashboardPage onNavigate={navigate} />}
        {page === 'import' && <ImportPage onImported={bump} onNavigate={navigate} />}
        {page === 'students' && <StudentsPage key={studentsView} initialView={studentsView} onNavigate={navigate} />}
        {page === 'events' && <EventsPage />}
        {page === 'groups' && <TrailPage />}
        {page === 'settings' && <SettingsPage focus={settingsFocus} onChanged={bump} />}
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

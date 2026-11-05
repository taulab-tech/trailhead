import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { closeDb, openDb } from './db/desktop'
import { runAutoBackup } from './backup'
import { harmonizeClasslistEventNames } from './importer'
import { migrateLegacyDataDir } from './dataDir'
import { seedCertificatesIfEmpty } from './db/certificates'
import { setSearchTransport } from './positionLookup'
import { pythonSearch } from './pythonSearch'
import { setWorkbookReader } from './workbooks'
import { desktopWorkbookReader } from './workbooksDesktop'

// Dev runs and installed builds share one data folder (%APPDATA%\Trailhead on
// Windows), whatever the package or product name. Test harnesses point
// TRAILHEAD_DB_PATH at a throwaway database and keep their own folder.
if (!process.env.TRAILHEAD_DB_PATH) {
  const dataDir = join(app.getPath('appData'), 'Trailhead')
  app.setPath('userData', dataDir)
  migrateLegacyDataDir(join(app.getPath('appData'), 'sigma-attendance'), dataDir)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f3',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setWorkbookReader(desktopWorkbookReader)
  setSearchTransport(pythonSearch)
  openDb() // ensure schema exists before any window opens
  seedCertificatesIfEmpty()
  harmonizeClasslistEventNames()
  registerIpcHandlers()
  createWindow()

  runAutoBackup().catch((err) => console.error('Auto-backup failed:', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

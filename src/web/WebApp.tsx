import React, { useEffect, useState } from 'react'
import App from '../renderer/src/App'
import StartGate from './StartGate'
import SaveBar from './SaveBar'
import { sessionState, subscribeToSession, warnBeforeLeaving } from './session'

/**
 * The web build's shell: the start gate until a database is open, then the
 * same App the desktop build runs, with a save-status strip underneath.
 */
export default function WebApp(): React.JSX.Element {
  const [open, setOpen] = useState(() => sessionState().fileName !== null)

  useEffect(() => {
    warnBeforeLeaving()
    return subscribeToSession((state) => setOpen(state.fileName !== null))
  }, [])

  if (!open) return <StartGate onOpened={() => setOpen(true)} />

  return (
    <div className="web-shell">
      <div className="web-shell-app">
        <App />
      </div>
      <SaveBar />
    </div>
  )
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { configureSqlJs } from './sqljs'
import { installWebApi } from './api'
import WebApp from './WebApp'
import '../renderer/src/styles.css'
import './web.css'

// `frame-ancestors` only counts as an HTTP header, and GitHub Pages can't
// send one, so break out of any frame rather than let another site wrap the
// app around someone's student data. A framer that blocks the escape gets a
// blank page instead.
if (window.top !== window.self) {
  try {
    window.top!.location.replace(window.self.location.href)
  } catch {
    document.documentElement.remove()
  }
}

// Vite turns this into a hashed file served beside the page, so SQLite's
// WebAssembly comes from our own origin and never a CDN.
configureSqlJs(() => wasmUrl)

// The screens expect `window.api` to exist before they render, exactly as the
// Electron preload script guarantees.
installWebApi()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Registered after load so a failure never delays the first paint. Once it
  // has run, the app opens with no network at all. Some browsers and managed
  // environments refuse service workers outright; that only costs offline
  // use, so it's logged and shrugged off rather than surfaced.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => console.warn('Offline support unavailable:', error))
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>
)

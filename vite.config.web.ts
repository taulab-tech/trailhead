import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The browser build.
 *
 * Same React screens as the desktop app, with `src/web` standing in for the
 * Electron main process. The output is a folder of static files — no server,
 * no API, nothing that could receive a database even if someone sent one.
 *
 * `BASE_PATH` sets the URL the app is served from: "/" for a custom domain
 * such as trailhead.keensite.ca, or "/<repo>/" for a default GitHub Pages
 * project URL.
 */

/**
 * Writes a service worker that precaches the build.
 *
 * Generated rather than hand-written because the file names are hashed, and
 * a stale precache list means a half-cached app. The point of it is offline
 * use: once the page has loaded, Trailhead runs with the network off — which
 * is also the simplest way to show that it doesn't need one.
 */
function serviceWorker(): Plugin {
  return {
    name: 'trailhead-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const base = process.env.BASE_PATH ?? '/'
      const assets = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map'))
        .map((name) => JSON.stringify(base + name))
      const version = Date.now().toString(36)

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time by vite.config.web.ts — do not edit.
const CACHE = 'trailhead-${version}'
const ASSETS = [${[JSON.stringify(base), ...assets].join(', ')}]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

const SHELL = ${JSON.stringify(base)}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  // The page itself is fetched from the network first, so a deploy is picked
  // up the next time someone opens the app rather than a reload later. The
  // cached copy is the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(SHELL, copy)))
          return response
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error()))
    )
    return
  }

  // Everything else is a build asset whose name carries a content hash, so a
  // cached copy can never be the wrong one.
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)))
})
`
      })
    }
  }
}

export default defineConfig({
  root: 'src/web',
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), serviceWorker()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'src/web/index.html')
    }
  },
  server: {
    port: 5174
  }
})

import type { Plugin } from 'vite'

/**
 * Emits a service worker precaching exactly the files this build produced. The
 * whole requirement is opening the app at a venue with no signal.
 */
export default function serviceWorker(version: string): Plugin {
  return {
    name: 'countoff-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Every browser that supports service workers also supports woff2, so the
      // 3 MB legacy font fallbacks ship but never enter the offline precache.
      const skip = /\.(map|ttf|woff|eot)$|Phosphor.*\.svg$/
      const assets = Object.keys(bundle)
        .filter((name) => !skip.test(name))
        .map((name) => `./${name}`)
      // public/ files are copied outside the bundle, so name them explicitly.
      const staticFiles = ['./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png']
      const precache = ['./', './index.html', ...staticFiles, ...assets]

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'countoff-${version}'
const PRECACHE = ${JSON.stringify([...new Set(precache)], null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigations fall back to the cached shell so a cold start with no signal
  // still boots the app instead of showing the browser's offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
`,
      })
    },
  }
}

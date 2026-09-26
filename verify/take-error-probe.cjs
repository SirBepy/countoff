/* Proves the background take download refuses a bad HTTP response instead of caching it.
   `fetch` rejects on a dropped link but not on a 404, so before src/lib/takes.ts guarded
   `res.ok` the error page's body was read as footage and written into IndexedDB as that
   take's file - corruption that outlives the session, because a local copy wins over
   Storage on every later visit.

   Both halves matter. The 404 pass alone would also read green if the download never ran
   at all, so the second pass answers the same URLs with real bytes and asserts the take
   DOES get cached: that is what makes the first pass's empty store evidence of the guard
   rather than evidence of a dead code path. */
const path = require('path')
const { withBrowser, screenshotDir, createChecklist } = require('./harness.cjs')

const WHERE = process.argv[2] || '42210'
const TOKEN = process.argv[3] || '984a22aa0d1940429f665f80520cb562'
const BASE = WHERE.startsWith('http') ? WHERE.replace(/\/$/, '') : `http://localhost:${WHERE}`
const URL = `${BASE}/#${TOKEN}`

const TAKE_URL = /firebasestorage\.googleapis\.com\/.*takes%2F/
const GOOD_BYTES = Buffer.from('not really an mp4, but it is a body with a 200 on it')

/** Counts the take-object requests the page makes, so an empty cache can be told apart
 *  from a download that never fired. */
function countTakeRequests(page) {
  const seen = []
  const listener = (req) => {
    if (TAKE_URL.test(req.url())) seen.push(req.url())
  }
  page.on('request', listener)
  return { seen, stop: () => page.off('request', listener) }
}

async function waitBooted(page) {
  await page.waitForSelector('.rehearse-top', { timeout: 60000 })
  // The download loop starts at the first moment the audio element is not advancing,
  // which on a fresh share load is immediately. This is the window it runs in.
  await page.waitForTimeout(6000)
}

/** Keys present in the 'takes' object store: one key per take whose file has been
 *  cached locally. This is exactly what saveTakeFile writes into. */
async function cachedTakeKeys(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((resolve, reject) => {
      const r = db.transaction('takes', 'readonly').objectStore('takes').getAllKeys()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  })
}

withBrowser(async (browser) => {
  const { check, report } = createChecklist()
  const context = await browser.newContext()
  const page = await context.newPage()
  const dir = screenshotDir('take-error')

  // Pass 1: every take object answers 404 with an HTML error body, the shape a bucket
  // uses for a missing object.
  let status = 404
  await page.route(TAKE_URL, (route) =>
    route.fulfill(
      status === 404
        ? { status: 404, contentType: 'text/html', body: '<!doctype html><title>Not Found</title>' }
        : { status: 200, contentType: 'video/mp4', body: GOOD_BYTES },
    ),
  )

  const r1 = countTakeRequests(page)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitBooted(page)
  await page.screenshot({ path: path.join(dir, '1-take-404.png') })
  const keys1 = await cachedTakeKeys(page)
  r1.stop()

  console.log(`404 pass -> take requests=${r1.seen.length} cached take keys=${JSON.stringify(keys1)}`)
  check('the share still boots when its takes 404', !!(await page.$('.rehearse-top')), 'rehearse-top present')
  check('the take download was actually attempted', r1.seen.length > 0, `requests=${r1.seen.length}`)
  check('a 404 is never written into the take cache', keys1.length === 0, `cached keys=${JSON.stringify(keys1)}`)

  // Pass 2: same URLs, same run, answered 200. The take must now land in the cache -
  // otherwise pass 1 proved nothing.
  status = 200
  const r2 = countTakeRequests(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitBooted(page)
  await page.screenshot({ path: path.join(dir, '2-take-200.png') })
  const keys2 = await cachedTakeKeys(page)
  r2.stop()

  console.log(`200 pass -> take requests=${r2.seen.length} cached take keys=${JSON.stringify(keys2)}`)
  // Without this the pass below reads green on a run where pass 1 left blobs behind:
  // attachSharedTakes finds a local copy and never downloads, so `keys2` is just pass 1's
  // corruption seen twice. The request count is what separates the two.
  check('the second pass downloaded rather than reusing pass 1', r2.seen.length > 0, `requests=${r2.seen.length}`)
  check('a good response still gets cached', keys2.length > 0, `cached keys=${JSON.stringify(keys2)}`)

  await context.close()
  const ok = report()
  if (!ok) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})

/* Proves the shared-link cache: counts firestore/storage requests on a fresh load vs
   a same-context reload, then proves a corrupt cache falls back to the full download.
   Footage is proven by seeding one take's file directly (real Storage bandwidth here
   is far too slow to wait out a live download in a bounded probe). */
const path = require('path')
const { withBrowser, screenshotDir, createChecklist } = require('./harness.cjs')

const WHERE = process.argv[2] || '5173'
const TOKEN = process.argv[3] || '984a22aa0d1940429f665f80520cb562'
const BASE = WHERE.startsWith('http') ? WHERE.replace(/\/$/, '') : `http://localhost:${WHERE}`
const URL = `${BASE}/#${TOKEN}`

function countRequests(page) {
  const counts = { firestore: 0, storage: 0, storageByPath: {} }
  const listener = (req) => {
    const u = req.url()
    if (u.includes('firestore.googleapis.com')) counts.firestore++
    if (u.includes('firebasestorage.googleapis.com')) {
      counts.storage++
      const m = u.match(/takes%2F[^/?]+%2F([^?&]+)/)
      const id = m ? m[1] : u
      counts.storageByPath[id] = (counts.storageByPath[id] || 0) + 1
    }
  }
  page.on('request', listener)
  return { counts, stop: () => page.off('request', listener) }
}

async function waitBooted(page) {
  await page.waitForSelector('.rehearse-top', { timeout: 30000 })
  await page.waitForTimeout(1500)
}

async function readState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const shares = await new Promise((resolve, reject) => {
      const r = db.transaction('shares', 'readonly').objectStore('shares').getAll()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const takeKeys = await new Promise((resolve, reject) => {
      const r = db.transaction('takes', 'readonly').objectStore('takes').getAllKeys()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const name = document.querySelector('.rehearse-top strong')?.textContent ?? null
    return {
      name,
      shareCount: shares.length,
      chunks: shares[0]?.chunks ?? null,
      hasAudio: !!shares[0]?.audio,
      takes: (shares[0]?.project?.takes ?? []).map((t) => ({ id: t.id, url: t.url })),
      cachedTakeKeys: takeKeys,
    }
  })
}

/** Simulates "this take was already cached last visit" without waiting out this
 *  sandbox's very slow real Storage bandwidth: puts a small blob straight into the
 *  'takes' store under a real take id, matching what a finished background fetch leaves. */
async function seedTakeFile(page, takeId) {
  await page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const r = db.transaction('takes', 'readwrite').objectStore('takes').put(new Blob(['seeded']), id)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error)
    })
  }, takeId)
}

withBrowser(async (browser) => {
  const { check, report } = createChecklist()
  const context = await browser.newContext()
  const page = await context.newPage()
  const dir = screenshotDir('share-cache')

  const r1 = countRequests(page)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await waitBooted(page)
  await page.screenshot({ path: path.join(dir, '1-first-load.png') })
  const s1 = await readState(page)
  r1.stop()

  console.log(`First load  -> firestore=${r1.counts.firestore} storage=${r1.counts.storage}`)
  console.log(`First load state -> name=${s1.name} shareEntries=${s1.shareCount} chunks=${s1.chunks} hasAudio=${s1.hasAudio}`)
  console.log(`First load takes -> ${JSON.stringify(s1.takes.map((t) => t.id))}`)
  check('first load reaches rehearse with a project name', !!s1.name, s1.name ?? 'none')
  check('first load wrote a share cache entry', s1.shareCount === 1, `entries=${s1.shareCount}`)

  // Seed the first take's file as if a prior background fetch had already finished,
  // so the next load can prove the local-cache-hit path with no network wait.
  const seededTake = s1.takes[0]
  if (seededTake) await seedTakeFile(page, seededTake.id)

  const r2 = countRequests(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitBooted(page)
  await page.screenshot({ path: path.join(dir, '2-second-load.png') })
  const s2 = await readState(page)
  r2.stop()

  console.log(`Second load -> firestore=${r2.counts.firestore} storage=${r2.counts.storage}`)
  console.log(`Second load state -> name=${s2.name} shareEntries=${s2.shareCount} chunks=${s2.chunks} hasAudio=${s2.hasAudio}`)
  check('second load reaches the same project name', s2.name === s1.name, `${s1.name} vs ${s2.name}`)
  check('second load fires fewer firestore reads', r2.counts.firestore < r1.counts.firestore, `${r1.counts.firestore} -> ${r2.counts.firestore}`)
  check('cache still has the audio blob after reload', s2.hasAudio, `hasAudio=${s2.hasAudio}`)
  if (seededTake) {
    const hits = r2.counts.storageByPath[seededTake.id] || 0
    console.log(`Seeded take ${seededTake.id} storage requests on second load: ${hits}`)
    check('a take cached locally is never re-fetched from Storage', hits === 0, `requests for ${seededTake.id}=${hits}`)
  }

  // Corrupt the cached entry the way an old-schema record or a quota eviction would:
  // wrong shape, no audio. loadShareCache must reject it and fall back to a full fetch.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('shares', 'readwrite')
    const keys = await new Promise((resolve, reject) => {
      const r = tx.objectStore('shares').getAllKeys()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    for (const k of keys) tx.objectStore('shares').put({ garbage: true }, k)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  })

  const r3 = countRequests(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitBooted(page)
  await page.screenshot({ path: path.join(dir, '3-corrupt-cache-fallback.png') })
  const s3 = await readState(page)
  r3.stop()

  console.log(`Corrupt-cache load -> firestore=${r3.counts.firestore} storage=${r3.counts.storage}`)
  console.log(`Corrupt-cache state -> name=${s3.name} shareEntries=${s3.shareCount} chunks=${s3.chunks} hasAudio=${s3.hasAudio}`)
  // Compared against the cache-hit load, not the cold first load: the browser keeps its
  // Firestore channel warm across a same-context reload, so absolute counts drift, but a
  // real re-fetch of all 22 chunks always costs noticeably more than a cache hit does.
  check('corrupt cache still boots to the same project', s3.name === s1.name, `${s1.name} vs ${s3.name}`)
  check('corrupt cache falls back to a full chunk fetch', r3.counts.firestore > r2.counts.firestore, `cache-hit=${r2.counts.firestore} vs corrupt=${r3.counts.firestore}`)
  check('corrupt entry got overwritten with a valid one', s3.hasAudio, `hasAudio=${s3.hasAudio}`)

  await context.close()
  const ok = report()
  if (!ok) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})

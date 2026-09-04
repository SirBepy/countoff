/* Footage is the only thing in this app that can cost money, and it only leaves the device
   for a SHARED project. This probe watches the negative case, since that is the one a
   refactor breaks silently: it fails if a single byte is ever addressed at Storage while
   the conditions to upload are not met. A real signed-in upload cannot run here - the
   emulators need Java 21 and this Mac has 17 - so the positive path is Joe's browser. */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '5173'
const URL = `http://localhost:${PORT}/`
const TAKE_ID = 'take-local'

function makeProject(id, name, shareToken) {
  return {
    id,
    name,
    audioName: 'probe.wav',
    duration: 30,
    segments: [
      {
        id: 's1',
        name: 'Bailando',
        start: 0,
        bpm: 120,
        anchor: 0,
        transitionIn: 0,
        countsPerRow: 8,
        lyrics: [],
        fit: { offset: 0, scale: 1 },
      },
    ],
    blocks: [{ id: 'b1', segmentId: 's1', moveId: 'mv', startBeat: 0, beats: 8 }],
    moves: [{ id: 'mv', name: 'Step touch', beats: 2, energy: 1 }],
    markers: [],
    people: [],
    movements: [],
    takes: [{ id: TAKE_ID, name: 'run-through.webm', duration: 4, bytes: 2048 }],
    clips: [{ id: 'c1', takeId: TAKE_ID, songStart: 0, srcIn: 0, srcOut: 4 }],
    floor: { cols: 6, rows: 4 },
    walkCounts: 8,
    pinned: [],
    focus: { kind: 'audience' },
    ...(shareToken ? { shareToken } : {}),
    updatedAt: Date.now(),
  }
}

function putTakeFile(page, takeId) {
  return page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const r = db
        .transaction('takes', 'readwrite')
        .objectStore('takes')
        .put(new Blob([new Uint8Array(2048)], { type: 'video/webm' }), id)
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error)
    })
  }, takeId)
}

const readProjectTakes = (page) =>
  page.evaluate(async () => {
    const id = localStorage.getItem('countoff.activeProjectId')
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const p = await new Promise((resolve, reject) => {
      const r = db.transaction('project', 'readonly').objectStore('project').get(id)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    return { shareToken: p && p.shareToken, takes: ((p && p.takes) || []).map((t) => ({ id: t.id, url: t.url || null })) }
  })

async function run(page, project) {
  const storageHits = []
  const onRequest = (r) => r.url().includes('firebasestorage.googleapis.com') && storageHits.push(r.url())
  page.on('request', onRequest)

  await seedProject(page, URL, { project, audioBytes: silentWav(30) })
  await putTakeFile(page, TAKE_ID)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.counts, .drop')

  // Past attachTakes and well past syncEngine's 8s push debounce, which is the other
  // place a backup is kicked from.
  await page.waitForTimeout(10000)

  page.off('request', onRequest)
  return { storageHits, ...(await readProjectTakes(page)) }
}

async function main() {
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))

    const unshared = await run(page, makeProject('bk1', 'Private medley', null))
    check('an unshared project reaches Storage not once', unshared.storageHits.length === 0, unshared.storageHits.join(', '))
    check(
      'its take stays local, with no remote url',
      unshared.takes.length === 1 && unshared.takes[0].url === null,
      JSON.stringify(unshared.takes),
    )

    // The positive control: the token IS on the document, so the only thing left holding
    // the upload back is being signed out. Without this the check above passes vacuously.
    const shared = await run(page, makeProject('bk2', 'Shared medley', 'brave-otter-nine'))
    check('the shared fixture really does carry a token', shared.shareToken === 'brave-otter-nine', String(shared.shareToken))
    check('signed out, a shared project still reaches Storage not once', shared.storageHits.length === 0, shared.storageHits.join(', '))
    check(
      'and its take is left for a signed-in session to back up',
      shared.takes.length === 1 && shared.takes[0].url === null,
      JSON.stringify(shared.takes),
    )

    await context.close()
  })

  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

/* Footage is fetched before the cut that needs it, and read off this device whenever the
   device has it. Two local takes and three clips, so there is always a next take to warm
   and a cut back to one already seen, plus a third take that only exists remotely, served
   here with real byte ranges and a slow answer, the way Storage looks over mobile data.
   The takes are recorded in-page off a canvas: there is no ffmpeg on the dev's machine,
   and a fixture would not decode any more honestly. */
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const TAKE_A = 'take-a'
const TAKE_B = 'take-b'
const TAKE_C = 'take-c'
/** A take whose upload exists but whose file is also on this device. Nothing must reach
 *  this host: if a probe ever hangs on it, the local copy is not being preferred. */
const UPLOADED = 'https://example.invalid/never-fetched.webm'
/** A take this device has never held, only reachable over the network. */
const REMOTE = 'https://footage.test/run-3.webm'
/** How long every byte-range answer takes. Long enough that a seek is still in flight
 *  when the next animation frame measures drift, which is the seek-storm condition. */
const REMOTE_DELAY = 400

const PROJECT = {
  id: 'preload1',
  name: 'Wedding medley 2026',
  audioName: 'probe.wav',
  duration: 60,
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
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 8 }],
  moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  people: [],
  movements: [],
  // Take A carries an uploaded url as well, which is the shape a shared project has.
  takes: [
    { id: TAKE_A, name: 'run 1.webm', duration: 4, bytes: 240000, url: UPLOADED },
    { id: TAKE_B, name: 'run 2.webm', duration: 4, bytes: 240000 },
    { id: TAKE_C, name: 'run 3.webm', duration: 6, bytes: 240000, url: REMOTE },
  ],
  clips: [
    { id: 'c1', takeId: TAKE_A, songStart: 10, srcIn: 0.5, srcOut: 3 },
    { id: 'c2', takeId: TAKE_B, songStart: 20, srcIn: 1, srcOut: 3.5 },
    { id: 'c3', takeId: TAKE_A, songStart: 30, srcIn: 1.5, srcOut: 3.5 },
    { id: 'c4', takeId: TAKE_C, songStart: 40, srcIn: 1, srcOut: 6 },
    // Two cuts into one take, far enough apart that one parked frame cannot serve both.
    { id: 'c5', takeId: TAKE_A, songStart: 50, srcIn: 2.5, srcOut: 3.5 },
    { id: 'c6', takeId: TAKE_A, songStart: 55, srcIn: 0.5, srcOut: 3 },
  ],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

/** Records a moving canvas, into the takes store when `store` is set, so the probe has
 *  real decodable footage rather than a fixture that only pretends to be a video. The
 *  bytes come back too, for a take the probe serves over the network instead. */
async function recordTake(page, takeId, seconds, { store = true, w = 320, h = 180 } = {}) {
  return page.evaluate(
    async ({ takeId, seconds, store, w, h }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const stream = canvas.captureStream(25)
      const chunks = []
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const done = new Promise((resolve) => (rec.onstop = resolve))
      rec.start()
      const started = performance.now()
      await new Promise((resolve) => {
        const draw = () => {
          const t = (performance.now() - started) / 1000
          ctx.fillStyle = '#1b1636'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#cfc7ff'
          ctx.fillRect(20 + ((t * 90) % Math.max(40, w - 80)), h / 2 - 45, 60, 90)
          if (t >= seconds) return resolve()
          requestAnimationFrame(draw)
        }
        draw()
      })
      rec.stop()
      await done
      const blob = new Blob(chunks, { type: 'video/webm' })
      if (store) {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('countoff')
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        await new Promise((resolve, reject) => {
          const r = db.transaction('takes', 'readwrite').objectStore('takes').put(blob, takeId)
          r.onsuccess = () => resolve()
          r.onerror = () => reject(r.error)
        })
      }
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(blob)
      })
      return { size: blob.size, base64 }
    },
    { takeId, seconds, store, w, h },
  )
}

/** Answers a media element the way a bucket does: 206 with a Content-Range for a Range
 *  request, the whole file otherwise, and never before REMOTE_DELAY has passed. */
function serveWithRanges(bytes, onRequest) {
  return async (route) => {
    onRequest(route.request())
    await new Promise((resolve) => setTimeout(resolve, REMOTE_DELAY))
    const range = route.request().headers()['range']
    const m = range && /bytes=(\d+)-(\d*)/.exec(range)
    const base = { 'content-type': 'video/webm', 'accept-ranges': 'bytes' }
    if (!m) return route.fulfill({ status: 200, body: bytes, headers: { ...base, 'content-length': String(bytes.length) } })
    const start = Number(m[1])
    const end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1
    return route.fulfill({
      status: 206,
      body: bytes.subarray(start, end + 1),
      headers: { ...base, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(end - start + 1) },
    })
  }
}

async function main() {
  const { check, report } = createChecklist()
  const dir = screenshotDir('preload')

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))

    // Nothing may leave for the uploaded host. A request to it is the failure this
    // whole change is about, so fail loudly rather than waiting out a timeout.
    let reachedStorage = 0
    await page.route('https://example.invalid/**', (route) => {
      reachedStorage += 1
      return route.abort()
    })

    const park = async (t) => {
      await page.evaluate((at) => {
        const el = document.querySelector('audio')
        if (el) el.currentTime = at
      }, t)
      await page.waitForTimeout(500)
    }

    const stage = () =>
      page.evaluate(() => {
        const main = document.querySelector('.vstage :not(.vstage-warm) > .vstage-el')
        const warm = [...document.querySelectorAll('.vstage .vstage-warm > .vstage-el')]
        const desc = (v) => ({
          src: v.getAttribute('src'),
          ready: v.readyState,
          at: Number(v.currentTime.toFixed(2)),
          preload: v.getAttribute('preload'),
          // A mark left on the element itself, so a cut can be told from a reload.
          tag: v.__probe || null,
        })
        return { src: main ? main.getAttribute('src') : null, ready: main ? main.readyState : -1, tag: main ? main.__probe || null : null, warm: warm.map(desc) }
      })
    // Marks the element currently waiting, so the cut can prove it is the same node.
    const tagWarm = (tag) =>
      page.evaluate((tag) => {
        const v = document.querySelector('.vstage .vstage-warm > .vstage-el')
        if (v) v.__probe = tag
        return !!v
      }, tag)

    try {
      await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })
      const a = await recordTake(page, TAKE_A, 4)
      const b = await recordTake(page, TAKE_B, 4)
      const c = await recordTake(page, TAKE_C, 6, { store: false })
      check('all three takes are recorded', a.size > 1000 && b.size > 1000 && c.size > 1000, `${a.size}, ${b.size} and ${c.size} bytes`)

      // Take C lives only behind this route, answered slowly and by byte range.
      const remoteRequests = []
      await page.route('https://footage.test/**', serveWithRanges(Buffer.from(c.base64, 'base64'), (r) => remoteRequests.push(r.headers()['range'] || '-')))

      // Reload so attachTakes resolves the stored blobs the way a real boot does.
      await page.goto(URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      await page.keyboard.press('r')
      await page.waitForSelector('.rehearse', { timeout: 5000 })
      await page.waitForTimeout(600)

      // Song at zero, first cut ten seconds out: warming has to have started already.
      await park(0)
      const cold = await stage()
      check(
        'the take ahead is already buffering before the first cut arrives',
        cold.warm.length >= 1 && cold.warm.every((w) => w.ready >= 1),
        JSON.stringify(cold.warm),
      )
      check(
        'a warm take is parked on the frame its cut opens with, not on its own first frame',
        cold.warm.some((w) => w.at > 0),
        cold.warm.map((w) => `at ${w.at}`).join(', ') || 'nothing warm',
      )
      check(
        'only the next cut warms, not every take in the medley',
        cold.warm.length === 1 && /^blob:/.test(cold.warm[0].src),
        `${cold.warm.length} warm, first is ${cold.warm[0]?.src}`,
      )

      await park(12)
      const first = await stage()
      check('the first cut plays off this device, not out of Storage', /^blob:/.test(first.src || ''), first.src)
      check(
        'a take that is on screen is not also mounted a second time to warm it',
        !first.warm.some((w) => w.src === first.src),
        `${first.warm.length} warm, main ${first.src}`,
      )
      check(
        'the take the next cut needs is warm while the current one plays',
        first.warm.length >= 1 && first.warm.every((w) => w.ready >= 2),
        JSON.stringify(first.warm.map((w) => w.ready)),
      )
      await page.screenshot({ path: path.join(dir, 'rehearse-first-cut.png') })
      await tagWarm('parked-for-c2')

      // The cut itself: the element that takes over must already have its frames, and it
      // must BE the element that was parked, not a fresh load of the same file.
      await park(21)
      const second = await stage()
      check(
        'the cut lands on footage that is ready, not on an element still loading',
        second.ready >= 2 && second.src !== first.src,
        `readyState ${second.ready}`,
      )
      check(
        'the cut shows the very element that was parked, not a reload of its file',
        second.tag === 'parked-for-c2',
        `main tag ${second.tag}`,
      )
      await page.screenshot({ path: path.join(dir, 'rehearse-second-cut.png') })

      const mounted = await page.locator('.vstage video').count()
      check('the pool is the clip on screen and one more, never a phone full of decoders', mounted <= 2, `${mounted} elements`)

      // Take A is back on screen and the remote take is next: warmed over the network,
      // asking for metadata rather than the whole file, and still parked on its cut.
      await park(31)
      await page.waitForTimeout(REMOTE_DELAY * 4)
      const remote = await stage()
      const warmC = remote.warm.find((w) => w.src === REMOTE)
      check(
        'a take only reachable over the network warms with metadata only, parked on its cut',
        !!warmC && warmC.preload === 'metadata' && warmC.ready >= 2 && Math.abs(warmC.at - 1) < 0.1,
        warmC ? `preload=${warmC.preload} readyState ${warmC.ready} at ${warmC.at}` : `warm: ${JSON.stringify(remote.warm)}`,
      )
      const warmedWith = remoteRequests.length

      // The cut onto the remote take, played rather than parked, over a link that answers
      // every range slowly. The footage has to land, and it has to land in a bounded number
      // of requests: a correction that re-seeks every frame aborts each fetch before it
      // returns, and that is a clip that never shows a frame while the song runs on.
      await park(39.5)
      await page.click('.rehearse button.primary')
      await page.waitForTimeout(4000)
      const played = await stage()
      await page.evaluate(() => document.querySelector('audio')?.pause())
      const duringCut = remoteRequests.length - warmedWith
      check(
        'a cut onto slow footage shows a frame while the song plays on',
        played.src === REMOTE && played.ready >= 2,
        `main ${played.src} readyState ${played.ready}`,
      )
      check(
        'a slow link does not turn the drift correction into a seek storm',
        duringCut <= 6,
        `${duringCut} range requests during the cut (${remoteRequests.slice(warmedWith).join(', ')})`,
      )
      await page.screenshot({ path: path.join(dir, 'rehearse-remote-cut.png') })

      // Two cuts into one take: the second gets its own element parked on its own frame,
      // rather than the one on screen seeking across the file at the cut.
      await park(50.5)
      const sameTake = await stage()
      const parkedNext = sameTake.warm[0]
      check(
        'a second cut into the take on screen gets its own element, parked on its own frame',
        !!parkedNext && parkedNext.src === sameTake.src && Math.abs(parkedNext.at - 0.5) < 0.1 && parkedNext.ready >= 2,
        parkedNext ? `warm at ${parkedNext.at} readyState ${parkedNext.ready}, same file ${parkedNext.src === sameTake.src}` : 'nothing warm',
      )
      await tagWarm('parked-for-c6')
      await park(55.5)
      const sameTakeCut = await stage()
      check(
        'a cut inside one take lands on the parked element with its frame ready',
        sameTakeCut.tag === 'parked-for-c6' && sameTakeCut.ready >= 2,
        `main tag ${sameTakeCut.tag} readyState ${sameTakeCut.ready}`,
      )

      check(
        'nothing was fetched from the uploaded url while the file was on this device',
        reachedStorage === 0,
        `${reachedStorage} requests to ${UPLOADED}`,
      )
    } catch (e) {
      // Report whatever already ran: a mid-probe throw is a failure worth seeing in
      // context, not a stack trace that hides the checks before it.
      check('probe ran to the end', false, String(e).split('\n')[0])
    }

    await context.close()
  })

  console.log(`\nscreenshots -> ${dir}`)
  report()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

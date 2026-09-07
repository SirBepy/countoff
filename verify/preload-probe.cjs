/* Footage is fetched before the cut that needs it, and read off this device whenever the
   device has it. Two takes and three clips, so there is always a next take to warm and a
   cut back to one already seen. The takes are recorded in-page off a canvas: there is no
   ffmpeg on the dev's machine, and a fixture would not decode any more honestly. */
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')

const PORT = process.argv[2] || '42216'
const URL = `http://localhost:${PORT}/`
const TAKE_A = 'take-a'
const TAKE_B = 'take-b'
/** A take whose upload exists but whose file is also on this device. Nothing must reach
 *  this host: if a probe ever hangs on it, the local copy is not being preferred. */
const UPLOADED = 'https://example.invalid/never-fetched.webm'

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
  ],
  clips: [
    { id: 'c1', takeId: TAKE_A, songStart: 10, srcIn: 0, srcOut: 3 },
    { id: 'c2', takeId: TAKE_B, songStart: 20, srcIn: 1, srcOut: 3.5 },
    { id: 'c3', takeId: TAKE_A, songStart: 30, srcIn: 1.5, srcOut: 3.5 },
  ],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

/** Records a moving canvas straight into the takes store, so the probe has real
 *  decodable footage rather than a fixture that only pretends to be a video. */
async function recordTake(page, takeId, seconds, w = 320, h = 180) {
  return page.evaluate(
    async ({ takeId, seconds, w, h }) => {
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
      return blob.size
    },
    { takeId, seconds, w, h },
  )
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
        const main = document.querySelector('.vstage .vstage-el')
        const warm = [...document.querySelectorAll('.vstage .vstage-warm')]
        return {
          src: main ? main.getAttribute('src') : null,
          ready: main ? main.readyState : -1,
          warm: warm.map((v) => ({ src: v.getAttribute('src'), ready: v.readyState, at: Number(v.currentTime.toFixed(2)) })),
        }
      })

    try {
      await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })
      const a = await recordTake(page, TAKE_A, 4)
      const b = await recordTake(page, TAKE_B, 4)
      check('both takes are recorded into the takes store', a > 1000 && b > 1000, `${a} and ${b} bytes`)

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
        'the takes ahead are already buffering before the first cut arrives',
        cold.warm.length >= 1 && cold.warm.every((w) => w.ready >= 1),
        JSON.stringify(cold.warm),
      )
      check(
        'a warm take is parked on the frame its cut opens with, not on its own first frame',
        cold.warm.some((w) => w.at > 0),
        cold.warm.map((w) => `at ${w.at}`).join(', ') || 'nothing warm',
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

      // The cut itself: the element that takes over must already have its frames.
      await park(21)
      const second = await stage()
      check(
        'the cut lands on footage that is ready, not on an element still loading',
        second.ready >= 2 && second.src !== first.src,
        `readyState ${second.ready}`,
      )
      await page.screenshot({ path: path.join(dir, 'rehearse-second-cut.png') })

      const mounted = await page.locator('.vstage video').count()
      check('the pool stays small rather than mounting the whole medley', mounted <= 3, `${mounted} elements`)

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

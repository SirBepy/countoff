/* Verifies the take-level crop on BOTH render paths, with pixel proof rather than a
   layout-branch check: the editor's own monitor, and rehearse where .vstage is held to
   a fixed 9/16 box regardless of the crop's own shape (src/styles/rehearse.css). The
   take is four solid-colour quadrants recorded off a canvas, so sampling a few points
   inside the on-screen video box tells you exactly what survived the crop. */
const fs = require('fs')
const path = require('path')
const { withBrowser, desktopContext, seedProject, readProject, silentWav, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '5173'
const URL = `http://localhost:${PORT}/`
const TAKE_ID = 'crop-take-a'

const COLORS = {
  red: [209, 49, 90],
  green: [55, 178, 77],
  blue: [28, 126, 214],
  yellow: [242, 199, 68],
}

const PROJECT = {
  id: 'crop1',
  name: 'Crop probe',
  audioName: 'probe.wav',
  duration: 30,
  segments: [
    { id: 's1', name: 'Song', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'mv1', startBeat: 0, beats: 8 }],
  moves: [{ id: 'mv1', name: 'Step touch', beats: 8, energy: 1 }],
  markers: [],
  people: [],
  movements: [],
  takes: [{ id: TAKE_ID, name: 'quadrants.webm', duration: 2, bytes: 100000 }],
  clips: [],
  floor: { cols: 6, rows: 4 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

/** Four solid quadrants: TL red, TR green, BL blue, BR yellow. */
async function recordQuadrants(page, seconds, w, h) {
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
          ctx.fillStyle = '#d1315a'
          ctx.fillRect(0, 0, w / 2, h / 2)
          ctx.fillStyle = '#37b24d'
          ctx.fillRect(w / 2, 0, w / 2, h / 2)
          ctx.fillStyle = '#1c7ed6'
          ctx.fillRect(0, h / 2, w / 2, h / 2)
          ctx.fillStyle = '#f2c744'
          ctx.fillRect(w / 2, h / 2, w / 2, h / 2)
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
    { takeId: TAKE_ID, seconds, w, h },
  )
}

/** Samples a grid of points strictly inside the on-screen video box, clipped against
 *  its wrapper's own rect (overflow: hidden), so this reads exactly what the CSS
 *  actually painted rather than re-deriving the answer from the stored crop rect. */
async function sampleVideo(page, sel, cols = 5, rows = 5) {
  return page.evaluate(
    ({ sel, cols, rows }) => {
      const video = document.querySelector(sel)
      if (!video) return null
      const wrapper = video.parentElement
      const v = video.getBoundingClientRect()
      const w = wrapper.getBoundingClientRect()
      const clip = {
        left: Math.max(v.left, w.left),
        top: Math.max(v.top, w.top),
        right: Math.min(v.right, w.right),
        bottom: Math.min(v.bottom, w.bottom),
      }
      const fx0 = (clip.left - v.left) / v.width
      const fy0 = (clip.top - v.top) / v.height
      const fx1 = (clip.right - v.left) / v.width
      const fy1 = (clip.bottom - v.top) / v.height
      const sx = fx0 * video.videoWidth
      const sy = fy0 * video.videoHeight
      const sw = (fx1 - fx0) * video.videoWidth
      const sh = (fy1 - fy0) * video.videoHeight
      const canvas = document.createElement('canvas')
      canvas.width = 50
      canvas.height = 50
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 50, 50)
      const points = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const gx = (c + 0.5) / cols
          const gy = (r + 0.5) / rows
          const d = ctx.getImageData(Math.floor(gx * 50), Math.floor(gy * 50), 1, 1).data
          points.push({ gx, gy, rgb: [d[0], d[1], d[2]] })
        }
      }
      return { points, box: { w: Math.round(w.width), h: Math.round(w.height) } }
    },
    { sel, cols, rows },
  )
}

const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0))
const classify = (rgb) => {
  let best = 'other'
  let bestDist = 60
  for (const [name, colour] of Object.entries(COLORS)) {
    const d = dist(rgb, colour)
    if (d < bestDist) {
      bestDist = d
      best = name
    }
  }
  return best
}

async function main() {
  const { check, report } = createChecklist()
  const dir = path.join(__dirname, '..', '.for_bepy', 'screenshots', process.env.CLAUDE_CODE_SESSION_ID || 'crop-probe')
  fs.mkdirSync(dir, { recursive: true })

  await withBrowser(async (browser) => {
    try {
      const context = await browser.newContext(desktopContext())
      const page = await context.newPage()
      page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))

      await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(30) })
      const bytes = await recordQuadrants(page, 2, 480, 270)
      check('recorded a real quadrant take into the takes store', bytes > 1000, `${bytes} bytes`)

      await page.goto(URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-film-strip'))
        btn?.click()
      })
      await page.waitForSelector('.video-view', { timeout: 5000 })
      await page.locator('.vs-take button[title="Lay this take at the playhead"]').click()
      await page.waitForTimeout(400)

      // Case A: a small square well inside the red quadrant, near-square aspect.
      await page.locator('.vs-take button[title="Crop this take\'s footage"]').click()
      await page.waitForSelector('.vs-cropmodal', { timeout: 5000 })
      await page.waitForTimeout(700)
      let box = await page.locator('.vs-crop').boundingBox()
      await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(200)
      await page.locator('.vs-croptools button.primary').click()
      await page.waitForTimeout(400)

      const afterA = await readProject(page)
      const cropA = afterA?.takes?.[0]?.crop
      check(
        'case A: near-square crop persisted, roughly the top-left quadrant',
        !!cropA && cropA.x < 0.15 && cropA.y < 0.15 && cropA.w > 0.25 && cropA.w < 0.55 && cropA.h > 0.25 && cropA.h < 0.55,
        cropA && JSON.stringify(cropA),
      )

      await page.evaluate(() => {
        const v = document.querySelector('.vstage-el')
        if (v) v.currentTime = 0.5
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'a-editor-cropped.png') })

      const editorA = await sampleVideo(page, '.vs-monitor .vstage-el')
      const editorAOk = editorA && editorA.points.every((p) => classify(p.rgb) === 'red')
      check(
        'case A editor: every sampled point inside the box is solid red, no other colour bleeding in',
        editorAOk,
        editorA && editorA.points.map((p) => classify(p.rgb)).join(''),
      )

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-caret-left'))
        btn?.click()
      })
      await page.waitForTimeout(300)
      await page.keyboard.press('r')
      await page.waitForSelector('.rehearse.has-video', { timeout: 5000 })
      await page.waitForTimeout(600)
      await page.evaluate(() => {
        const v = document.querySelector('.rehearse .vstage-el')
        if (v) v.currentTime = 0.5
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'a-rehearse-cropped.png') })

      const rehearseA = await sampleVideo(page, '.rehearse .vstage-el')
      const rehearseAOk = rehearseA && rehearseA.points.every((p) => classify(p.rgb) === 'red')
      check(
        'case A rehearse: solid red across the whole fixed-ratio box, no black band, no letterbox',
        rehearseAOk,
        rehearseA && `box ${rehearseA.box.w}x${rehearseA.box.h} :: ${rehearseA.points.map((p) => classify(p.rgb)).join('')}`,
      )

      // Case B: a wide, short band spanning red and green, the shape furthest from 9/16.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.rehearse-top button')].find((b) => b.querySelector('.ph-x'))
        btn?.click()
      })
      await page.waitForTimeout(300)
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-film-strip'))
        btn?.click()
      })
      await page.waitForSelector('.video-view', { timeout: 5000 })

      await page.locator('.vs-take button[title="Crop this take\'s footage"]').click()
      await page.waitForSelector('.vs-cropmodal', { timeout: 5000 })
      await page.waitForTimeout(500)
      await page.locator('.vs-croptools button.ghost', { hasText: 'Clear crop' }).click()
      await page.waitForTimeout(300)

      await page.locator('.vs-take button[title="Crop this take\'s footage"]').click()
      await page.waitForSelector('.vs-cropmodal', { timeout: 5000 })
      await page.waitForTimeout(500)
      box = await page.locator('.vs-crop').boundingBox()
      await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.05)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.4, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(200)
      const rectCount = await page.locator('.vs-croprect').count()
      check('case B: a fresh rect can be drawn after clearing the old one', rectCount === 1, `${rectCount} rects`)
      await page.locator('.vs-croptools button.primary').click()
      await page.waitForTimeout(400)

      const afterB = await readProject(page)
      const cropB = afterB?.takes?.[0]?.crop
      check(
        'case B: a wide, short crop (far from 9/16) is persisted',
        !!cropB && cropB.w > 0.8 && cropB.h < 0.5,
        cropB && JSON.stringify(cropB),
      )

      await page.evaluate(() => {
        const v = document.querySelector('.vstage-el')
        if (v) v.currentTime = 0.5
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'b-editor-cropped.png') })

      const editorB = await sampleVideo(page, '.vs-monitor .vstage-el')
      const leftHalfB = editorB ? editorB.points.filter((p) => p.gx < 0.5) : []
      const rightHalfB = editorB ? editorB.points.filter((p) => p.gx > 0.5) : []
      const editorBOk =
        !!editorB && leftHalfB.every((p) => classify(p.rgb) === 'red') && rightHalfB.every((p) => classify(p.rgb) === 'green')
      check(
        'case B editor: left half solid red, right half solid green, correctly shaped not squished',
        editorBOk,
        editorB && editorB.points.map((p) => classify(p.rgb)).join(''),
      )

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-caret-left'))
        btn?.click()
      })
      await page.waitForTimeout(300)
      await page.keyboard.press('r')
      await page.waitForSelector('.rehearse.has-video', { timeout: 5000 })
      await page.waitForTimeout(600)
      await page.evaluate(() => {
        const v = document.querySelector('.rehearse .vstage-el')
        if (v) v.currentTime = 0.5
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(dir, 'b-rehearse-cropped.png') })

      const rehearseB = await sampleVideo(page, '.rehearse .vstage-el')
      const leftHalfRB = rehearseB ? rehearseB.points.filter((p) => p.gx < 0.5) : []
      const rightHalfRB = rehearseB ? rehearseB.points.filter((p) => p.gx > 0.5) : []
      const rehearseBOk =
        !!rehearseB && leftHalfRB.every((p) => classify(p.rgb) === 'red') && rightHalfRB.every((p) => classify(p.rgb) === 'green')
      check(
        'case B rehearse: left half red, right half green in the fixed 9/16 box, no black band, no squish',
        rehearseBOk,
        rehearseB && `box ${rehearseB.box.w}x${rehearseB.box.h} :: ${rehearseB.points.map((p) => classify(p.rgb)).join('')}`,
      )

      await context.close()
    } catch (e) {
      check('probe ran to the end', false, String(e).split('\n')[0])
    }
  })

  console.log(`\nscreenshots -> ${dir}`)
  report()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

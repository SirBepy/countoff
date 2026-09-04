/* Lays footage over the song and checks both screens that show it: the video editor's
   clip track, and rehearse's video layout. There is no ffmpeg on the dev's machine, so
   the take is recorded in-page off a canvas rather than shipped as a fixture. */
const path = require('path')
const { withBrowser, desktopContext, phoneContext, seedProject, readProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')

const PORT = process.argv[2] || '5173'
const URL = `http://localhost:${PORT}/`
const TAKE_ID = 'take-a'

const PROJECT = {
  id: 'vid1',
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
      lyrics: [{ id: 'l1', time: 2, text: 'Yo te miro' }],
      fit: { offset: 0, scale: 1 },
    },
  ],
  blocks: [
    { id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 8 },
    { id: 'b2', segmentId: 's1', moveId: 'grapevine', startBeat: 8, beats: 8, note: 'turn on 7' },
    { id: 'b3', segmentId: 's1', moveId: 'body-roll', startBeat: 16, beats: 8 },
  ],
  moves: [
    { id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 },
    { id: 'grapevine', name: 'Grapevine right', beats: 4, energy: 2 },
    { id: 'body-roll', name: 'Hip bump', beats: 4, energy: 3 },
  ],
  markers: [],
  people: [
    { id: 'p1', name: 'Ana', initials: 'AN', colour: '#7c5cff' },
    { id: 'p2', name: 'Marko', initials: 'MA', colour: '#3fb8b0' },
  ],
  movements: [
    { id: 'm1', personId: 'p1', segmentId: 's1', beat: 0, travel: 0, to: { col: 2, row: 1 } },
    { id: 'm2', personId: 'p2', segmentId: 's1', beat: 0, travel: 0, to: { col: 4, row: 1 } },
  ],
  takes: [{ id: TAKE_ID, name: 'full-run take 2.webm', duration: 4, bytes: 240000 }],
  clips: [],
  floor: { cols: 6, rows: 4 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

/** Records a moving canvas into the takes store, so the probe has real decodable footage. */
async function recordTake(page, seconds) {
  return page.evaluate(
    async ({ takeId, seconds }) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
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
          ctx.fillRect(0, 0, 320, 180)
          ctx.fillStyle = '#cfc7ff'
          ctx.fillRect(20 + ((t * 90) % 240), 60, 60, 90)
          ctx.font = 'bold 22px sans-serif'
          ctx.fillText(t.toFixed(1) + 's', 12, 30)
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
    { takeId: TAKE_ID, seconds },
  )
}

async function main() {
  const { check, report } = createChecklist()
  const dir = screenshotDir('video')

  await withBrowser(async (browser) => {
   try {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })

    const bytes = await recordTake(page, 4)
    check('recorded a real take into the takes store', bytes > 1000, `${bytes} bytes`)

    // Reload so attachTakes() resolves the stored blob into an object URL the way a
    // real boot does, rather than testing a path only the probe ever walks.
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.appbar button')].find((b) =>
        b.querySelector('.ph-film-strip'),
      )
      btn?.click()
    })
    await page.waitForSelector('.video-view', { timeout: 5000 })
    check('the film-strip button opens the video screen', true)

    const takeRow = await page.locator('.vs-take').count()
    check('the seeded take is listed in the bin', takeRow === 1, `${takeRow} rows`)

    // Lay it down at the playhead, which is the "send to track" affordance.
    await page.locator('.vs-take button[title="Lay this take at the playhead"]').click()
    await page.waitForTimeout(400)
    const clipCount = await page.locator('.vt-clip').count()
    check('sending a take to the playhead lays a clip', clipCount === 1, `${clipCount} clips`)

    const before = await readProject(page)
    const laid = before?.clips?.[0]
    check(
      'the clip is anchored in seconds, trimmed to the take',
      !!laid && typeof laid.songStart === 'number' && laid.srcIn === 0 && laid.srcOut > 1,
      laid && `songStart ${laid.songStart.toFixed(2)}s, src ${laid.srcIn}-${laid.srcOut.toFixed(2)}`,
    )

    // Drag the out handle left, which is "when it cuts out".
    const handle = page.locator('.vt-clip .h.r')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await readProject(page)
    const trimmed = after?.clips?.[0]
    check(
      'dragging the out handle trims when the clip cuts out',
      !!trimmed && trimmed.srcOut < laid.srcOut && trimmed.songStart === laid.songStart,
      trimmed && `srcOut ${laid.srcOut.toFixed(2)} -> ${trimmed.srcOut.toFixed(2)}`,
    )

    await page.screenshot({ path: path.join(dir, 'desktop-video-screen.png') })

    // The monitor has to be showing the footage, not the no-clip plate.
    await page.evaluate(() => {
      const v = document.querySelector('.vstage-el')
      if (v) v.currentTime = 0.5
    })
    await page.waitForTimeout(500)
    const playing = await page.evaluate(() => {
      const v = document.querySelector('.vstage-el')
      return v ? { ready: v.readyState, w: v.videoWidth, muted: v.muted } : null
    })
    check('the monitor decodes the take', !!playing && playing.ready >= 2 && playing.w > 0, JSON.stringify(playing))
    check('the footage is muted, the song is the only audio', !!playing && playing.muted === true)

    // Rehearse: the video layout, with the move name promoted to the band.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-caret-left'))
      btn?.click()
    })
    await page.waitForTimeout(300)
    await page.keyboard.press('r')
    await page.waitForSelector('.rehearse', { timeout: 5000 })
    await page.waitForTimeout(500)

    const hasVideo = await page.locator('.rehearse.has-video').count()
    check('rehearse switches to the video layout once clips exist', hasVideo === 1)
    const bandName = (await page.locator('.rehearse-band .nm').textContent().catch(() => '')) || ''
    check('the move name sits in the top band', bandName.trim().length > 0, bandName.trim())
    const stageBeside = await page.evaluate(() => {
      const stage = document.querySelector('.rehearse .stage')
      const video = document.querySelector('.rehearse .vstage')
      if (!stage || !video) return null
      const a = stage.getBoundingClientRect()
      const b = video.getBoundingClientRect()
      return { floorRight: Math.round(a.right), videoLeft: Math.round(b.left) }
    })
    check(
      'the floor sits to the side of the footage, not under it',
      !!stageBeside && stageBeside.floorRight <= stageBeside.videoLeft + 2,
      JSON.stringify(stageBeside),
    )
    await page.screenshot({ path: path.join(dir, 'desktop-rehearse-video.png') })

    // The fallback: no clips means the screen it has always been. Re-seeded rather than
    // edited in place, because the live app flushes its own project over any raw write.
    await seedProject(page, URL, { project: { ...PROJECT, clips: [] }, audioBytes: silentWav(60) })
    await page.keyboard.press('r')
    await page.waitForSelector('.rehearse', { timeout: 5000 })
    await page.waitForTimeout(400)
    const fellBack = await page.locator('.rehearse .rehearse-move').count()
    const stillVideo = await page.locator('.rehearse.has-video').count()
    check('with no clips it falls back to the big move name', fellBack === 1 && stillVideo === 0)
    await page.screenshot({ path: path.join(dir, 'desktop-rehearse-fallback.png') })

    await context.close()

    // Phone: footage over the floor, both on screen at once.
    const phone = await browser.newContext(phoneContext())
    const small = await phone.newPage()
    // Clips seeded up front and the take recorded after: the reload below is what
    // attaches the footage, so nothing has to be written under a live app.
    await seedProject(small, URL, {
      project: { ...PROJECT, clips: [{ id: 'c1', takeId: TAKE_ID, songStart: 0, srcIn: 0, srcOut: 2.5 }] },
      audioBytes: silentWav(60),
    })
    await recordTake(small, 3)
    await small.goto(URL, { waitUntil: 'networkidle' })
    await small.waitForTimeout(800)
    await small.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    })
    await small.waitForTimeout(700)
    const phoneStacked = await small.evaluate(() => {
      const stage = document.querySelector('.rehearse .stage')
      const video = document.querySelector('.rehearse .vstage')
      if (!stage || !video) return null
      return { floorTop: Math.round(stage.getBoundingClientRect().top), videoTop: Math.round(video.getBoundingClientRect().top) }
    })
    check(
      'on a phone the footage sits above the floor',
      !!phoneStacked && phoneStacked.videoTop < phoneStacked.floorTop,
      JSON.stringify(phoneStacked),
    )
    await small.screenshot({ path: path.join(dir, 'phone-rehearse-video.png') })
    await phone.close()
   } catch (e) {
     // Report whatever already ran: a mid-probe throw is a failure worth seeing in
     // context, not a stack trace that hides the eight checks before it.
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

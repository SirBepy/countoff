/* Rehearse runway: two songs at different tempos, and whether the next song's moves,
   lyrics and counts already show up ahead of NOW before the cut arrives. */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')
const path = require('path')
const fs = require('fs')

const PORT = process.argv[2] || '42211'
const URL = `http://localhost:${PORT}/`
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', 'fbee9649-4c93-4ea9-b002-e68e81d24bd8')

/* Song One at 120 BPM (0.5s/count) runs 0-20s. Song Two at 150 BPM (0.4s/count) starts
   right at the cut, its own downbeat, with a slower countsPerRow so its ruler reads
   differently from Song One's on sight. */
const PROJECT = {
  id: 'runway1',
  name: 'Two-song medley',
  audioName: 'probe.wav',
  duration: 45,
  segments: [
    { id: 's1', name: 'Song One', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
    {
      id: 's2',
      name: 'Song Two',
      start: 20,
      bpm: 150,
      anchor: 20,
      transitionIn: 0,
      countsPerRow: 6,
      lyrics: [{ id: 'lyr1', time: 20.4, text: 'Next song lyric' }],
      fit: { offset: 0, scale: 1 },
    },
  ],
  blocks: [
    { id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 4 },
    { id: 'b2', segmentId: 's2', moveId: 'grapevine', startBeat: 0, beats: 4 },
  ],
  moves: [
    { id: 'step-touch', name: 'Step touch', beats: 4, energy: 1 },
    { id: 'grapevine', name: 'Grapevine', beats: 4, energy: 2 },
  ],
  markers: [],
  people: [],
  formations: [],
  updatedAt: Date.now(),
}

const seek = (page, to) => page.evaluate((t) => (document.querySelector('audio').currentTime = t), to)

/* Own beats: (20 - 0) / 0.5 = 40. Grapevine's absolute time is Song Two's own anchor
   (20s), which lands at that same beat 40 in Song One's runway space. */
const CUT_BEAT = 40

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(45) })

    await page.keyboard.press('r')
    await page.waitForSelector('.runway', { timeout: 5000 })

    // 2s (4 counts) before the cut, well inside the lookahead horizon.
    await seek(page, 18)
    await page.waitForTimeout(250)

    const bars = page.locator('.rw-bar')
    const grapevine = bars.filter({ hasText: 'Grapevine' })
    check('the next song\'s move renders on the runway before the cut arrives', (await grapevine.count()) === 1)

    const head = await page.locator('.rw-head').boundingBox()
    const bar = await grapevine.boundingBox()
    const aheadPx = bar ? bar.x - head.x : NaN
    // 4 beats at the desktop --ppb of 42px/beat, converted through absolute time.
    check(
      'the lookahead bar sits at the correct physical distance ahead of NOW',
      bar && aheadPx > 140 && aheadPx < 195,
      `aheadPx=${aheadPx}`,
    )
    check(
      "the lookahead bar's width reflects Song Two's tempo, not its raw beat count",
      // Time-converted width is ~130px; the raw (wrong) 4-beat width would be ~164px.
      bar && bar.width > 100 && bar.width < 150,
      `width=${bar?.width}`,
    )

    const lyric = page.locator('.rw-lyric', { hasText: 'Next song lyric' })
    check('the next song\'s lyric line renders ahead of NOW too', (await lyric.count()) === 1)

    const tickCount = await page.locator('.rw-num').count()
    check(
      'the ruler extends counts past Song One\'s own length',
      tickCount > CUT_BEAT,
      `tickCount=${tickCount} ownLength=${CUT_BEAT}`,
    )

    await page.screenshot({ path: path.join(SHOTS, 'runway-1-before-cut.png') })

    // Past the cut: the same move keeps rendering, nothing pops in or disappears.
    await seek(page, 21)
    await page.waitForTimeout(250)
    check('the same move keeps rendering once the cut is crossed, with no pop-in', (await bars.filter({ hasText: 'Grapevine' }).count()) === 1)
    check(
      'the rehearse header shows the crossed-into move as current',
      (await page.locator('.rehearse-move').textContent()) === 'Grapevine',
    )

    await page.screenshot({ path: path.join(SHOTS, 'runway-2-after-cut.png') })

    check('no console or page errors', errors.length === 0, errors.join(' | '))

    await context.close()
  })

  const ok = report()
  console.log(`\nscreenshots: ${SHOTS}`)
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

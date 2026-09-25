/* Both timelines zoom the same way: a visible slider rather than only a trackpad pinch,
   and every zoom change re-centres on the playhead instead of leaving scrollLeft pointing
   at whatever moment used to be there. Drives the video editor's clip track and the floor
   screen's walk track, since the two share one control and one pair of hooks. */
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const TAKE_ID = 'take-a'
/** Parked off-centre on purpose: at 1x it sits three quarters along, so a zoom that does
 *  not re-anchor leaves it far off the right edge rather than accidentally near the middle. */
const PARKED = 45

const PROJECT = {
  id: 'zoom1',
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
  people: [{ id: 'p1', name: 'Ana', initials: 'AN', colour: '#7c5cff' }],
  movements: [{ id: 'm1', personId: 'p1', segmentId: 's1', beat: 0, travel: 0, to: { col: 2, row: 1 } }],
  takes: [{ id: TAKE_ID, name: 'full-run take 2.webm', duration: 12, bytes: 240000 }],
  clips: [{ id: 'c1', takeId: TAKE_ID, songStart: 40, srcIn: 0, srcOut: 8 }],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

async function main() {
  const { check, report } = createChecklist()
  const dir = screenshotDir('timeline-zoom')

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      errors.push(m.text())
      console.log('  console.error ::', m.text())
    })

    /** How far the playhead sits from the middle of its scroller, in pixels. */
    const offCentre = (scroller, playhead) =>
      page.evaluate(
        ({ scroller, playhead }) => {
          const box = document.querySelector(scroller)
          const head = document.querySelector(playhead)
          if (!box || !head) return null
          const b = box.getBoundingClientRect()
          const h = head.getBoundingClientRect()
          return Math.round(h.left + h.width / 2 - (b.left + b.width / 2))
        },
        { scroller, playhead },
      )

    const park = async (t) => {
      await page.evaluate((at) => {
        const el = document.querySelector('audio')
        if (el) el.currentTime = at
      }, t)
      await page.waitForTimeout(350)
    }

    try {
      await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-film-strip'))
        btn?.click()
      })
      await page.waitForSelector('.video-view', { timeout: 5000 })

      const sliders = await page.locator('.vs-trans .zoomer input[type="range"]').count()
      const carets = await page.locator('.vs-trans .zoomer button').count()
      check(
        'the video transport carries a zoom slider with its own in and out buttons',
        sliders === 1 && carets === 2,
        `${sliders} sliders, ${carets} buttons`,
      )

      const laneWidth = () => page.evaluate(() => document.querySelector('.vt-scroll').scrollWidth)
      const fitted = await laneWidth()

      await park(PARKED)
      await page.locator('.vs-trans .zoomer input[type="range"]').fill('50')
      await page.waitForTimeout(300)
      const zoomed = await laneWidth()
      check('dragging the slider widens the lane past its scroller', zoomed > fitted * 2, `fit=${fitted} zoomed=${zoomed}`)

      const readout = (await page.locator('.vs-trans .zoomer b').textContent()) || ''
      check(
        'the slider is logarithmic, so half its travel is 8x rather than 30x',
        /^[6-9]×$/.test(readout.trim()),
        `halfway reads ${readout.trim()}`,
      )

      const drift = await offCentre('.vt-scroll', '.vt-playhead')
      check(
        'zooming lands on the playhead instead of leaving it off screen',
        drift !== null && Math.abs(drift) < 24,
        `${drift}px from the middle`,
      )
      await page.screenshot({ path: path.join(dir, 'desktop-video-zoomed.png') })

      await page.locator('.vs-trans .zoomer input[type="range"]').fill('100')
      await page.waitForTimeout(250)
      const top = (await page.locator('.vs-trans .zoomer b').textContent()) || ''
      const inDisabled = await page.locator('.vs-trans .zoomer button:has(.ph-magnifying-glass-plus)').isDisabled()
      check('the slider reaches the top of the range and stops there', top.trim() === '60×' && inDisabled, top.trim())

      await page.locator('.vs-trans .zoomer button:has(.ph-magnifying-glass-minus)').click()
      await page.locator('.vs-trans .zoomer button:has(.ph-magnifying-glass-minus)').click()
      await page.waitForTimeout(250)
      const stepped = (await page.locator('.vs-trans .zoomer b').textContent()) || ''
      check('the out button steps back down from the top', Number(stepped.replace('×', '')) < 60, stepped.trim())

      // The gesture still works; the slider is an addition, not a replacement.
      const beforeWheel = await laneWidth()
      await page.locator('.vt-scroll').hover()
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, -240)
      await page.keyboard.up('Control')
      await page.waitForTimeout(300)
      const afterWheel = await laneWidth()
      check('ctrl and scroll still zooms', afterWheel > beforeWheel, `${beforeWheel} -> ${afterWheel}`)
      // React binds `wheel` passively, so an onWheel prop's preventDefault is dropped and
      // the browser zooms the whole page alongside the lane. The warning IS the symptom.
      const passive = errors.filter((t) => /passive event listener/i.test(t))
      check(
        'the gesture is caught non-passively, so it does not also zoom the page',
        passive.length === 0,
        passive[0] || 'no passive-listener warning',
      )

      // The floor screen's walk track shares the control and the hooks.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-caret-left'))
        btn?.click()
      })
      await page.waitForTimeout(300)
      await page.click('.appbar button[title^="Floor"]')
      await page.waitForSelector('.floor-view', { timeout: 5000 })
      await page.waitForTimeout(300)

      const floorSliders = await page.locator('.tl-field .zoomer input[type="range"]').count()
      check('the floor timeline gets the same slider', floorSliders === 1, `${floorSliders} sliders`)

      await park(PARKED)
      await page.locator('.tl-field .zoomer input[type="range"]').fill('50')
      await page.waitForTimeout(300)
      const floorDrift = await offCentre('.mv-scroll', '.mv-playhead')
      check(
        'the floor timeline lands on the playhead too',
        floorDrift !== null && Math.abs(floorDrift) < 24,
        `${floorDrift}px from the middle`,
      )
      await page.screenshot({ path: path.join(dir, 'desktop-floor-zoomed.png') })
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

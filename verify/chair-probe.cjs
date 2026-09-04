/* The focus chair with keyframes: whether it slides between positions during playback
   on the floor and in rehearse, whether a shrunk floor pulls every keyframe back, and
   whether a project saved before keyframes existed still renders exactly as it did. */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')
const path = require('path')
const fs = require('fs')

const PORT = process.argv[2] || '42213'
const URL = `http://localhost:${PORT}/`
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', '6c1d40ab-77e2-4f5b-93ad-8c0e5a1f2b90')

/* 120 BPM, so one count is 0.5s and the anchor is 0. The chair starts front-centre at
   5,6. Key one arrives on count 16 (8s) after an 8-count travel, so it is halfway at 6s.
   Key two arrives on count 32 (16s), halfway at 14s. */
const base = {
  audioName: 'probe.wav',
  duration: 40,
  segments: [
    { id: 's1', name: 'Song', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'm1', startBeat: 0, beats: 2 }],
  moves: [{ id: 'm1', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  // The rehearse mini stage only renders with a cast, and it is the chair there that
  // this probe needs to see.
  people: [{ id: 'p1', name: 'Ana', initials: 'AK', colour: '#8b5cf6' }],
  movements: [{ id: 'mv1', segmentId: 's1', personId: 'p1', beat: 0, travel: 0, to: { col: 2, row: 5 } }],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  updatedAt: Date.now(),
}

const MOVING = {
  ...base,
  id: 'chair1',
  name: 'Chair on the move',
  focus: {
    kind: 'person',
    name: 'The bride',
    col: 5,
    row: 6,
    keys: [
      { id: 'k1', segmentId: 's1', beat: 16, travel: 8, to: { col: 1, row: 1 } },
      { id: 'k2', segmentId: 's1', beat: 32, travel: 8, to: { col: 9, row: 5 } },
    ],
  },
}

const LEGACY = { ...base, id: 'chair2', name: 'Static chair', focus: { kind: 'person', name: 'The bride', col: 5, row: 6 } }

const pct = (index, of) => ((index + 0.5) / of) * 100
const near = (a, b) => Math.abs(a - b) < 0.4

const seek = (page, to) => page.evaluate((t) => (document.querySelector('audio').currentTime = t), to)

const chairAt = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.stage-focus')
    return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null
  })

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    // --- a project with no keys must be untouched by any of this ---
    await seedProject(page, URL, { project: LEGACY, audioBytes: silentWav(40) })
    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    await seek(page, 6)
    await page.waitForTimeout(250)
    const legacy = await chairAt(page)
    check(
      'a chair saved before keyframes existed still sits exactly where it always did',
      legacy && near(legacy.left, pct(5, 11)) && near(legacy.top, pct(6, 7)),
      JSON.stringify(legacy),
    )

    // --- the same chair, now with two keys ---
    await seedProject(page, URL, { project: MOVING, audioBytes: silentWav(40) })
    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view', { timeout: 5000 })

    await seek(page, 2)
    await page.waitForTimeout(250)
    const before = await chairAt(page)
    check(
      'before its first move the chair sits at the static cell it starts from',
      before && near(before.left, pct(5, 11)) && near(before.top, pct(6, 7)),
      JSON.stringify(before),
    )

    await seek(page, 6)
    await page.waitForTimeout(250)
    const midway = await chairAt(page)
    check(
      'halfway through the first move the chair is halfway between the two cells',
      midway && near(midway.left, pct(3, 11)) && near(midway.top, pct(3.5, 7)),
      JSON.stringify(midway),
    )
    await page.screenshot({ path: path.join(SHOTS, 'chair-1-midway.png') })

    await seek(page, 9)
    await page.waitForTimeout(250)
    const arrived = await chairAt(page)
    check(
      'past the count it was pinned to, the chair has arrived and stopped',
      arrived && near(arrived.left, pct(1, 11)) && near(arrived.top, pct(1, 7)),
      JSON.stringify(arrived),
    )

    await seek(page, 14)
    await page.waitForTimeout(250)
    const second = await chairAt(page)
    check(
      'a second key moves it again, from where the first one left it',
      second && near(second.left, pct(5, 11)) && near(second.top, pct(3, 7)),
      JSON.stringify(second),
    )

    // --- rehearse renders the same interpolated chair, not a static one ---
    await page.click('.appbar button:has-text("Rehearse")')
    await page.waitForSelector('.runway', { timeout: 5000 })
    await seek(page, 6)
    await page.waitForTimeout(300)
    const inRehearse = await chairAt(page)
    check(
      'rehearse draws the chair partway through its move too',
      inRehearse && near(inRehearse.left, pct(3, 11)) && near(inRehearse.top, pct(3.5, 7)),
      JSON.stringify(inRehearse),
    )
    await page.screenshot({ path: path.join(SHOTS, 'chair-2-rehearse.png') })

    // --- a shrunk floor has to pull every key back, not just the starting cell ---
    await page.click('.rehearse button:has-text("Exit")')
    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    await seek(page, 6)
    await page.waitForTimeout(250)

    // --- the chair menu is the only way to create the first key, so drive it for real ---
    const chairBox = await page.locator('.stage-focus').boundingBox()
    await page.mouse.click(chairBox.x + chairBox.width / 2, chairBox.y + chairBox.height / 2, { button: 'right' })
    await page.waitForSelector('.mv-menu', { timeout: 5000 })
    await page.screenshot({ path: path.join(SHOTS, 'chair-3-menu.png') })
    check('right-clicking the chair opens its own menu', (await page.locator('.mv-menu:has-text("Pin the chair")').count()) === 1)

    await page.click('.mv-menu button:has-text("Pin the chair")')
    await page.waitForTimeout(300)
    const keys = () =>
      page.evaluate(async () => {
        const appSrc = await (await fetch('/src/App.tsx')).text()
        const mod = await import(appSrc.match(/"([^"]*lib\/store\.ts[^"]*)"/)[1])
        return mod.getState().project.focus.keys
      })
    const pinned = await keys()
    check('pinning writes a key on the count under the playhead', pinned.length === 3 && pinned.some((k) => k.beat === 12), JSON.stringify(pinned))

    // Once the chair has keys, a drag retimes the key at this count rather than moving
    // the static cell, which is the same upsert rule a puck drag follows.
    const stageBox = await page.locator('.stage').boundingBox()
    const cellCentre = (col, row) => ({
      x: stageBox.x + ((col + 0.5) / 11) * stageBox.width,
      y: stageBox.y + ((row + 0.5) / 7) * stageBox.height,
    })
    const from = await page.locator('.stage-focus').boundingBox()
    const target = cellCentre(8, 2)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(from.x + from.width / 2 + ((target.x - from.x - from.width / 2) * i) / 8, from.y + from.height / 2 + ((target.y - from.y - from.height / 2) * i) / 8)
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const dragged = await keys()
    const atCount = dragged.find((k) => k.beat === 12)
    check(
      'dragging the chair edits the key on that count, and adds no second one',
      dragged.length === 3 && atCount && atCount.to.col === 8 && atCount.to.row === 2,
      JSON.stringify(dragged),
    )

    const clamped = await page.evaluate(async () => {
      const appSrc = await (await fetch('/src/App.tsx')).text()
      const mod = await import(appSrc.match(/"([^"]*lib\/store\.ts[^"]*)"/)[1])
      mod.setFloorSize({ cols: 6, rows: 4 })
      return mod.getState().project.focus.keys.map((k) => k.to)
    })
    check(
      'shrinking the floor pulls every chair keyframe back inside it',
      clamped.every((to) => to.col <= 5 && to.row <= 3),
      JSON.stringify(clamped),
    )

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

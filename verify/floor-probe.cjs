/* Floor view: cast, formations, the drag onto the grid, derived presence, and the
   sheet lane. Seeds a project in the PRE-floor shape on purpose, so every run also
   re-proves migrateProject's backfill for the three arrival paths. */
const {
  withBrowser,
  desktopContext,
  seedProject,
  readProject,
  silentWav,
  createChecklist,
} = require('./harness.cjs')
const path = require('path')
const fs = require('fs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', '47760-134329196880339036')

/* No people, no formations, no focus: exactly what every project saved before today looks like. */
const OLD_SHAPE = {
  id: 'floor1',
  name: 'Wedding medley 2026',
  audioName: 'probe.wav',
  duration: 240,
  segments: [
    { id: 's1', name: 'I Will Survive', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
    { id: 's2', name: 'Cotton Eye Joe', start: 120, bpm: 120, anchor: 120, transitionIn: 0, countsPerRow: 8, lyrics: [] },
  ],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 }],
  moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  updatedAt: Date.now(),
}

const cell = (box, col, row) => ({
  x: box.x + (box.width / 11) * (col + 0.5),
  y: box.y + (box.height / 7) * (row + 0.5),
})

async function addPerson(page, name) {
  await page.click('button:has-text("Cast")')
  await page.fill('.modal input[placeholder="Name"]', name)
  await page.click('.modal button:has-text("Add")')
  await page.click('.modal footer button')
  await page.waitForTimeout(150)
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    await seedProject(page, URL, { project: OLD_SHAPE, audioBytes: silentWav(240) })

    const migrated = await readProject(page)
    check(
      'migrateProject backfills the floor fields on a pre-floor project',
      Array.isArray(migrated?.people) && Array.isArray(migrated?.formations) && migrated?.focus?.kind === 'audience',
      `people=${JSON.stringify(migrated?.people)} formations=${JSON.stringify(migrated?.formations)} focus=${JSON.stringify(migrated?.focus)}`,
    )

    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    check('the topbar Floor button opens the floor view', true)
    check('an empty floor prompts instead of rendering a blank stage', await page.locator('.floor-rail .hint').isVisible())
    await page.screenshot({ path: path.join(SHOTS, 'floor-1-empty.png') })

    for (const name of ['Joe Muzic', 'Ivan Horvat', 'Ana Kovac', 'Petra Novak']) await addPerson(page, name)
    const cast = (await readProject(page)).people
    check('the cast modal adds people with derived initials', cast.length === 4 && cast[0].initials === 'JM', JSON.stringify(cast.map((p) => p.initials)))
    check('every person gets a distinct colour', new Set(cast.map((p) => p.colour)).size === 4)

    await page.click('button:has-text("Formation here")')
    await page.waitForSelector('.f-chip', { timeout: 5000 })
    check('Formation here drops a formation at the playhead', (await readProject(page)).formations.length === 1)

    // Two people on at the opening, so the next formation has someone to walk on against.
    for (let i = 0; i < 2; i++) await page.click('.p-chip.off')
    await page.waitForTimeout(200)
    check('tapping a waiting chip walks that person onto the floor', (await page.locator('.stage .puck').count()) === 2)

    const box = await page.locator('.stage').boundingBox()
    const before = (await readProject(page)).formations[0].spots.find((s) => s.personId === cast[0].id)
    const target = cell(box, 1, 1)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const puck = await page.locator('.stage .puck').first().boundingBox()
    await page.mouse.move(puck.x + puck.width / 2, puck.y + 20)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(250)
    const after = (await readProject(page)).formations[0].spots.find((s) => s.personId === cast[0].id)
    check(
      'dragging a puck snaps it to the grid cell under the pointer',
      after && (after.col !== before.col || after.row !== before.row) && after.col === 1 && after.row === 1,
      `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    )

    await page.screenshot({ path: path.join(SHOTS, 'floor-2-first-formation.png') })

    // Song 2, so the second formation is on a different segment and inherits forward.
    await page.evaluate(() => (document.querySelector('audio').currentTime = 120))
    await page.click('button:has-text("Formation here")')
    await page.waitForTimeout(250)
    const two = (await readProject(page)).formations
    const second = two.find((f) => f.segmentId === 's2')
    check('a new formation lands on the song under the playhead', !!second, JSON.stringify(two.map((f) => `${f.segmentId}@${f.startBeat}`)))
    check(
      'a new formation carries the previous positions forward',
      second?.spots.length === 2 && second.spots.some((s) => s.col === 1 && s.row === 1),
      JSON.stringify(second?.spots),
    )

    await page.click('.p-chip.off')
    await page.waitForTimeout(250)
    check('someone added to a later formation is flagged as walking on', (await page.locator('.stage .puck.entering').count()) === 1)

    await page.click('button:has-text("One person")')
    await page.fill('.floor-side input[placeholder="The bride"]', 'Ines')
    await page.waitForTimeout(300)
    const focus = (await readProject(page)).focus
    check('the focus can be one seated person rather than a crowd', focus.kind === 'person' && focus.name === 'Ines', JSON.stringify(focus))
    check('the audience band is gone once the focus is a person', (await page.locator('.stage-audience').count()) === 0)
    await page.screenshot({ path: path.join(SHOTS, 'floor-3-second-formation.png') })

    await page.click('button:has-text("Who is in when")')
    await page.waitForSelector('.cast-timeline')
    check('the timeline draws one lane per person', (await page.locator('.tl-row').count()) === 4)
    check(
      'someone who is never placed gets no bar, which is what offstage means',
      (await page.locator('.tl-row').nth(3).locator('.tl-bar').count()) === 0,
    )
    await page.screenshot({ path: path.join(SHOTS, 'floor-4-timeline.png') })

    await page.click('.appbar button[title="Back to the sheet"]')
    await page.waitForSelector('.sheet')
    const tags = page.locator('.formation-tag')
    check('the sheet shows a formation tag on the count it lands on', (await tags.count()) >= 1)
    await tags.first().click()
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    check('clicking a sheet tag opens that formation on the floor', await page.locator('.f-chip.on').isVisible())

    await page.click('.appbar button[title="Back to the sheet"]')
    await page.waitForSelector('.sheet')
    await page.screenshot({ path: path.join(SHOTS, 'floor-5-sheet-lane.png') })

    check('no console or page errors', errors.length === 0, errors.join(' | '))
    await context.close()
  })

  report()
  console.log(`\nscreenshots: ${SHOTS}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

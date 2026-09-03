/* Floor view: the cast rail, walking someone on at the playhead, dragging a puck to
   set where they land, the movement timeline and its walk-length menu, and the sheet
   cue lane. Seeds a project in the PRE-movement shape on purpose, so every run also
   re-proves that whole-cast formations still explode into per-person movements. */
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
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', process.env.CLAUDE_CODE_SESSION_ID || 'floor-movements')

/* Two whole-cast snapshots, which is what every project saved before today looks like:
   Ana holds her cell across both, Bruno moves, Iva walks off at the second. */
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
  people: [
    { id: 'p-ana', name: 'Ana Kovac', initials: 'AK', colour: '#7c5cff' },
    { id: 'p-bruno', name: 'Bruno Horvat', initials: 'BH', colour: '#3fb8b0' },
    { id: 'p-iva', name: 'Iva Novak', initials: 'IN', colour: '#f0a63c' },
  ],
  formations: [
    {
      id: 'f1',
      segmentId: 's1',
      startBeat: 8,
      name: 'Opening',
      spots: [
        { personId: 'p-ana', col: 5, row: 6 },
        { personId: 'p-bruno', col: 3, row: 5 },
        { personId: 'p-iva', col: 7, row: 5 },
      ],
    },
    {
      id: 'f2',
      segmentId: 's2',
      startBeat: 16,
      name: 'Chorus',
      spots: [
        { personId: 'p-ana', col: 5, row: 6 },
        { personId: 'p-bruno', col: 4, row: 2 },
      ],
    },
  ],
  updatedAt: Date.now(),
}

const cell = (box, cols, rows, col, row) => ({
  x: box.x + (box.width / cols) * (col + 0.5),
  y: box.y + (box.height / rows) * (row + 0.5),
})

const seek = (page, to) => page.evaluate((t) => (document.querySelector('audio').currentTime = t), to)

/* Everything below is edited at this one playhead position. Both songs run at 120 BPM,
   so a count is half a second and the seek lands on a whole count rather than between two. */
const AT = 20
const BEAT = AT / (60 / 120)

const forPerson = (project, personId) => project.movements.filter((m) => m.personId === personId)

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
      'migrateProject backfills the floor size and default walk length',
      migrated?.floor?.cols === 11 && migrated?.floor?.rows === 7 && migrated?.walkCounts === 8,
      `floor=${JSON.stringify(migrated?.floor)} walkCounts=${migrated?.walkCounts}`,
    )
    check('the retired formations field is dropped rather than carried forward', migrated?.formations === undefined)
    check(
      'each snapshot spot becomes one movement, and a held cell does not repeat',
      forPerson(migrated, 'p-ana').length === 1,
      JSON.stringify(forPerson(migrated, 'p-ana')),
    )
    check(
      'someone who changes cell between snapshots gets a second movement',
      forPerson(migrated, 'p-bruno').length === 2,
      JSON.stringify(forPerson(migrated, 'p-bruno')),
    )
    check(
      'dropping out of a snapshot migrates to a movement with nowhere to go',
      forPerson(migrated, 'p-iva').length === 2 && forPerson(migrated, 'p-iva')[1].to === null,
      JSON.stringify(forPerson(migrated, 'p-iva')),
    )
    check(
      'a migrated movement has no walk in front of it, matching the snapshot it came from',
      migrated.movements.every((m) => m.travel === 0),
    )

    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    check('the topbar Floor button opens the floor view', true)
    check('the cast rail lists everyone without opening a modal', (await page.locator('.rail-person').count()) === 3)
    check('the timeline draws one lane per person', (await page.locator('.mv-lane:not(.mv-ruler)').count()) === 3)

    // Past the first snapshot, so the migrated positions are the ones on screen.
    await seek(page, AT)
    await page.waitForTimeout(200)
    check('everyone standing at the playhead is on the floor', (await page.locator('.stage .puck').count()) === 3)
    await page.screenshot({ path: path.join(SHOTS, 'floor-1-migrated.png') })

    // A new face, added from the rail rather than a modal.
    await page.fill('.rail-add input', 'Marko Juric')
    await page.press('.rail-add input', 'Enter')
    await page.waitForTimeout(200)
    const cast = (await readProject(page)).people
    check('the rail adds someone with derived initials and a fresh colour', cast.length === 4 && cast[3].initials === 'MJ', JSON.stringify(cast[3]))
    check('a new person starts offstage', (await page.locator('.rail-person.off').count()) === 1)

    await page.click('.rail-person.off button[title^="Bring on"]')
    await page.waitForTimeout(250)
    const walkedOn = forPerson(await readProject(page), cast[3].id)
    check(
      'bringing someone on writes one movement on the count at the playhead',
      walkedOn.length === 1 && walkedOn[0].to !== null && walkedOn[0].beat === BEAT,
      JSON.stringify(walkedOn),
    )
    check(
      'a movement made by hand carries the project default walk length',
      walkedOn[0].travel === 8,
      JSON.stringify(walkedOn[0]),
    )
    check(
      'an entrance spawns at back centre, the far row from whoever they face',
      walkedOn[0].to.col === 5 && walkedOn[0].to.row === 0,
      JSON.stringify(walkedOn[0].to),
    )
    check('they appear on the floor straight away', (await page.locator('.stage .puck').count()) === 4)

    // Drag Ana onto an empty cell: the destination is what changes, not the count.
    const box = await page.locator('.stage').boundingBox()
    const puck = await page.locator('.stage .puck').first().boundingBox()
    const target = cell(box, 11, 7, 1, 1)
    await page.mouse.move(puck.x + puck.width / 2, puck.y + 20)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(250)
    const anaNow = forPerson(await readProject(page), 'p-ana')
    check(
      'dragging a puck writes where that person must be on the count under the playhead',
      anaNow.length === 2 && anaNow[1].beat === BEAT && anaNow[1].to.col === 1 && anaNow[1].to.row === 1,
      JSON.stringify(anaNow),
    )
    check(
      'the whole drag is one movement, not one per cell it crossed',
      (await readProject(page)).movements.filter((m) => m.personId === 'p-ana' && m.beat === BEAT).length === 1,
    )
    await page.screenshot({ path: path.join(SHOTS, 'floor-2-dragged.png') })

    // A click that never drags is how you get back to where a walk lands, which is
    // the only count from which its destination can be edited.
    const walkBlock = page.locator('.mv-lane:not(.mv-ruler)').first().locator('.mv-walk').last()
    await seek(page, 5)
    await page.waitForTimeout(150)
    await walkBlock.click()
    await page.waitForTimeout(200)
    const landedAt = await page.evaluate(() => document.querySelector('audio').currentTime)
    check(
      'clicking a walk seeks to the count it lands on, not the count it starts from',
      Math.abs(landedAt - AT) < 0.05,
      `currentTime=${landedAt} expected=${AT}`,
    )
    check(
      'the walk under the playhead is flagged as the one a floor drag would edit',
      (await page.locator('.mv-walk.live').count()) >= 1,
    )

    // Zooming has to widen the lanes past the scroller, or there is nothing to scroll.
    const scrollWidth = () => page.evaluate(() => document.querySelector('.mv-scroll').scrollWidth)
    const fitted = await scrollWidth()
    for (let i = 0; i < 3; i++) await page.click('.tl-field button:has(.ph-magnifying-glass-plus)')
    await page.waitForTimeout(250)
    const zoomed = await scrollWidth()
    check('zooming in widens the lanes past the scroller', zoomed > fitted * 2, `fit=${fitted} zoomed=${zoomed}`)
    check('the name column stays pinned while the lanes scroll', await page.locator('.mv-who').first().isVisible())
    await page.screenshot({ path: path.join(SHOTS, 'floor-6-zoomed.png') })
    for (let i = 0; i < 3; i++) await page.click('.tl-field button:has(.ph-magnifying-glass-minus)')
    await page.waitForTimeout(250)

    // Right-click that walk and make it instant.
    const walk = page.locator('.mv-lane:not(.mv-ruler)').first().locator('.mv-walk').last()
    await walk.click({ button: 'right' })
    await page.waitForSelector('.mv-menu')
    check('right-clicking a walk opens its length menu', await page.locator('.mv-menu .mi:has-text("One bar")').isVisible())
    await page.screenshot({ path: path.join(SHOTS, 'floor-3-walk-menu.png') })
    await page.click('.mv-menu .mi:has-text("Instant")')
    await page.waitForTimeout(250)
    check(
      'picking a length retimes that one walk and leaves the arrival alone',
      forPerson(await readProject(page), 'p-ana')[1].travel === 0 &&
        forPerson(await readProject(page), 'p-ana')[1].beat === BEAT,
      JSON.stringify(forPerson(await readProject(page), 'p-ana')[1]),
    )

    // Walking off is a movement to nowhere, so a lane can end.
    await page.click('.rail-person:not(.off) button[title^="Walk off"]')
    await page.waitForTimeout(250)
    const exits = (await readProject(page)).movements.filter((m) => m.to === null && m.beat === BEAT)
    check('walking someone off writes a movement with nowhere to go', exits.length === 1, JSON.stringify(exits))

    // Resizing has to pull anyone standing past the new edge back on.
    await page.click('.appbar button[title^="Floor size"]')
    await page.waitForSelector('.modal')
    for (let i = 0; i < 4; i++) await page.click('.modal .field .step button:has(.ph-minus)')
    await page.waitForTimeout(300)
    const resized = await readProject(page)
    check('the floor size stepper narrows the grid', resized.floor.cols === 7, JSON.stringify(resized.floor))
    check(
      'nobody is left standing past the new edge',
      resized.movements.every((m) => !m.to || m.to.col < resized.floor.cols),
      JSON.stringify(resized.movements.map((m) => m.to)),
    )
    await page.click('.modal footer button')
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(SHOTS, 'floor-4-resized.png') })

    await page.click('.appbar button[title="Back to the sheet"]')
    await page.waitForSelector('.sheet')
    const tags = page.locator('.cue-tag')
    check('the sheet shows a cue on the count someone has to be somewhere', (await tags.count()) >= 1)
    await tags.first().click()
    await page.waitForSelector('.floor-view', { timeout: 5000 })
    check('clicking a sheet cue seeks to it and opens the floor', await page.locator('.stage').isVisible())

    // Rehearse's runway is the only timeline on that screen, so it has to be draggable.
    await page.click('.appbar button:has-text("Rehearse")')
    await page.waitForSelector('.runway', { timeout: 5000 })
    const strip = await page.locator('.runway').boundingBox()
    const before = await page.evaluate(() => document.querySelector('audio').currentTime)
    await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2)
    await page.mouse.down()
    await page.mouse.move(strip.x + strip.width / 2 - 200, strip.y + strip.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const after = await page.evaluate(() => document.querySelector('audio').currentTime)
    check(
      'dragging the rehearse runway left moves forward through the song',
      after - before > 1,
      `before=${before} after=${after}`,
    )
    await page.screenshot({ path: path.join(SHOTS, 'floor-7-rehearse.png') })
    await page.click('.rehearse button:has-text("Exit")')
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

/* Reading the app as one dancer: the sheet's fold and per-count override, the cue lane,
   the floor, the rehearse screen, what a move placed under the lens gets tagged with,
   and whether the choice survives a reload.
   Run: node verify/viewing-as-probe.cjs [port] */
const { withBrowser, desktopContext, seedProject, readProject, silentWav, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`

/* Row 2 (counts 9-16) is the interesting one: an 8-count default with Ana's own 4-count
   move over its second half, so the default must survive as its counts 9-12 piece. */
const PROJECT = {
  id: 'va1',
  name: 'Viewing as probe',
  audioName: 'probe.wav',
  duration: 240,
  segments: [
    {
      id: 's1',
      name: 'I Will Survive',
      start: 0,
      bpm: 120,
      anchor: 0,
      transitionIn: 0,
      countsPerRow: 8,
      lyrics: [],
      fit: { offset: 0, scale: 1 },
    },
  ],
  blocks: [
    { id: 'b-open', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 4 },
    { id: 'b-default', segmentId: 's1', moveId: 'macarena', startBeat: 8, beats: 8 },
    { id: 'b-guys', segmentId: 's1', moveId: 'running-man', startBeat: 8, beats: 8, for: ['g-guys'] },
    { id: 'b-ana', segmentId: 's1', moveId: 'body-roll', startBeat: 12, beats: 4, for: ['p-ana'] },
  ],
  moves: [
    { id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 },
    { id: 'macarena', name: 'Macarena arms', beats: 8, energy: 2 },
    { id: 'running-man', name: 'Running man', beats: 4, energy: 3 },
    { id: 'body-roll', name: 'Body roll', beats: 4, energy: 2 },
  ],
  markers: [],
  people: [
    { id: 'p-ana', name: 'Ana Kovac', initials: 'AK', colour: '#7c5cff' },
    { id: 'p-bruno', name: 'Bruno Horvat', initials: 'BH', colour: '#3fb8b0' },
    { id: 'p-iva', name: 'Iva Novak', initials: 'IN', colour: '#f0a63c' },
  ],
  groups: [{ id: 'g-guys', name: 'The guys', members: ['p-bruno', 'p-iva'] }],
  movements: [
    { id: 'mv-ana', personId: 'p-ana', segmentId: 's1', beat: 12, travel: 4, to: { col: 2, row: 2 } },
    { id: 'mv-bruno', personId: 'p-bruno', segmentId: 's1', beat: 13, travel: 4, to: { col: 0, row: 1 } },
    { id: 'mv-iva', personId: 'p-iva', segmentId: 's1', beat: 12, travel: 4, to: { col: 4, row: 0 } },
  ],
  takes: [],
  clips: [],
  floor: { cols: 6, rows: 3 },
  walkCounts: 4,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

const { check, report } = createChecklist()

// Dynamic import of the live store module, same trick as share-probe.cjs: dev-server
// module URLs carry a cache-busting query the source string does not, so the import
// specifier has to be read back off the served App.tsx rather than hardcoded.
const STORE_CALL = (body) =>
  `(async () => {
     const appSrc = await (await fetch('/src/App.tsx')).text()
     const mod = await import(appSrc.match(/"([^"]*lib\\/store\\.ts[^"]*)"/)[1])
     ${body}
   })()`

/** Names and geometry of the blocks drawn on one sheet row, in counts. */
const rowBlocks = (page, row) =>
  page.evaluate((row) => {
    const grid = document.querySelectorAll('.counts')[row]
    const box = grid.getBoundingClientRect()
    const cell = box.width / 8
    return [...grid.querySelectorAll('.block')].map((b) => {
      const r = b.getBoundingClientRect()
      return {
        name: b.querySelector('.block-name')?.textContent ?? '',
        from: Math.round((r.left - box.left) / cell) + 1,
        counts: Math.round(r.width / cell),
        clipped: b.classList.contains('clipped'),
        variant: b.classList.contains('variant'),
        cast: [...b.querySelectorAll('.block-cast .d')].map((d) => d.textContent),
      }
    })
  }, row)

const pickViewAs = async (page, label) => {
  await page.click('.view-as')
  await page.waitForSelector('.view-as-menu')
  await page.evaluate((label) => {
    const menu = document.querySelector('.view-as-menu')
    const hit = [...menu.querySelectorAll('.cast-opt')].find((b) => b.textContent.includes(label))
    hit.click()
  }, label)
  await page.waitForTimeout(150)
}

async function main() {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(desktopContext())
    const page = await ctx.newPage()
    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(30) })

    // --- the general view keeps the whole-cast plan ---
    const general = await rowBlocks(page, 1)
    check(
      'general view draws the default whole, with both variants folded away',
      general.length === 1 && general[0].name === 'Macarena arms' && general[0].counts === 8,
      JSON.stringify(general),
    )
    check(
      'the folded row says how many differ',
      (await page.textContent('.variant-chip'))?.includes('2 differ'),
      await page.textContent('.variant-chip').catch(() => 'no chip'),
    )

    await page.click('.variant-chip')
    await page.waitForTimeout(120)
    const unfolded = await rowBlocks(page, 1)
    check(
      'unfolding shows both variants, each carrying its own cast',
      unfolded.length === 3 && unfolded.filter((b) => b.variant && b.cast.length > 0).length === 2,
      JSON.stringify(unfolded.map((b) => `${b.name}:${b.cast.join('/')}`)),
    )

    // --- read as Ana ---
    await pickViewAs(page, 'Ana Kovac')
    const asAna = await rowBlocks(page, 1)
    const macarena = asAna.find((b) => b.name === 'Macarena arms')
    check(
      "Ana's own move replaces the default only on the counts it covers",
      asAna.length === 2 && macarena?.from === 1 && macarena?.counts === 4 && macarena?.clipped === true,
      JSON.stringify(asAna),
    )
    check(
      "the guys' variant is not on Ana's sheet",
      !asAna.some((b) => b.name === 'Running man'),
      JSON.stringify(asAna.map((b) => b.name)),
    )
    check(
      'the row keeps one lane, so a dancer reads a single line of moves',
      await page.evaluate(() => getComputedStyle(document.querySelectorAll('.counts')[1]).getPropertyValue('--lanes').trim() === '1'),
    )
    const cues = await page.$$eval('.cue-tag .d', (els) => els.map((e) => e.textContent))
    check('the cue lane carries only her own walks', cues.length === 1 && cues[0] === 'AK', JSON.stringify(cues))

    // --- a move placed under the lens belongs to the dancer being read ---
    // The row number selects its whole row, which is what arms the library rail.
    await page.click('.row-no >> nth=2')
    await page.waitForTimeout(150)
    // A move card places on pointerup when the pointer never moved, so this is a real
    // click, not an element.click() that would skip the gesture entirely.
    await page.click('.move-card[data-move-id="step-touch"]')
    await page.waitForTimeout(200)
    const saved = await readProject(page)
    const placed = saved.blocks.filter((b) => !PROJECT.blocks.some((o) => o.id === b.id))
    check(
      'a move laid down while reading as Ana is tagged to Ana, not to everyone',
      placed.length > 0 && placed.every((b) => b.for?.length === 1 && b.for[0] === 'p-ana'),
      JSON.stringify(placed.map((b) => b.for)),
    )
    check(
      "placing it did not disturb anyone else's blocks",
      PROJECT.blocks.every((o) => saved.blocks.some((b) => b.id === o.id)),
      `${saved.blocks.length} blocks`,
    )

    // --- the floor and the rehearse screen read the same lens ---
    // Nobody is standing before their first walk, so there is nothing to draw at 0.
    await page.evaluate(() => (document.querySelector('audio').currentTime = 8))
    await page.waitForTimeout(200)
    await page.click('button[title*="Floor"]')
    await page.waitForSelector('.stage')
    check(
      'her puck is marked and the rest are stepped back, not removed',
      (await page.$$('.puck.mine')).length === 1 && (await page.$$('.puck.other')).length === 2,
    )

    await page.click('.floor-view .appbar button.primary')
    await page.waitForSelector('.rehearse')
    await page.evaluate(() => {
      const el = document.querySelector('audio')
      if (el) el.currentTime = 6.5 // counts 13-16 of row 2, where Ana's own move is
    })
    await page.waitForTimeout(300)
    check(
      'rehearse resolves her own move, not the cast default',
      (await page.textContent('.rehearse-move')) === 'Body roll',
      await page.textContent('.rehearse-move'),
    )
    check(
      'rehearse names her spot even past her last walk, which is when she looks',
      !!(await page.$('.reh-cue')),
      await page.textContent('.reh-cue').catch(() => 'no cue'),
    )
    check('the lens control is reachable from the rehearse screen too', !!(await page.$('.rehearse-top .view-as')))

    // --- and it is remembered ---
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    check(
      'the choice survives a reload, so nobody re-picks themselves at the venue',
      (await page.textContent('.view-as'))?.includes('Ana'),
      await page.textContent('.view-as').catch(() => 'no control'),
    )

    // --- back to everyone ---
    await pickViewAs(page, 'Everyone')
    const back = await rowBlocks(page, 1)
    check(
      'switching back restores the whole-cast plan',
      back.length === 1 && back[0].name === 'Macarena arms' && back[0].counts === 8,
      JSON.stringify(back),
    )
    // --- todo 38: an unanswered share offers the chooser on every view, not just rehearse and floor ---
    // Simulates what adoptShare + the project-switch effect leave behind for someone who
    // opened a share and never answered: askWhoAreYou true, no stored viewAs. Driving a
    // real /v/<token> boot would need a live share doc in the emulator; calling the store
    // directly isolates the App.tsx rendering gap this todo is actually about.
    const store = (body) => page.evaluate(STORE_CALL(body))
    await store(`mod.set({ viewAs: null, askWhoAreYou: true }, false)`)
    await store(`mod.set({ view: 'setup' }, false)`)
    await page.waitForTimeout(200)
    check('the chooser is offered on the setup view, which used to lack it', await page.locator('.cast-picker').isVisible())

    // Answering it there is the same store call the sheet's own chooser makes.
    await page.evaluate(() => {
      const picker = document.querySelector('.cast-picker')
      const hit = [...picker.querySelectorAll('.cast-opt')].find((b) => b.textContent.includes('Bruno Horvat'))
      hit.click()
    })
    await page.waitForTimeout(150)
    await store(`mod.set({ view: 'sheet' }, false)`)
    await page.waitForTimeout(200)
    check(
      'answering on the setup view is reflected on the sheet, which used to lack the chooser too',
      (await page.textContent('.view-as'))?.includes('Bruno'),
      await page.textContent('.view-as').catch(() => 'no control'),
    )
    check('once answered, the chooser does not ask again', (await page.locator('.cast-picker').count()) === 0)

    await ctx.close()
  })
  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

/* Regression probe for todo 09: setup step 2's beat detection + adjustment.
 * A static read can't tell whether an anchor/bpm nudge survives a reload, or
 * whether entering the step silently overwrites a tempo the dev already
 * approved - both need a live page. Run: node verify/setup-beats-probe.cjs [port]
 */
const { withBrowser, desktopContext, seedProject, silentWav, readProject, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`

const APPROVED_BPM_1 = 132.5
const APPROVED_ANCHOR_1 = 0.42
const APPROVED_BPM_2 = 96.3
const APPROVED_ANCHOR_2 = 15.1

function project() {
  return {
    id: 'beats-probe',
    name: 'Beats probe medley',
    audioName: 'probe.wav',
    duration: 30,
    segments: [
      {
        id: 'seg-1',
        name: 'Song 1',
        start: 0,
        bpm: APPROVED_BPM_1,
        anchor: APPROVED_ANCHOR_1,
        transitionIn: 0,
        countsPerRow: 8,
        lyrics: [],
        fit: { offset: 0, scale: 1 },
      },
      {
        id: 'seg-2',
        name: 'Song 2',
        start: 15,
        bpm: APPROVED_BPM_2,
        anchor: APPROVED_ANCHOR_2,
        transitionIn: 0.5,
        countsPerRow: 8,
        lyrics: [],
        fit: { offset: 0, scale: 1 },
      },
    ],
    // A block is required or App.tsx routes straight to setup (blocks.length === 0 -> 'setup'),
    // which would skip the sheet -> topbar "Beats" chip path this probe drives through.
    blocks: [{ id: 'b1', segmentId: 'seg-1', moveId: 'step-touch', startBeat: 0, beats: 2 }],
    moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
    markers: [],
    people: [],
    movements: [],
    takes: [],
    clips: [],
    floor: { cols: 6, rows: 4 },
    walkCounts: 4,
    pinned: [],
    focus: { kind: 'audience' },
    updatedAt: Date.now(),
  }
}

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    ({ selector, text }) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim().includes(text)),
    { selector, text },
  )
  const el = handle.asElement()
  if (!el) throw new Error(`clickByText: no ${selector} containing "${text}"`)
  await el.click()
}

const { check, report } = createChecklist()

async function main() {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(desktopContext())
    const page = await ctx.newPage()
    page.on('dialog', (d) => d.accept())
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await seedProject(page, URL, { project: project(), audioBytes: silentWav(30) })

    // Enter the Beats step via the topbar picker (App.tsx's setup-picker-chip), same
    // route a real dev takes from the sheet - not a direct store poke.
    await clickByText(page, '.setup-picker-chip', 'Beats')
    await page.waitForSelector('.beats-card')
    // Past the debounced audio decode + the one-pass auto-detect, so a proposal
    // (if any) has already been computed before the "not overwritten" check below.
    await page.waitForTimeout(800)

    const beforeNudge = await readProject(page)
    const seg1Before = beforeNudge?.segments.find((s) => s.id === 'seg-1')
    const seg2Before = beforeNudge?.segments.find((s) => s.id === 'seg-2')
    check(
      'entering the step does not silently overwrite an already-approved tempo (song 1)',
      seg1Before?.bpm === APPROVED_BPM_1 && seg1Before?.anchor === APPROVED_ANCHOR_1,
      JSON.stringify({ bpm: seg1Before?.bpm, anchor: seg1Before?.anchor }),
    )
    check(
      'entering the step does not silently overwrite an already-approved tempo (song 2)',
      seg2Before?.bpm === APPROVED_BPM_2 && seg2Before?.anchor === APPROVED_ANCHOR_2,
      JSON.stringify({ bpm: seg2Before?.bpm, anchor: seg2Before?.anchor }),
    )

    // Nudge song 1's grid (anchor) and tempo (bpm) via the manual controls - the
    // only two knobs the decided design allows.
    const cards = page.locator('.beats-card')
    const song1Card = cards.nth(0)
    await song1Card.locator('button[title="Slide the grid 10ms later"]').click()
    await song1Card.locator('button[title="Slide the grid 10ms later"]').click()
    await song1Card.locator('button[title="Speed up the tempo by 0.1 BPM"]').click()
    await song1Card.locator('button[title="Speed up the tempo by 0.1 BPM"]').click()
    await song1Card.locator('button[title="Speed up the tempo by 0.1 BPM"]').click()

    const expectedAnchor = Number((APPROVED_ANCHOR_1 + 0.02).toFixed(3))
    const expectedBpm = Number((APPROVED_BPM_1 + 0.3).toFixed(1))

    // Past the 400ms save debounce before navigating away: reloading inside the
    // debounce window races the pagehide flush against IndexedDB's own async write
    // (the same race verify/restore-race.cjs exists to probe on purpose elsewhere),
    // which is not what this check is about.
    await page.waitForTimeout(600)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.counts, .drop')

    const afterReload = await readProject(page)
    const seg1After = afterReload?.segments.find((s) => s.id === 'seg-1')
    check(
      'the anchor nudge survives a reload',
      seg1After?.anchor === expectedAnchor,
      `expected ${expectedAnchor}, got ${seg1After?.anchor}`,
    )
    check('the tempo nudge survives a reload', seg1After?.bpm === expectedBpm, `expected ${expectedBpm}, got ${seg1After?.bpm}`)

    // The other song's approved tempo was never touched by any of the above.
    const seg2After = afterReload?.segments.find((s) => s.id === 'seg-2')
    check(
      'a nudge to one song never touches another song already approved',
      seg2After?.bpm === APPROVED_BPM_2 && seg2After?.anchor === APPROVED_ANCHOR_2,
      JSON.stringify({ bpm: seg2After?.bpm, anchor: seg2After?.anchor }),
    )

    check('no console/page errors during the run', pageErrors.length === 0, pageErrors.join(' | '))

    await ctx.close()
  })
  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

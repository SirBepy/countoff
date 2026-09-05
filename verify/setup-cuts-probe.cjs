/* Regression probe for todo 08: setup step 1 is a cuts-only screen with millisecond
 * song times. Checks the screen shows no BPM/transition/downbeat/count control, that
 * a typed time lands exactly and survives a reload, that adding a cut here never
 * blocks on tempo detection, and that undo still coalesces per-field edits.
 * Run: node verify/setup-cuts-probe.cjs [port]
 */
const fs = require('fs')
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, readProject, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`
const SCREENSHOT_DIR = path.join(__dirname, '..', '.for_bepy', 'screenshots', '38708-134330726576022206')
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

function project() {
  return {
    id: 'cuts-probe',
    name: 'Cuts probe medley',
    audioName: 'probe.wav',
    duration: 200,
    segments: [
      { id: 's1', name: 'Song 1', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
      { id: 's2', name: 'Song 2', start: 60, bpm: 128, anchor: 60, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
      { id: 's3', name: 'Song 3', start: 140, bpm: 100, anchor: 140, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
    ],
    // A block is required or App.tsx routes straight to setup (blocks.length === 0 -> 'setup'),
    // which would skip the sheet -> topbar "Cuts" chip path this probe drives through.
    blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 }],
    moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
    markers: [],
    people: [],
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

    // Real audio the length of the project's duration, so seeking to a mid-track
    // time for "Cut here" below is not clamped back by a too-short blob.
    await seedProject(page, URL, { project: project(), audioBytes: silentWav(200) })

    // Enter the Cuts step via the topbar picker (App.tsx's setup-picker-chip), the
    // same route a real dev takes from the sheet - not a direct store poke.
    await clickByText(page, '.setup-picker-chip', 'Cuts')
    await page.waitForSelector('.cuts-step')

    // --- Acceptance: the screen shows the timeline and start/end only ---
    const bodyText = await page.locator('.setup-flow-body').innerText()
    check('no BPM field on the cuts screen', !/tempo \(bpm\)/i.test(bodyText))
    check('no transition field on the cuts screen', !/transition/i.test(bodyText))
    check('no downbeat field on the cuts screen', !/downbeat/i.test(bodyText))
    check('no count-length field on the cuts screen', !/count length/i.test(bodyText))

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'setup-cuts-overview.png') })

    // --- Acceptance: typing 1:23.456 into a start field moves that cut and survives a reload ---
    const song2Start = page.locator('.setup-list .setup-card').nth(1).locator('.setup-field').nth(0).locator('input')
    await song2Start.fill('1:23.456')
    await song2Start.screenshot({ path: path.join(SCREENSHOT_DIR, 'setup-cuts-start-field-editing.png') })
    await song2Start.press('Enter')
    await page.waitForTimeout(500)

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.counts, .drop')
    const afterReload = await readProject(page)
    const s2 = afterReload?.segments.find((s) => s.id === 's2')
    check('typed 1:23.456 landed at exactly 83.456s and survived a reload', s2?.start === 83.456, s2?.start)

    // Back into the step for the remaining checks - same session, no re-seed.
    await clickByText(page, '.setup-picker-chip', 'Cuts')
    await page.waitForSelector('.cuts-step')

    // --- Acceptance: adding a cut here does not trigger a tempo scan or block on decoding ---
    await page.evaluate(() => {
      document.querySelector('audio').currentTime = 100
    })
    const beforeCount = await page.locator('.setup-list .setup-card').count()
    const t0 = Date.now()
    await clickByText(page, '.songmap button', 'Cut here')
    const elapsed = Date.now() - t0
    const afterCount = await page.locator('.setup-list .setup-card').count()
    check('a cut was added at the playhead', afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`)
    check('adding a cut did not block on tempo detection', elapsed < 300, `${elapsed}ms`)
    const statusAfterCut = await page.evaluate(async () => (await import('/src/lib/store.ts')).getState().status)
    check('no tempo-detection status was ever set', statusAfterCut !== 'Detecting tempo…', statusAfterCut)

    // --- Acceptance: undo/redo still coalesces per edit (the setup-start-<id> pattern) ---
    const song1Start = page.locator('.setup-list .setup-card').nth(0).locator('.setup-field').nth(0).locator('input')
    await song1Start.fill('0:05.000')
    await song1Start.press('Enter')
    await song1Start.fill('0:09.000')
    await song1Start.press('Enter')
    await page.click('button[title="Undo (Ctrl+Z)"]')
    const afterUndo = await page.evaluate(
      async () => (await import('/src/lib/store.ts')).getState().project.segments.find((s) => s.id === 's1').start,
    )
    check('two quick commits to the same field coalesced into a single undo step', afterUndo === 0, afterUndo)

    check('no console/page errors during the run', pageErrors.length === 0, pageErrors.join(' | '))

    await ctx.close()
  })
  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

/* Regression probe for todo 10: setup step 3 names each song and fits its lyrics
 * inline, one song at a time. Checks that "no lyrics for this one" is a real,
 * persistent answer the SongMap nag respects, that a hand-placed line (no srcTime)
 * never moves when a fit is applied to its own song, and that a pre-todo project
 * with no `noLyrics` field at all still loads and behaves as it always did.
 * Run: node verify/setup-lyrics-probe.cjs [port]
 */
const fs = require('fs')
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, readProject, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`
const SCREENSHOT_DIR = path.join(__dirname, '..', '.for_bepy', 'screenshots', '38708-134330726576022206')
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

const BASE_EXTRAS = { blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 }], moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }], markers: [], people: [], focus: { kind: 'audience' } }

function nagProject() {
  return {
    id: 'lyrics-nag-probe',
    name: 'Nag probe medley',
    audioName: 'probe.wav',
    duration: 200,
    segments: [
      { id: 's1', name: 'Song One', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 }, noLyrics: false },
      { id: 's2', name: 'Song Two', start: 90, bpm: 128, anchor: 90, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 }, noLyrics: false },
    ],
    ...BASE_EXTRAS,
    updatedAt: Date.now(),
  }
}

function fitProject() {
  return {
    id: 'lyrics-fit-probe',
    name: 'Fit probe medley',
    audioName: 'probe.wav',
    duration: 200,
    segments: [{ id: 's1', name: 'Song One', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 }, noLyrics: false }],
    ...BASE_EXTRAS,
    updatedAt: Date.now(),
  }
}

/** No `noLyrics` anywhere on the segment - the exact shape a project saved before this todo has. */
function legacyProject() {
  return {
    id: 'lyrics-legacy-probe',
    name: 'Legacy probe medley',
    audioName: 'probe.wav',
    duration: 120,
    segments: [{ id: 's1', name: 'Song One', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } }],
    ...BASE_EXTRAS,
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
    const pageErrors = []

    // --- Scenario 1: "no lyrics" is a first-class answer the SongMap nag respects ---
    {
      const ctx = await browser.newContext(desktopContext())
      const page = await ctx.newPage()
      page.on('dialog', (d) => d.accept())
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      await seedProject(page, URL, { project: nagProject(), audioBytes: silentWav(200) })

      await clickByText(page, '.setup-picker-chip', 'Lyrics')
      await page.waitForSelector('.lyrics-step')

      // Sanity: before either song is resolved, the sheet still nags - proves the
      // assertion below is testing the fix, not a ribbon that never nags at all.
      await clickByText(page, '.setup-flow-nav button', 'Go to the sheet')
      await page.waitForSelector('.songmap')
      check('before resolving either song, the sheet still shows the lyrics nag', (await page.locator('.ribbon-empty').count()) > 0)

      await clickByText(page, '.setup-picker-chip', 'Lyrics')
      await page.waitForSelector('.lyrics-step')

      // Song One: plain (untimed) lyrics - "given lyrics" without ever leaving the step.
      await page.fill('.lyrics-card textarea', 'Verse one\nVerse two')
      await clickByText(page, 'button', 'Import')
      await page.waitForSelector('.lyric-edit')
      const s1Lines = await page.locator('.lyrics-card .lyric-edit').count()
      check('song one got its pasted lines without leaving the step', s1Lines === 2, s1Lines)

      // Song Two: the one-tap "no lyrics" answer.
      await page.click('.setup-head button[title="Next song"]')
      await page.waitForSelector('.setup-head')
      await clickByText(page, 'button', 'No lyrics for this one')
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'setup-lyrics-no-lyrics.png') })
      const nagged = await page.evaluate(() => document.querySelector('.lyrics-card')?.textContent || '')
      check('marking "no lyrics" shows the resolved state, not a paste box', nagged.includes('Marked as having no lyrics'))

      await page.waitForTimeout(600)
      const afterMark = await readProject(page)
      const s2 = afterMark?.segments.find((s) => s.id === 's2')
      check('the no-lyrics mark persisted to storage', s2?.noLyrics === true, s2?.noLyrics)

      // Re-enter setup (a later pass) and go to the sheet: both songs are now
      // resolved (one has lyrics, none of them timed; the other is marked
      // instrumental) with zero timed lines project-wide - exactly the case
      // that used to nag regardless of intent.
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForSelector('.counts, .drop')
      check('no console/page errors after the reload', pageErrors.length === 0, pageErrors.join(' | '))
      await clickByText(page, '.setup-picker-chip', 'Lyrics')
      await page.waitForSelector('.lyrics-step')
      const reenteredName = await page.locator('.setup-head strong').innerText()
      check('re-entering the step does not require redoing the naming/lyrics work', reenteredName === 'Song One', reenteredName)
      await clickByText(page, '.setup-flow-nav button', 'Go to the sheet')
      await page.waitForSelector('.songmap')
      check('a song marked "no lyrics" does not nag on a later pass through setup', (await page.locator('.ribbon-empty').count()) === 0)

      await ctx.close()
    }

    // --- Scenario 2: a hand-placed line never moves when a fit is applied ---
    {
      const ctx = await browser.newContext(desktopContext())
      const page = await ctx.newPage()
      page.on('dialog', (d) => d.accept())
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      await seedProject(page, URL, { project: fitProject(), audioBytes: silentWav(200) })

      await clickByText(page, '.setup-picker-chip', 'Lyrics')
      await page.waitForSelector('.lyrics-step')

      await page.fill('.lyrics-card textarea', '[00:10.00]Line A\n[00:20.00]Line B\n[00:30.00]Line C')
      await clickByText(page, 'button', 'Import')
      await page.waitForSelector('.lyric-edit')
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'setup-lyrics-with-lyrics.png') })

      // A hand-placed line at the playhead - no srcTime, so a fit must never touch it.
      await page.evaluate(() => {
        document.querySelector('audio').currentTime = 5
      })
      await clickByText(page, 'button', 'Add line at playhead')
      await page.waitForSelector('.fit-panel')

      // Two-tap calibration: srcTime 10 -> played at 12s, srcTime 30 -> played at 34s.
      const calibratableRows = page.locator('.fit-panel .lyric-edit')
      await page.evaluate(() => {
        document.querySelector('audio').currentTime = 12
      })
      await calibratableRows.nth(0).locator('button[title="Tap when this line lands"]').click()
      await page.evaluate(() => {
        document.querySelector('audio').currentTime = 34
      })
      await calibratableRows.nth(2).locator('button[title="Tap when this line lands"]').click()
      await page.waitForSelector('text=Apply fit')
      await clickByText(page, 'button', 'Apply fit')

      await page.waitForTimeout(600)
      const afterFit = await readProject(page)
      const seg = afterFit?.segments.find((s) => s.id === 's1')
      const handPlaced = seg?.lyrics.find((l) => l.srcTime === undefined)
      const lineA = seg?.lyrics.find((l) => l.srcTime === 10)
      const lineC = seg?.lyrics.find((l) => l.srcTime === 30)
      check('the hand-placed line kept its exact time after the fit', handPlaced?.time === 5, handPlaced?.time)
      check('a synced line the fit was calibrated on landed exactly on its tap', lineA?.time === 12, lineA?.time)
      check('the other calibration point also landed exactly', lineC?.time === 34, lineC?.time)
      check('the segment fit itself was recorded (scale != 1 default)', seg?.fit.scale !== 1, seg?.fit)
      check('no console/page errors during the fit flow', pageErrors.length === 0, pageErrors.join(' | '))

      await ctx.close()
    }

    // --- Scenario 3: backward compatibility - a segment with no `noLyrics` field at all ---
    {
      const ctx = await browser.newContext(desktopContext())
      const page = await ctx.newPage()
      page.on('dialog', (d) => d.accept())
      const legacyErrors = []
      page.on('pageerror', (e) => legacyErrors.push(String(e)))
      await seedProject(page, URL, { project: legacyProject(), audioBytes: silentWav(120) })

      check('a project whose segment predates `noLyrics` loads without crashing', legacyErrors.length === 0, legacyErrors.join(' | '))

      // The migrator backfills the field on load; read it straight from storage
      // rather than only trusting the UI, since a stale in-memory default could
      // mask a migration that never actually ran.
      await page.waitForTimeout(600)
      const migrated = await readProject(page)
      const legacySeg = migrated?.segments.find((s) => s.id === 's1')
      check('migrateProject backfilled noLyrics to false, not left undefined', legacySeg?.noLyrics === false, legacySeg?.noLyrics)

      // A block is seeded so App.tsx routes straight to the sheet, no setup detour needed.
      await page.waitForSelector('.songmap')
      check('a legacy project with real unvisited songs still nags as before (default does not silently hide real work)', (await page.locator('.ribbon-empty').count()) > 0)

      await ctx.close()
    }
  })
  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

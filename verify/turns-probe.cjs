/* Move shapes and turns on the floor. The point of the probe is the distinction that is
   easy to get wrong and impossible to see in a screenshot: a HALF turn leaves a facing
   behind and has to be chased until something undoes it, a FULL turn passes through the
   same angles and leaves nothing. Both are checked at the same instant, off one seeded
   choreography, so a regression that collapses them into one behaviour cannot pass.
   Run: node verify/turns-probe.cjs [port] */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')
const path = require('path')
const fs = require('fs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', process.env.CLAUDE_CODE_SESSION_ID || 'turns')

/* 120 BPM, so one count is half a second and every seek below lands on a whole count
   rather than between two. Ana half-turns on counts 1-2, dances ten counts facing away,
   and clears it on 13-14. Mia full-turns on counts 1-4 from the same start. */
const BEAT = 0.5
const at = (count) => count * BEAT

const person = (id, name, initials, colour) => ({ id, name, initials, colour })
const stand = (personId, col, row) => ({ id: `mv-${personId}`, personId, segmentId: 's1', beat: 0, travel: 0, to: { col, row } })
const block = (id, moveId, startBeat, beats, forWhom) => ({ id, segmentId: 's1', moveId, startBeat, beats, for: [forWhom] })

const PROJECT = {
  id: 'turns1',
  name: 'Turns probe',
  audioName: 'probe.wav',
  duration: 60,
  segments: [
    { id: 's1', name: 'I Will Survive', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  moves: [
    { id: 'half-turn', name: 'Half turn', beats: 2, energy: 2, turn: 180 },
    { id: 'turn-360', name: 'Full turn', beats: 4, energy: 3, turn: 360 },
    { id: 'body-roll', name: 'Body roll', beats: 4, energy: 2, shape: 'sway' },
    { id: 'step-touch', name: 'Step touch', beats: 2, energy: 1, shape: 'step' },
  ],
  blocks: [
    block('a1', 'half-turn', 0, 2, 'p-ana'),
    block('a2', 'body-roll', 2, 4, 'p-ana'),
    block('a3', 'body-roll', 6, 4, 'p-ana'),
    block('a4', 'step-touch', 10, 2, 'p-ana'),
    block('a5', 'half-turn', 12, 2, 'p-ana'),
    block('a6', 'step-touch', 14, 2, 'p-ana'),
    block('m1', 'turn-360', 0, 4, 'p-mia'),
    block('m2', 'step-touch', 4, 2, 'p-mia'),
    block('i1', 'body-roll', 0, 4, 'p-ivan'),
    block('i2', 'body-roll', 4, 4, 'p-ivan'),
  ],
  markers: [],
  people: [person('p-ana', 'Ana', 'AN', '#7c5cff'), person('p-mia', 'Mia', 'MI', '#3fb8b0'), person('p-ivan', 'Ivan', 'IV', '#f0a63c')],
  groups: [],
  movements: [stand('p-ana', 5, 2), stand('p-mia', 3, 3), stand('p-ivan', 7, 3)],
  takes: [],
  clips: [],
  updatedAt: Date.now(),
}

const seek = async (page, time) => {
  await page.evaluate((t) => (document.querySelector('audio').currentTime = t), time)
  await page.waitForTimeout(220)
}

/** The angle a puck is actually drawn at, read off the composited matrix rather than
 *  off the inline string, so a rule that overrode it would still be caught. */
const facingOf = (page, name) =>
  page.evaluate((who) => {
    const puck = [...document.querySelectorAll('.stage .puck')].find((p) => p.querySelector('.nm')?.textContent === who)
    if (!puck) return null
    const m = getComputedStyle(puck.querySelector('.turner')).transform
    const n = m === 'none' ? [1, 0] : m.slice(m.indexOf('(') + 1).split(',').map(Number)
    return {
      deg: ((Math.round((Math.atan2(n[1], n[0]) * 180) / Math.PI) % 360) + 360) % 360,
      away: puck.classList.contains('facing-away'),
      shape: getComputedStyle(puck.querySelector('.disc')).animationName,
      duration: getComputedStyle(puck.querySelector('.disc')).animationDuration,
    }
  }, name)

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })
    await page.click('.appbar button[title^="Floor"]')
    await page.waitForSelector('.floor-view .stage .puck')

    // Count 2 of a 2-count half turn: Ana is halfway round. The angle must already be
    // moving, and she must NOT be flagged yet - a full turn passes through here too, and
    // flagging mid-turn would light every Turn 360 in the medley amber on its way past.
    await seek(page, at(1))
    const anaMid = await facingOf(page, 'Ana')
    const miaMid = await facingOf(page, 'Mia')
    check('a turn in progress is interpolated, not snapped', anaMid.deg > 60 && anaMid.deg < 120, `Ana ${anaMid.deg}deg`)
    check('nobody is flagged mid-turn, so a full turn never flashes on its way round', !anaMid.away && !miaMid.away)
    // Count 2 is inside the half turn itself, which carries a turn and no shape.
    check('a move that carries only a turn draws no shape', anaMid.shape === 'none', anaMid.shape)

    // Count 6: Ana has landed backwards, Mia has come all the way round from the same start.
    await seek(page, at(5.4))
    const ana = await facingOf(page, 'Ana')
    const mia = await facingOf(page, 'Mia')
    const ivan = await facingOf(page, 'Ivan')
    check('a landed half turn holds the dancer at 180 long after its own counts', ana.deg === 180, `Ana ${ana.deg}deg`)
    check('and is flagged as owing a turn back', ana.away)
    check('a full turn from the same start lands back on 0', mia.deg === 0, `Mia ${mia.deg}deg`)
    check('and is never flagged, because it left nothing behind', !mia.away)
    check('a dancer who never turns stays where they started', ivan.deg === 0 && !ivan.away, `Ivan ${ivan.deg}deg`)

    // A shape is a real running animation timed off the segment's own tempo: a 2-count
    // sway at 120 BPM is a one-second cycle, and would be wrong at any other BPM.
    check('the shape runs as a keyframe animation on the puck', ivan.shape === 'mv-sway', ivan.shape)
    check('and its cycle comes from the song tempo, not a constant', ivan.duration === '1s', ivan.duration)

    const chip = await page.textContent('.appbar .chip.warn').catch(() => null)
    check('the bar names exactly who is still facing away', chip?.includes('Ana') && !chip.includes('Mia'), chip)
    check('the cast rail badges the same person', (await page.locator('.rail-person .turn-owed').count()) === 1)
    check(
      'the rail says what they are dancing rather than just "on"',
      (await page.locator('.rail-person').first().locator('.st').textContent()) === 'Body roll',
      await page.locator('.rail-person').first().locator('.st').textContent(),
    )
    await page.screenshot({ path: path.join(SHOTS, 'turns-1-facing-away.png') })

    // The timeline has to show the debt across the whole number, not only under the
    // playhead, or it is found in performance rather than in planning.
    const awayRuns = await page.evaluate(() =>
      [...document.querySelectorAll('.mv-lane')].map((l) => ({
        who: l.querySelector('.mv-who .nm')?.textContent,
        away: l.querySelectorAll('.mv-away').length,
      })),
    )
    check(
      'the timeline draws the facing-away stretch in the dancer own lane',
      awayRuns.find((l) => l.who === 'Ana')?.away === 1 && awayRuns.find((l) => l.who === 'Ivan')?.away === 0,
      JSON.stringify(awayRuns),
    )

    // Count 15, one count after the second half turn lands: the debt is paid.
    await seek(page, at(14.4))
    const cleared = await facingOf(page, 'Ana')
    check('a second half turn brings them round and clears the flag', cleared.deg === 0 && !cleared.away, `${cleared.deg}deg away=${cleared.away}`)
    check('and the warning leaves the bar with it', (await page.locator('.appbar .chip.warn').count()) === 0)
    await page.screenshot({ path: path.join(SHOTS, 'turns-2-cleared.png') })

    // The Animate toggle exists so a puck can be made to hold still for a drag.
    await page.click('.appbar button[aria-label="Toggle move animations"]')
    await seek(page, at(5.4))
    const off = await facingOf(page, 'Ana')
    check('turning the figures off stops the shape and squares the puck up', off.deg === 0 && off.shape === 'none' && !off.away)
    await page.click('.appbar button[aria-label="Toggle move animations"]')

    // The dancer's own half of the same warning, on the screen they actually read.
    await seek(page, at(5.4))
    await page.click('.appbar button[title*="full screen"]')
    await page.waitForSelector('.rehearse')
    await page.click('.view-as')
    await page.waitForSelector('.view-as-menu')
    await page.evaluate(() => {
      const menu = document.querySelector('.view-as-menu')
      ;[...menu.querySelectorAll('.cast-opt')].find((b) => b.textContent.includes('Ana'))?.click()
    })
    await page.waitForTimeout(250)
    const owed = await page.textContent('.rehearse-owed')
    check('rehearse tells the dancer they are backwards and what fixes it', owed?.includes('facing away') && owed.includes('half turn'), owed)
    await page.screenshot({ path: path.join(SHOTS, 'turns-3-rehearse-as-ana.png') })

    check('no console or page errors across the run', errors.length === 0, errors.join(' | '))
    await context.close()
  })
  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

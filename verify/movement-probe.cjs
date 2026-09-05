/* Rehearse runway + floor mini-map. Uses verify/harness.cjs.
   Run: node verify/movement-probe.cjs [port]   (dev server must be up) */
const path = require('path')
const { withBrowser, desktopContext, phoneContext, seedProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')
const { PROJECT } = require('./fixtures.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const { check, report } = createChecklist()
const dir = screenshotDir('movement')

/* s1 is 117bpm anchored at 0, so beat 9 sits inside the Grapevine block (8-12). */
const BEAT_SECONDS = 60 / 117
const AT_BEAT = (b) => b * BEAT_SECONDS

/* Cast for the mini-map, in the native people+movements shape (precedent:
   verify/chair-probe.cjs, verify/floor-probe.cjs). Ana and Jo are already on the
   floor from beat 0 and reposition at beat 8 with travel 0, so both have settled by
   beat 9. Mia's only movement arrives at beat 12 with travel 4 (departs beat 8), so
   at beat 9 she is a quarter of the way in - the one dancer readFloor() must find
   still walking. At beat 16 Jo and Mia both walk off (to: null) and Ana moves again,
   leaving her alone on the floor by beat 17 - offstage is derived from that exit
   movement, never a stored formation. */
const CAST = {
  ...PROJECT,
  people: [
    { id: 'an', name: 'Ana', initials: 'AN', colour: '#3fb8b0' },
    { id: 'jo', name: 'Joe', initials: 'JO', colour: '#7c5cff' },
    { id: 'mi', name: 'Mia', initials: 'MI', colour: '#ff5d8f' },
  ],
  movements: [
    { id: 'm-an1', segmentId: 's1', personId: 'an', beat: 0, travel: 0, to: { col: 3, row: 4 } },
    { id: 'm-jo1', segmentId: 's1', personId: 'jo', beat: 0, travel: 0, to: { col: 7, row: 4 } },
    { id: 'm-an2', segmentId: 's1', personId: 'an', beat: 8, travel: 0, to: { col: 3, row: 3 } },
    { id: 'm-jo2', segmentId: 's1', personId: 'jo', beat: 8, travel: 0, to: { col: 5, row: 5 } },
    { id: 'm-mi1', segmentId: 's1', personId: 'mi', beat: 12, travel: 4, to: { col: 7, row: 3 } },
    { id: 'm-an3', segmentId: 's1', personId: 'an', beat: 16, travel: 0, to: { col: 5, row: 2 } },
    { id: 'm-jo3', segmentId: 's1', personId: 'jo', beat: 16, travel: 0, to: null },
    { id: 'm-mi2', segmentId: 's1', personId: 'mi', beat: 16, travel: 0, to: null },
  ],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'person', name: 'Marta', col: 5, row: 6 },
}

async function openRehearse(page) {
  await page.waitForSelector('.sheet, .songstrip', { timeout: 15000 })
  await page.keyboard.press('r')
  await page.waitForSelector('.rehearse .runway', { timeout: 15000 })
}

async function seekTo(page, seconds) {
  await page.evaluate((s) => {
    document.querySelector('audio').currentTime = s
  }, seconds)
  await page.waitForTimeout(180)
}

/** Fresh context per scenario. Pages in one context share IndexedDB, and a live page
 *  flushes stale state on the next reload, which deadlocks a second seed. */
async function withSeeded(browser, ctxOpts, project, fn) {
  const ctx = await browser.newContext(ctxOpts)
  try {
    const page = await ctx.newPage()
    await seedProject(page, URL, { project, audioBytes: silentWav(60) })
    await openRehearse(page)
    return await fn(page)
  } finally {
    await ctx.close()
  }
}

function readRunway() {
  const move = document.querySelector('.rehearse-move')
  const moveBox = move.getBoundingClientRect()
  const pulse = document.querySelector('.rehearse .pulse').getBoundingClientRect()
  const cs = getComputedStyle(document.querySelector('.runway'))
  const lane = document.querySelector('.rw-lane').getBoundingClientRect()
  const head = document.querySelector('.rw-head').getBoundingClientRect()
  const bars = [...document.querySelectorAll('.rw-bar')].map((b) => {
    const r = b.getBoundingClientRect()
    const nr = b.querySelector('.rw-name').getBoundingClientRect()
    return {
      cls: b.className,
      text: b.querySelector('.rw-name').textContent,
      left: Math.round(r.left - lane.left),
      width: Math.round(r.width),
      spent: Math.round(b.querySelector('.rw-spent').getBoundingClientRect().width),
      lw: b.style.getPropertyValue('--lw'),
      nameLeftRelHead: Math.round(nr.left - head.right),
      nameOnScreen: nr.left >= lane.left - 1 && nr.right <= lane.right + 1,
    }
  })
  return {
    ppb: cs.getPropertyValue('--ppb').trim(),
    headVar: cs.getPropertyValue('--head').trim(),
    headOffset: Math.round(head.left - lane.left),
    numCount: document.querySelectorAll('.rw-num').length,
    oneCount: document.querySelectorAll('.rw-num.one').length,
    lyricCount: document.querySelectorAll('.rw-lyric').length,
    bars,
    laneW: Math.round(lane.width),
    bodyText: document.querySelector('.rehearse').innerText,
    imgs: document.querySelectorAll('.rehearse img').length,
    dots: document.querySelectorAll('.rehearse .pulse i').length,
    moveName: move.textContent,
    /* Joe, 2026-09-03: "the letters are over the dots, and the letters are too big too" */
    moveFs: Math.round(parseFloat(getComputedStyle(move).fontSize)),
    dotGap: Math.round(pulse.top - moveBox.bottom),
  }
}

function readFloor() {
  const stage = document.querySelector('.rehearse .stage')
  if (!stage) return { present: false }
  const sr = stage.getBoundingClientRect()
  const pucks = [...document.querySelectorAll('.rehearse .puck')].map((p) => ({
    who: p.querySelector('.disc').textContent,
    // src/components/FloorStage.tsx: `entering` was renamed `walking` when the
    // formation model gave way to per-person movements (3db88e7).
    walking: p.classList.contains('walking'),
    box: p.getBoundingClientRect(),
  }))
  const focus = document.querySelector('.rehearse .stage-focus')
  const fr = focus && focus.getBoundingClientRect()
  const move = document.querySelector('.rehearse-centre').getBoundingClientRect()
  const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const collisions = []
  for (let i = 0; i < pucks.length; i++) {
    if (fr && hits(pucks[i].box, fr)) collisions.push(`${pucks[i].who}/chair`)
    for (let j = i + 1; j < pucks.length; j++) {
      if (hits(pucks[i].box, pucks[j].box)) collisions.push(`${pucks[i].who}/${pucks[j].who}`)
    }
  }
  return {
    present: true,
    // Formations (and their names) are gone; this label is now the "who is walking"
    // caption Rehearse.tsx derives live from standingAt(), not a stored formation name.
    walkingLabel: document.querySelector('.rehearse-floor-name').textContent,
    stageW: Math.round(sr.width),
    ratio: +(sr.width / sr.height).toFixed(2),
    cells: document.querySelectorAll('.rehearse .stage-grid span').length,
    staticMode: stage.classList.contains('static'),
    pucks: pucks.map((p) => ({ who: p.who, walking: p.walking })),
    collisions,
    focusName: focus ? focus.querySelector('span').textContent : null,
    focusRowPct: fr ? Math.round(((fr.top + fr.height / 2 - sr.top) / sr.height) * 100) : null,
    floorLeftOfMove: sr.right <= move.left,
    floorCx: Math.round(sr.left + sr.width / 2),
    moveCx: Math.round(move.left + move.width / 2),
    frameCx: Math.round(window.innerWidth / 2),
  }
}

const dx = (s) => Number(s.split(',')[4])
const transform = () => getComputedStyle(document.querySelector('.rw-lane .rw-scroll')).transform

withBrowser(async (browser) => {
  /* ---------- desktop runway ---------- */
  await withSeeded(browser, desktopContext(), PROJECT, async (page) => {
    await seekTo(page, AT_BEAT(9))
    const d = await page.evaluate(readRunway)

    check('desktop uses the wide geometry', d.ppb === '42px' && d.headVar === '96px', `${d.ppb} / ${d.headVar}`)
    check('playhead sits at --head', d.headOffset === 96, `offset=${d.headOffset}`)
    check('one bar per block', d.bars.length === PROJECT.blocks.length, `${d.bars.length} bars`)
    check(
      'energy colours map from the move',
      d.bars.map((b) => b.cls.replace('rw-bar ', '')).join(',') === 'e1,e1,e2,e3',
      d.bars.map((b) => `${b.text}:${b.cls.replace('rw-bar ', '')}`).join(' '),
    )
    check('count ruler covers the segment', d.numCount > 200 && d.oneCount === Math.ceil(d.numCount / 8), `${d.numCount} counts, ${d.oneCount} downbeats`)
    check('lyric lane rendered', d.lyricCount === 3, `${d.lyricCount} lines`)
    check('"Next: X in N" is gone', !d.bodyText.includes('Next:'))
    check('no clip thumbnail in the rehearse view', d.imgs === 0, `${d.imgs} img elements`)
    check('count dots kept', d.dots === 8, `${d.dots} dots`)
    check('desktop move name is not oversized', d.moveFs === 84, `${d.moveFs}px (was 128)`)
    check('letters clear the dots', d.dotGap > 0, `${d.dotGap}px between the name box and the dots`)

    const active = d.bars.find((b) => b.text === 'Grapevine')
    check('block under the playhead is the current move', d.moveName === 'Grapevine', `centre says "${d.moveName}"`)
    check('active bar has drained', active.spent > 0 && active.spent < active.width, `spent=${active.spent}/${active.width}`)
    check('--lw measured for the pin cap', Number(active.lw) > 0, `--lw=${active.lw}`)
    check('active label pinned right of the playhead', active.nameLeftRelHead >= 0, `${active.nameLeftRelHead}px past head`)
    check('active label fully on screen', active.nameOnScreen === true)

    const future = d.bars.find((b) => b.text === 'Body roll')
    check('future bar has not drained', future.spent === 0, `spent=${future.spent}`)
    check('future bar sits right of the playhead', future.left > d.headOffset, `left=${future.left} head=${d.headOffset}`)

    await page.screenshot({ path: path.join(dir, 'desktop-runway.png') })

    await seekTo(page, AT_BEAT(0))
    const t0 = await page.evaluate(transform)
    await seekTo(page, AT_BEAT(16))
    const t16 = await page.evaluate(transform)
    check('lane scrolls with the clock', t0 !== t16, `${t0} -> ${t16}`)
    check('scroll distance matches 16 counts at 42px', Math.abs(dx(t0) - dx(t16) - 672) < 1.5, `moved ${Math.round(dx(t0) - dx(t16))}px`)
  })

  /* ---------- phone runway ---------- */
  await withSeeded(browser, phoneContext(), PROJECT, async (page) => {
    await seekTo(page, AT_BEAT(9))
    const p = await page.evaluate(readRunway)
    check('phone uses the narrow geometry', p.ppb === '30px' && p.headVar === '60px', `${p.ppb} / ${p.headVar}`)
    check('phone playhead sits at --head', p.headOffset === 60, `offset=${p.headOffset}`)
    check('phone runway fits the 393px stage', p.laneW <= 393, `lane=${p.laneW}px`)
    const pActive = p.bars.find((b) => b.text === 'Grapevine')
    check(
      'phone: short bar name still clears the playhead',
      pActive.nameLeftRelHead >= 0,
      `${pActive.nameLeftRelHead}px past head (bar ${pActive.width}px, --lw=${pActive.lw})`,
    )
    check('phone: name stays inside its bar', pActive.nameOnScreen === true)
    check('phone: letters clear the dots', p.dotGap > 0, `${p.dotGap}px gap, name at ${p.moveFs}px`)
    await page.screenshot({ path: path.join(dir, 'phone-runway.png') })
  })

  /* ---------- desktop floor mini-map ---------- */
  await withSeeded(browser, desktopContext(), CAST, async (page) => {
    await seekTo(page, AT_BEAT(9))
    const f = await page.evaluate(readFloor)
    check('floor mini-map renders', f.present === true)
    check('grid is 11 x 7 from floor.ts, not the mockup 12 x 8', f.cells === 77 && f.ratio === 1.57, `${f.cells} cells, ratio ${f.ratio}`)
    check('read-only on this screen', f.staticMode === true)
    check('only the on-floor cast is drawn', f.pucks.map((p) => p.who).sort().join(',') === 'AN,JO,MI', f.pucks.map((p) => p.who).join(','))
    check(
      'the dancer walking on is ringed, and only her',
      f.pucks.filter((p) => p.walking).map((p) => p.who).join(',') === 'MI',
      f.pucks.map((p) => `${p.who}:${p.walking}`).join(' '),
    )
    check('chair rendered at the front row', f.focusName === 'Marta' && f.focusRowPct > 80, `${f.focusName} at ${f.focusRowPct}% down`)
    check('nothing on the floor overlaps anything else', f.collisions.length === 0, f.collisions.join(' '))
    check('desktop stacks the floor above the move name, not beside it', f.floorLeftOfMove === false)
    check('floor and move name share the screen centre line', Math.abs(f.floorCx - f.moveCx) <= 1 && Math.abs(f.floorCx - f.frameCx) <= 1, `floor ${f.floorCx}, name ${f.moveCx}, frame ${f.frameCx}`)
    check('mini-map is scaled down, not page-sized', f.stageW === 340, `${f.stageW}px`)
    await page.screenshot({ path: path.join(dir, 'desktop-runway-formation.png') })

    await seekTo(page, AT_BEAT(17))
    const f3 = await page.evaluate(readFloor)
    check('offstage is derived, not stored', f3.pucks.map((p) => p.who).join(',') === 'AN', f3.pucks.map((p) => p.who).join(','))
  })

  /* ---------- phone floor mini-map ---------- */
  await withSeeded(browser, phoneContext(), CAST, async (page) => {
    await seekTo(page, AT_BEAT(9))
    const pf = await page.evaluate(readFloor)
    check('phone stacks the floor above the move name', pf.floorLeftOfMove === false)
    check('phone: floor and move name share the centre line', Math.abs(pf.floorCx - pf.moveCx) <= 1, `floor ${pf.floorCx}, name ${pf.moveCx}`)
    check('phone mini-map fits the 393px stage', pf.stageW === 288, `${pf.stageW}px`)
    check('phone: nothing on the floor overlaps anything else', pf.collisions.length === 0, pf.collisions.join(' '))
    await page.screenshot({ path: path.join(dir, 'phone-runway-formation.png') })
  })

  /* ---------- a project with no cast must not park an empty grid on screen ---------- */
  await withSeeded(browser, desktopContext(), PROJECT, async (page) => {
    const none = await page.evaluate(() => ({
      stage: document.querySelectorAll('.rehearse .stage').length,
      floorName: document.querySelectorAll('.rehearse-floor-name').length,
      runway: document.querySelectorAll('.runway').length,
    }))
    check('no cast means no empty floor', none.stage === 0 && none.floorName === 0, JSON.stringify(none))
    check('runway still renders without a cast', none.runway === 1)
  })

  console.log('\nscreenshots ->', dir)
  report()
}).catch((e) => {
  console.error(e)
  process.exitCode = 1
})

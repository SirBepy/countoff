/* Phone reproduction probe: real touch input via CDP, so touch-action and native
   scrolling actually apply. Run: node verify/mobile-probe.cjs [port] [label] */
const path = require('path')
const { withBrowser, phoneContext, seedProject, silentWav, screenshotDir } = require('./harness.cjs')
const { PROJECT } = require('./fixtures.cjs')

const PORT = process.argv[2] || '42001'
const LABEL = process.argv[3] || 'after'
const URL = `http://localhost:${PORT}`
const SHOTS = screenshotDir('mobile-probe')

async function main() {
  const findings = []
  const ok = []
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(phoneContext())
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(1) })

    const cdp = await ctx.newCDPSession(page)
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${LABEL}-${name}.png`) })

    // Each point carries an id, or Chrome treats successive moves as different
    // fingers and never resolves the gesture into a scroll.
    const finger = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }]
    async function stroke(x, y, dx, dy, steps, settle) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(x, y) })
      await page.waitForTimeout(24)
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: finger(x + (dx * i) / steps, y + (dy * i) / steps) })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(settle)
    }
    const swipe = (x, y, dy, steps = 12) => stroke(x, y, 0, dy, steps, 500)
    const dragH = (x, y, dx, steps = 12) => stroke(x, y, dx, 0, steps, 350)
    const tap = async (x, y) => {
      await page.touchscreen.tap(x, y)
      await page.waitForTimeout(350)
    }
    const reset = async () => {
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      await page.evaluate(() => {
        window.getSelection().removeAllRanges()
        document.querySelector('.main .scroll').scrollTop = 0
      })
      // Chrome eats the first tap that lands while a fling is still settling, on a
      // real phone as much as here, so let the scroller come to rest first.
      await page.waitForTimeout(700)
    }

    const state = () =>
      page.evaluate(() => ({
        scrollTop: Math.round(document.querySelector('.main .scroll').scrollTop),
        selected: document.querySelectorAll('.count-cell.sel').length,
        textSel: (window.getSelection() || '').toString().slice(0, 40),
        blockLefts: [...document.querySelectorAll('.block')].map((b) => b.style.left),
      }))

    /** A point inside `sel` that actually hit-tests to it, so a probe can never
     *  report an app bug when it really tapped a sticky header or a block. */
    const hitPoint = (sel, n = 0) =>
      page.evaluate(
        ({ sel, n }) => {
          const e = document.querySelectorAll(sel)[n]
          if (!e) return null
          const b = e.getBoundingClientRect()
          const x = Math.round(b.left + b.width / 2)
          const y = Math.round(b.top + b.height / 2)
          const hit = document.elementFromPoint(x, y)
          return hit && e.contains(hit) ? { x, y } : null
        },
        { sel, n },
      )

    const centre = (sel, n = 0) =>
      page.evaluate(
        ({ sel, n }) => {
          const e = document.querySelectorAll(sel)[n]
          if (!e) return null
          const b = e.getBoundingClientRect()
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
        },
        { sel, n },
      )

    console.log('== 1. vertical swipe on the counts grid')
    await reset()
    const grid = await centre('.counts', 1)
    let a = await state()
    await swipe(grid.x, grid.y, -240)
    let b = await state()
    console.log('  scrollTop', a.scrollTop, '->', b.scrollTop, '| selected', b.selected)
    if (b.scrollTop - a.scrollTop < 60) findings.push(`swipe on .counts scrolled only ${b.scrollTop - a.scrollTop}px`)
    else ok.push(`swipe on .counts scrolls ${b.scrollTop - a.scrollTop}px`)
    if (b.selected) findings.push(`swipe on .counts selected ${b.selected} counts`)
    else ok.push('swipe on .counts selects nothing')

    console.log('== 2. vertical swipe on a lyric line')
    await reset()
    const lyr = await page.evaluate(() => {
      for (const e of document.querySelectorAll('.row-lyric')) {
        const b = e.getBoundingClientRect()
        if (!e.textContent.trim() || b.height < 6) continue
        const x = Math.round(b.left + 40)
        const y = Math.round(b.top + b.height / 2)
        const hit = document.elementFromPoint(x, y)
        if (hit && e.contains(hit)) return { x, y }
      }
      return null
    })
    if (lyr) {
      a = await state()
      await swipe(lyr.x, lyr.y, -240)
      b = await state()
      console.log('  scrollTop', a.scrollTop, '->', b.scrollTop, '| textSel', JSON.stringify(b.textSel))
      if (b.scrollTop - a.scrollTop < 60) findings.push(`swipe on .row-lyric scrolled only ${b.scrollTop - a.scrollTop}px`)
      else ok.push(`swipe on a lyric scrolls ${b.scrollTop - a.scrollTop}px`)
      if (b.textSel) findings.push(`swipe on .row-lyric selected text "${b.textSel}"`)
      else ok.push('swipe on a lyric selects no text')
    } else findings.push('no hit-testable lyric line found')

    console.log('== 3. vertical swipe starting on a block')
    await reset()
    const blk = await centre('.block', 2)
    if (blk) {
      a = await state()
      await swipe(blk.x, blk.y, -240)
      b = await state()
      const moved = JSON.stringify(a.blockLefts) !== JSON.stringify(b.blockLefts)
      console.log('  scrollTop', a.scrollTop, '->', b.scrollTop, '| block moved', moved)
      if (b.scrollTop - a.scrollTop < 60) findings.push(`swipe on a .block scrolled only ${b.scrollTop - a.scrollTop}px`)
      else ok.push(`swipe on a block scrolls ${b.scrollTop - a.scrollTop}px`)
      if (moved) findings.push('swipe on a .block dragged it')
      else ok.push('swipe on a block does not drag it')
    }

    console.log('== 4. tap an empty count, then drag sideways to extend')
    await reset()
    const g0 = await page.evaluate(() => {
      for (const el of document.querySelectorAll('.counts')) {
        if (el.querySelector('.block') || el.querySelector('.count-marker')) continue
        const b = el.getBoundingClientRect()
        if (b.top < 140 || b.bottom > window.innerHeight - 120) continue
        const x = Math.round(b.left + b.width * 0.19)
        const y = Math.round(b.top + b.height / 2)
        const hit = document.elementFromPoint(x, y)
        if (hit && el.contains(hit)) return { x, y, w: Math.round(b.width) }
      }
      return null
    })
    if (!g0) findings.push('no empty counts row was hit-testable')
    else {
      await tap(g0.x, g0.y)
      const s1 = await state()
      console.log('  after tap, selected =', s1.selected)
      if (s1.selected !== 1) findings.push(`tapping a count selected ${s1.selected} counts, expected 1`)
      else ok.push('tap selects exactly one count')
      await dragH(g0.x, g0.y, Math.round(g0.w * 0.4))
      const s2 = await state()
      console.log('  after sideways drag, selected =', s2.selected)
      if (s2.selected < 3) findings.push(`sideways drag extended to ${s2.selected} counts, expected 4+`)
      else ok.push(`sideways drag extends the selection to ${s2.selected} counts`)
    }

    console.log('== 5. tap a row number to take the whole 8')
    await reset()
    const rn = await page.evaluate(() => {
      for (const e of document.querySelectorAll('.row-no')) {
        const b = e.getBoundingClientRect()
        if (b.top < 120 || b.bottom > window.innerHeight - 120) continue
        const x = Math.round(b.left + b.width / 2)
        const y = Math.round(b.top + b.height / 2)
        const hit = document.elementFromPoint(x, y)
        if (hit && e.contains(hit)) return { x, y, text: e.textContent }
      }
      return null
    })
    console.log('  row number:', JSON.stringify(rn))
    if (!rn) findings.push('no row number was hit-testable')
    else {
      await tap(rn.x, rn.y)
      const s3 = await state()
      console.log('  selected =', s3.selected)
      if (s3.selected < 8) findings.push(`row-number tap selected ${s3.selected}, expected 8`)
      else ok.push('row-number tap selects the whole 8')
    }

    console.log('== 6. bar geometry with a selection up')
    const g = await page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }
      }
      const fill = document.querySelector('.bar-fill')
      const fb = fill && fill.getBoundingClientRect()
      const hit = fb && document.elementFromPoint(Math.round(fb.left + fb.width / 2), Math.round(fb.top + fb.height / 2))
      const name = document.querySelector('.app-title .name')
      return {
        vh: window.innerHeight,
        vw: window.innerWidth,
        docScrollW: document.documentElement.scrollWidth,
        appbar: r('.appbar'),
        strip: r('.songstrip'),
        body: r('.body'),
        bar: r('.bar'),
        songmapMounted: !!document.querySelector('.songmap'),
        fill: fb ? { top: Math.round(fb.top), bottom: Math.round(fb.bottom), w: Math.round(fb.width), label: fill.textContent.trim() } : null,
        fillReachable: !!(fill && hit && fill.contains(hit)),
        nameFull: name ? name.scrollWidth <= name.clientWidth + 1 : null,
        nameText: name ? name.textContent : null,
      }
    })
    console.log(' ', JSON.stringify(g, null, 1))
    if (g.docScrollW > g.vw + 2) findings.push(`page is ${g.docScrollW}px wide in a ${g.vw}px viewport`)
    else ok.push(`layout fits ${g.vw}px exactly`)
    for (const [k, v] of Object.entries(g)) {
      if (v && typeof v === 'object' && 'w' in v && v.w > g.vw + 1) findings.push(`.${k} is ${v.w}px wide, clipped at ${g.vw}px`)
    }
    if (!g.bar || g.bar.bottom > g.vh + 1) findings.push(`bottom bar ends at ${g.bar && g.bar.bottom}px, past the ${g.vh}px viewport`)
    else ok.push(`bottom bar sits fully on screen (${g.bar.top}-${g.bar.bottom} of ${g.vh})`)
    if (!g.fillReachable) findings.push('the fill-with-a-move button is covered or missing')
    else ok.push(`"${g.fill.label}" is on screen and hit-testable`)
    if (g.songmapMounted) findings.push('the song map is still mounted on a phone')
    else ok.push('song map not mounted on a phone')
    if (g.nameFull === false) findings.push(`project name truncates: "${g.nameText}"`)
    else ok.push(`project name shows in full: "${g.nameText}"`)
    if (g.body) ok.push(`sheet gets ${g.body.h}px of ${g.vh}px`)
    await shot('selection')

    console.log('== 7. move sheet, against a selection a move fits exactly')
    if (g0) {
      await reset()
      await tap(g0.x, g0.y)
      await dragH(g0.x, g0.y, Math.round(g0.w * 0.4))
    }
    await page.evaluate(() => {
      const b = document.querySelector('.bar-fill')
      b && b.click()
    })
    await page.waitForTimeout(600)
    const rail = await page.evaluate(() => {
      const add = document.querySelector('.rail .panel-head button[title*="Add"]')
      const r = document.querySelector('.rail').getBoundingClientRect()
      const ab = add && add.getBoundingClientRect()
      const hit = ab && document.elementFromPoint(Math.round(ab.left + ab.width / 2), Math.round(ab.top + ab.height / 2))
      const fitCards = [...document.querySelectorAll('.move-card')].map((c) => ({
        n: c.querySelector('.move-name').textContent,
        beats: Number(c.querySelector('.beat-badge').textContent),
        fits: c.classList.contains('fits'),
      }))
      const want = Number((document.querySelector('.rail-title').textContent.match(/[0-9]+/) || [0])[0])
      return {
        railTop: Math.round(r.top),
        railBottom: Math.round(r.bottom),
        vh: window.innerHeight,
        title: document.querySelector('.rail-title').textContent.trim(),
        addReachable: !!(add && hit && add.contains(hit)),
        addSize: ab ? [Math.round(ab.width), Math.round(ab.height)] : null,
        fitCards,
        want,
      }
    })
    console.log(' ', JSON.stringify(rail))
    if (!rail.addReachable) findings.push('add-move button is covered inside the open sheet')
    else ok.push(`add-move button reachable at ${rail.addSize.join('x')}px`)
    const hasFit = rail.fitCards.some((c) => c.beats === rail.want)
    if (!hasFit) ok.push(`no move is ${rail.want} beats long, so nothing to sort first`)
    else if (!rail.fitCards[0].fits) findings.push('a move fits the selection exactly but is not sorted first')
    else ok.push(`exact-fit move "${rail.fitCards[0].n}" sorted first`)
    await shot('rail')

    await page.evaluate(() => document.querySelector('.rail-close').click())
    await reset()
    await page.waitForTimeout(300)
    await shot('sheet')

    console.log('== 8. the more-controls drawer')
    await reset()
    await page.evaluate(() => document.querySelector('.bar-btn.only-narrow').click())
    await page.waitForTimeout(400)
    const more = await page.evaluate(() => {
      const d = document.querySelector('.bar-more')
      const r = d.getBoundingClientRect()
      const btns = [...d.querySelectorAll('button')].filter((b) => b.offsetParent !== null)
      return {
        open: getComputedStyle(d).display,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        vh: innerHeight,
        labels: btns.map((b) => b.textContent.trim()),
        offscreen: btns.filter((b) => b.getBoundingClientRect().bottom > innerHeight + 1).length,
      }
    })
    console.log(' ', JSON.stringify(more))
    if (more.open === 'none') findings.push('the more-controls drawer did not open')
    else if (more.offscreen) findings.push(`${more.offscreen} drawer buttons run off the bottom`)
    else if (!more.labels.some((l) => /Rehearse/.test(l))) findings.push('Rehearse is missing from the drawer')
    else ok.push(`drawer opens with ${more.labels.length} controls, all on screen, Rehearse included`)
    await shot('drawer')

    console.log('== 9. tap targets under 44px')
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, a, input, [role=button]')]
        .filter((e) => e.offsetParent !== null && !e.disabled)
        .map((e) => {
          const r = e.getBoundingClientRect()
          return { label: (e.getAttribute('title') || e.textContent || e.tagName).trim().slice(0, 26), w: Math.round(r.width), h: Math.round(r.height) }
        })
        .filter((x) => x.w > 0 && x.h > 0 && (x.h < 44 || x.w < 44)),
    )
    console.log(' ', small.length, JSON.stringify(small))

    console.log('\nerrors:', errors.length, errors.slice(0, 4))
    console.log('\nPASSED:')
    console.log(ok.map((f) => ' + ' + f).join('\n'))
    console.log('\nFINDINGS (' + LABEL + '):')
    console.log(findings.length ? findings.map((f) => ' - ' + f).join('\n') : ' none')
    await ctx.close()
  })
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})

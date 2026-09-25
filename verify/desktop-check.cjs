/* Desktop regression pass: the stylesheet split and the merged bottom bar must not
   have changed the 1440px layout. Run: node verify/desktop-check.cjs [port] */
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir, createChecklist } = require('./harness.cjs')
const { PROJECT } = require('./fixtures.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`
const SHOTS = screenshotDir('desktop-check')

const { check, report } = createChecklist()

async function main() {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(desktopContext())
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(1) })

    const g = await page.evaluate(() => {
      const r = (s) => {
        const e = document.querySelector(s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { left: Math.round(b.left), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }
      }
      return {
        vw: innerWidth,
        vh: innerHeight,
        docScrollW: document.documentElement.scrollWidth,
        appbar: r('.appbar'),
        songmap: r('.songmap'),
        rail: r('.rail'),
        main: r('.main'),
        bar: r('.bar'),
        barMore: r('.bar-more'),
        strip: r('.songstrip'),
        counts: r('.counts'),
        moreOpen: getComputedStyle(document.querySelector('.bar-more')).display,
        railStatic: getComputedStyle(document.querySelector('.rail')).position,
        wideVisible: [...document.querySelectorAll('.only-wide')].filter((e) => e.offsetParent !== null).length,
        narrowVisible: [...document.querySelectorAll('.only-narrow')].filter((e) => e.offsetParent !== null).length,
        tap: getComputedStyle(document.documentElement).getPropertyValue('--tap').trim(),
      }
    })
    console.log(JSON.stringify(g, null, 1))

    check('no sideways overflow', g.docScrollW <= g.vw + 2, `page is ${g.docScrollW}px wide in ${g.vw}px`)
    check('song map is present on desktop', !!g.songmap, g.songmap ? `${g.songmap.h}px tall` : 'missing')
    check('song strip is phone-only', !g.strip, g.strip ? 'the phone song strip leaked onto desktop' : 'absent')
    check('rail is a static column', g.railStatic === 'static', `rail is ${g.railStatic}, expected static`)
    check('main starts after the rail', g.main.left >= g.rail.w - 1, `main.left ${g.main.left}, rail.w ${g.rail.w}`)
    check(
      'secondary controls row always visible on desktop',
      g.moreOpen !== 'none',
      g.moreOpen === 'none' ? 'the secondary controls row is hidden on desktop' : g.moreOpen,
    )
    check('no phone-only elements visible on desktop', g.narrowVisible === 0, `${g.narrowVisible} phone-only elements visible`)
    check('at least one desktop-only element visible', g.wideVisible > 0, `${g.wideVisible} desktop-only elements visible`)
    check('desktop tap sizing active', g.tap === '34px', `--tap is ${g.tap}, expected 34px`)
    check('bottom bar sits on screen', g.bar.bottom <= g.vh + 1, `bar.bottom ${g.bar.bottom}, vh ${g.vh}`)
    check('counts row back to 46px on desktop', g.counts.h === 46, `counts row is ${g.counts.h}px, expected 46`)

    await page.screenshot({ path: path.join(SHOTS, 'desktop-sheet.png') })
    // An empty row: dragging from a block moves the block, which is a different test.
    const empty = await page.evaluate(() => {
      for (const el of document.querySelectorAll('.counts')) {
        if (el.querySelector('.block') || el.querySelector('.count-marker')) continue
        const b = el.getBoundingClientRect()
        if (b.top < 200 || b.bottom > innerHeight - 120) continue
        return { left: Math.round(b.left), y: Math.round(b.top + b.height / 2) }
      }
      return null
    })
    check('found an empty counts row to drag across', !!empty, empty ? JSON.stringify(empty) : 'no empty counts row on screen to drag across')
    const y = empty ? empty.y : Math.round((g.counts.top + g.counts.bottom) / 2)
    const x0 = empty ? empty.left : g.counts.left
    await page.mouse.move(x0 + 60, y)
    await page.mouse.down()
    await page.mouse.move(x0 + 460, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const sel = await page.evaluate(() => document.querySelectorAll('.count-cell.sel').length)
    console.log('mouse drag selected', sel)
    check('mouse drag selects at least 2 counts', sel >= 2, `mouse drag selected ${sel} counts`)
    await page.screenshot({ path: path.join(SHOTS, 'desktop-selection.png') })

    console.log('\nerrors:', errors.length, errors.slice(0, 4))
    await ctx.close()
  })
  report()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/* Desktop regression pass: the stylesheet split and the merged bottom bar must not
   have changed the 1440px layout. Run: node verify/desktop-check.cjs [port] */
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir } = require('./harness.cjs')
const { PROJECT } = require('./fixtures.cjs')

const PORT = process.argv[2] || '42001'
const URL = `http://localhost:${PORT}`
const SHOTS = screenshotDir('desktop-check')

async function main() {
  const findings = []
  const ok = []
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

    if (g.docScrollW > g.vw + 2) findings.push(`page is ${g.docScrollW}px wide in ${g.vw}px`)
    else ok.push('no sideways overflow')
    if (!g.songmap) findings.push('song map is missing on desktop')
    else ok.push(`song map present, ${g.songmap.h}px tall`)
    if (g.strip) findings.push('the phone song strip leaked onto desktop')
    else ok.push('song strip is phone-only')
    if (g.railStatic !== 'static') findings.push(`rail is ${g.railStatic}, expected static`)
    else ok.push(`rail is a static ${g.rail.w}px column`)
    if (g.main.left < g.rail.w - 1) findings.push('main does not start after the rail')
    else ok.push('main starts after the rail')
    if (g.moreOpen === 'none') findings.push('the secondary controls row is hidden on desktop')
    else ok.push('secondary controls row always visible on desktop')
    if (g.narrowVisible) findings.push(`${g.narrowVisible} phone-only elements visible on desktop`)
    else ok.push('no phone-only elements visible')
    if (!g.wideVisible) findings.push('no desktop-only elements visible')
    else ok.push(`${g.wideVisible} desktop-only elements visible`)
    if (g.tap !== '34px') findings.push(`--tap is ${g.tap}, expected 34px`)
    else ok.push('desktop tap sizing active')
    if (g.bar.bottom > g.vh + 1) findings.push('bottom bar runs past the viewport')
    else ok.push('bottom bar sits on screen')
    if (g.counts.h !== 46) findings.push(`counts row is ${g.counts.h}px, expected 46`)
    else ok.push('counts row back to 46px on desktop')

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
    if (!empty) findings.push('no empty counts row on screen to drag across')
    const y = empty ? empty.y : Math.round((g.counts.top + g.counts.bottom) / 2)
    const x0 = empty ? empty.left : g.counts.left
    await page.mouse.move(x0 + 60, y)
    await page.mouse.down()
    await page.mouse.move(x0 + 460, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const sel = await page.evaluate(() => document.querySelectorAll('.count-cell.sel').length)
    console.log('mouse drag selected', sel)
    if (sel < 2) findings.push(`mouse drag selected ${sel} counts`)
    else ok.push(`mouse drag selects ${sel} counts`)
    await page.screenshot({ path: path.join(SHOTS, 'desktop-selection.png') })

    console.log('\nerrors:', errors.length, errors.slice(0, 4))
    console.log('\nPASSED:\n' + ok.map((f) => ' + ' + f).join('\n'))
    console.log('\nFINDINGS:\n' + (findings.length ? findings.map((f) => ' - ' + f).join('\n') : ' none'))
    await ctx.close()
  })
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})

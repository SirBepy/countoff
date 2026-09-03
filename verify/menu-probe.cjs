/* Verifies the sheet context menu, comments, vertical block drag and lane stacking.
   Run: node verify/menu-probe.cjs [port] */
const path = require('path')
const {
  withBrowser,
  phoneContext,
  desktopContext,
  seedProject,
  silentWav,
  hitPoint,
  tap,
  screenshotDir,
  createChecklist,
} = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`
const SHOTS = screenshotDir('menu-probe')

const PROJECT = {
  id: 'm1',
  name: 'Menu probe',
  audioName: 'probe.mp3',
  duration: 246,
  segments: [
    {
      id: 's1',
      name: 'I Will Survive',
      start: 0,
      bpm: 117,
      anchor: 0,
      transitionIn: 0,
      countsPerRow: 8,
      lyrics: [],
      fit: { offset: 0, scale: 1 },
    },
  ],
  blocks: [
    { id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 },
    { id: 'b2', segmentId: 's1', moveId: 'grapevine', startBeat: 8, beats: 4 },
    { id: 'b3', segmentId: 's1', moveId: 'clap', startBeat: 10, beats: 2 },
  ],
  moves: [
    { id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 },
    { id: 'grapevine', name: 'Grapevine', beats: 4, energy: 2 },
    { id: 'clap', name: 'Clap', beats: 1, energy: 1 },
  ],
  markers: [],
  updatedAt: Date.now(),
}

const { check, report } = createChecklist()

async function main() {
  await withBrowser(async (browser) => {
    await phone(browser)
    await desktop(browser)
  })
  report()
}

const blocks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.block')].map((b) => ({
      text: b.textContent.trim(),
      lane: b.style.getPropertyValue('--lane'),
      left: b.style.left,
      comment: b.classList.contains('comment'),
    })),
  )

/** Which row owns a block now, tracked by id: after a drag the first block in
 *  the DOM is often a different one, which reads as "it never moved". */
const rowOf = (page, id) =>
  page.evaluate((id) => {
    const b = document.querySelector(`[data-block-id="${id}"]`)
    return b ? [...document.querySelectorAll('.counts')].findIndex((r) => r.contains(b)) : -1
  }, id)

const firstBlockId = (page) => page.evaluate(() => document.querySelector('.block').dataset.blockId)

const menuItems = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet-menu-item')].map((b) => b.textContent.trim()))

const clickItem = async (page, label) => {
  await page.evaluate(
    (label) => [...document.querySelectorAll('.sheet-menu-item')].find((b) => b.textContent.trim() === label)?.click(),
    label,
  )
  await page.waitForTimeout(400)
}

async function phone(browser) {
  const ctx = await browser.newContext(phoneContext())
  const page = await ctx.newPage()
  await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(1) })

  const cdp = await ctx.newCDPSession(page)
  const finger = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }]
  async function drag(x, y, dx, dy, hold) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(x, y) })
    await page.waitForTimeout(hold)
    for (let i = 1; i <= 14; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: finger(x + (dx * i) / 14, y + (dy * i) / 14) })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)
  }

  // Row 3 is empty of blocks, so a hold there can only be the bare-counts menu.
  await tap(page, '.counts', { nth: 2, hold: 700 })
  let items = await menuItems(page)
  check('phone: hold on bare counts opens the menu', items.includes('Add a comment'), items.join(' | '))
  await page.screenshot({ path: path.join(SHOTS, 'phone-1-counts-menu.png') })

  await clickItem(page, 'Add a comment')
  const editorOpen = await page.evaluate(() => !!document.querySelector('.block-note-input'))
  check('phone: Add a comment opens its editor straight away', editorOpen)
  await page.keyboard.type('big smile here')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  let list = await blocks(page)
  const comment = list.find((b) => b.comment)
  check('phone: the comment lands on the sheet with its text', comment?.text === 'big smile here', JSON.stringify(comment))
  await page.screenshot({ path: path.join(SHOTS, 'phone-2-comment-placed.png') })

  // A tap on a block is the menu; the hold below is the drag.
  await tap(page, '.block', { nth: 0, hold: 90 })
  items = await menuItems(page)
  check('phone: tap on a block opens Duplicate / Delete', items.includes('Duplicate') && items.includes('Delete'), items.join(' | '))
  await page.screenshot({ path: path.join(SHOTS, 'phone-3-block-menu.png') })

  const before = (await blocks(page)).length
  await clickItem(page, 'Duplicate')
  const after = (await blocks(page)).length
  check('phone: Duplicate adds a copy', after === before + 1, `${before} -> ${after}`)

  // Hold past HOLD_MS, then travel a full row down: the old build could only move sideways.
  const rowGap = await page.evaluate(() => {
    const r = document.querySelectorAll('.counts')
    return r[1].getBoundingClientRect().top - r[0].getBoundingClientRect().top
  })
  const dragTarget = await hitPoint(page, '.block', 0)
  const dragId = await firstBlockId(page)
  const fromRow = await rowOf(page, dragId)
  await drag(dragTarget.x, dragTarget.y, 0, rowGap, 420)
  const movedTo = await rowOf(page, dragId)
  check('phone: hold then drag down moves the block to the next row', movedTo > fromRow, `row ${fromRow} -> ${movedTo}`)
  await page.screenshot({ path: path.join(SHOTS, 'phone-4-dragged-down.png') })
  await ctx.close()
}

async function desktop(browser) {
  const ctx = await browser.newContext(desktopContext())
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(1) })

  // b2 (8..12) and b3 (10..12) overlap by seed, so lanes must already differ.
  const laned = await blocks(page)
  const lanes = new Set(laned.map((b) => b.lane))
  check('desktop: overlapping blocks sit in different lanes', lanes.size > 1, JSON.stringify(laned.map((b) => [b.text, b.lane])))
  const grew = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.counts')]
    return { stacked: rows[1].getBoundingClientRect().height, plain: rows[2].getBoundingClientRect().height }
  })
  check('desktop: the stacked row is taller than a plain one', grew.stacked > grew.plain, JSON.stringify(grew))
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1-lanes.png') })

  const onBlock = await hitPoint(page, '.block', 1)
  await page.mouse.click(onBlock.x, onBlock.y, { button: 'right' })
  await page.waitForTimeout(300)
  let items = await menuItems(page)
  check(
    'desktop: right-click a block gives edit / duplicate / restack / delete',
    ['Duplicate', 'Bring to front', 'Send to back', 'Delete'].every((i) => items.includes(i)),
    items.join(' | '),
  )
  await page.screenshot({ path: path.join(SHOTS, 'desktop-2-block-menu.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  const bare = await hitPoint(page, '.counts', 3)
  await page.mouse.click(bare.x, bare.y, { button: 'right' })
  await page.waitForTimeout(300)
  items = await menuItems(page)
  check(
    'desktop: right-click bare counts offers comment / pick / new move',
    ['Add a comment', 'Pick a move', 'New move here'].every((i) => items.includes(i)),
    items.join(' | '),
  )
  await page.screenshot({ path: path.join(SHOTS, 'desktop-3-counts-menu.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // A block dragged a whole row down with the mouse, which needed no hold.
  const rowGap = await page.evaluate(() => {
    const r = document.querySelectorAll('.counts')
    return r[1].getBoundingClientRect().top - r[0].getBoundingClientRect().top
  })
  const grab = await hitPoint(page, '.block', 0)
  const grabId = await firstBlockId(page)
  const fromRow = await rowOf(page, grabId)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(grab.x, grab.y + (rowGap * i) / 12)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  const movedTo = await rowOf(page, grabId)
  check('desktop: mouse drag down moves the block to the next row', movedTo > fromRow, `row ${fromRow} -> ${movedTo}`)
  await page.screenshot({ path: path.join(SHOTS, 'desktop-4-dragged-down.png') })

  check('desktop: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

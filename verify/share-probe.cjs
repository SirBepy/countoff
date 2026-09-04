/* The read-only gate a /v/<token> share view runs behind: with store.readOnly set, no
   real edit gesture and no store call may change the project, and nothing may be
   persisted. Phase A drives the same gesture with the gate OFF, so a pass in phase B
   cannot be the gesture silently failing to do anything. */
const { withBrowser, desktopContext, seedProject, silentWav, hitPoint, createChecklist, readProject } = require('./harness.cjs')
const path = require('path')
const fs = require('fs')

const PORT = process.argv[2] || '42212'
const URL = `http://localhost:${PORT}/`
const SHOTS = path.join(__dirname, '..', '.for_bepy', 'screenshots', '9f2a71c4-1d0e-4b58-9a3c-2b6f0a51d7e3')

const PROJECT = {
  id: 'share1',
  name: 'Shared number',
  audioName: 'probe.wav',
  duration: 30,
  segments: [
    { id: 's1', name: 'Song', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'm1', startBeat: 0, beats: 2 }],
  moves: [{ id: 'm1', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  people: [],
  movements: [],
  floor: { cols: 11, rows: 7 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

const STORE_CALL = (body) =>
  `(async () => {
     const appSrc = await (await fetch('/src/App.tsx')).text()
     const mod = await import(appSrc.match(/"([^"]*lib\\/store\\.ts[^"]*)"/)[1])
     ${body}
   })()`

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(30) })
    await page.waitForSelector('.block', { timeout: 5000 })

    const store = (body) => page.evaluate(STORE_CALL(body))
    const startBeat = () => store(`return mod.getState().project.blocks[0].startBeat`)
    const rowGap = await page.evaluate(() => {
      const r = document.querySelectorAll('.counts')
      return r[1].getBoundingClientRect().top - r[0].getBoundingClientRect().top
    })

    /** A real mouse drag, not a dispatched event: pointer capture and the hold timer
     *  are exactly what a synthetic sequence would let the test choose. */
    async function dragBlockDownARow() {
      const grab = await hitPoint(page, '.block', 0)
      await page.mouse.move(grab.x, grab.y)
      await page.mouse.down()
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(grab.x, grab.y + (rowGap * i) / 12)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      await page.waitForTimeout(400)
    }

    // --- phase A: the gate is off, so the gesture must really move the block ---
    const beforeEditable = await startBeat()
    await dragBlockDownARow()
    const afterEditable = await startBeat()
    check(
      'with the gate off, a real mouse drag moves the block',
      afterEditable > beforeEditable,
      `startBeat ${beforeEditable} -> ${afterEditable}`,
    )

    // Both share surfaces render against real markup; Firestore itself is unreachable
    // from a probe, so this proves layout and wiring, not the round trip.
    await page.click('.ph-share-network')
    await page.waitForSelector('.modal', { timeout: 5000 })
    await page.screenshot({ path: path.join(SHOTS, 'share-3-share-modal.png') })
    check('the share modal opens from the header', await page.locator('.modal:has-text("Create a view-only link")').count() === 1)
    await page.keyboard.press('Escape')
    await page.click('.modal-back', { position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)

    await store(`mod.updateProject({ shareToken: 'probe0123456789abcdef0123456789ab' })`)
    await page.waitForTimeout(200)

    // The rename button is the migration path off a hex token, so it must appear for one
    // and stay out of the way once the link is already words.
    const renameOffered = async () => {
      await page.click('.ph-share-network')
      await page.waitForSelector('.modal', { timeout: 5000 })
      const offered = await page.locator('.modal button:has-text("Make it a word link")').count()
      await page.click('.modal-back', { position: { x: 5, y: 5 } }).catch(() => {})
      await page.waitForTimeout(300)
      return offered
    }
    check('a hex link is offered the word-link rename', (await renameOffered()) === 1)
    await store(`mod.updateProject({ shareToken: 'silver-otter-lantern-quilt' })`)
    await page.waitForTimeout(200)
    check('a word link is not offered the rename again', (await renameOffered()) === 0)
    await store(`mod.updateProject({ shareToken: 'probe0123456789abcdef0123456789ab' })`)
    await page.waitForTimeout(200)

    await page.click('.ph-chat-circle-text')
    await page.waitForSelector('.comment-thread', { timeout: 5000 })
    await page.screenshot({ path: path.join(SHOTS, 'share-4-comments.png') })
    check('the comments thread renders for a project that has a link', await page.locator('.comment-thread').count() === 1)
    await page.click('.modal-back', { position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)

    // --- phase B: the same gesture under the read-only gate ---
    await store(`mod.set({ readOnly: true }, false)`)
    await page.waitForTimeout(100)
    const beforeLocked = await startBeat()
    await dragBlockDownARow()
    const afterLocked = await startBeat()
    check(
      'with the gate on, the same drag leaves the block where it was',
      afterLocked === beforeLocked,
      `startBeat ${beforeLocked} -> ${afterLocked}`,
    )

    const nameBefore = await store(`return mod.getState().project.name`)
    await store(`mod.updateProject({ name: 'Edited from a shared view' })`)
    check(
      'withProject refuses a direct store mutation too, not just a gesture',
      (await store(`return mod.getState().project.name`)) === nameBefore,
    )

    await store(`mod.undo(); mod.redo()`)
    check('undo and redo are refused as well', (await startBeat()) === beforeLocked)

    // The viewed project must never land in the viewer's own IndexedDB library.
    await store(`mod.flushSave()`)
    await page.waitForTimeout(400)
    const persisted = await readProject(page)
    check(
      'nothing from the shared view is written to IndexedDB',
      persisted.blocks[0].startBeat === afterEditable && persisted.name === nameBefore,
      JSON.stringify({ startBeat: persisted.blocks[0].startBeat, name: persisted.name }),
    )

    await page.screenshot({ path: path.join(SHOTS, 'share-1-read-only.png') })
    check('no console or page errors', errors.length === 0, errors.join(' | '))
    await context.close()

    // A second, empty context: a share link must route to the share boot, never fall through
    // to the file-drop screen. This token does not exist, so the failure branch is what
    // renders - which is still proof the route is wired and IndexedDB was never consulted.
    // Three forms: the bare hash shareUrl now hands out, the /v/ hash it used to, and the
    // path a rewriting host still serves.
    const viewer = await browser.newContext(desktopContext())
    for (const [form, link, slug] of [
      ['#<words>', `${URL}#silver-otter-lantern-quilt`, 'words'],
      ['#/v/<token>', `${URL}#/v/0123456789abcdef0123456789abcdef`, 'hash'],
      ['/v/<token>', `${URL}v/0123456789abcdef0123456789abcdef`, 'path'],
    ]) {
      const viewPage = await viewer.newPage()
      await viewPage.goto(link, { waitUntil: 'domcontentloaded' })
      const broke = await viewPage
        .waitForSelector('.ph-link-break', { timeout: 20000 })
        .then(() => true)
        .catch(() => false)
      check(`an unknown ${form} lands on the share failure screen, not the file drop`, broke)
      check(`the file-drop screen is not what ${form} shows`, !(await viewPage.locator('.drop-signin').count()))
      await viewPage.screenshot({ path: path.join(SHOTS, `share-2-bad-link-${slug}.png`) })
      await viewPage.close()
    }
    await viewer.close()
  })

  const ok = report()
  console.log(`\nscreenshots: ${SHOTS}`)
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

/* The video inspector as a set of fields rather than readouts: an exact typed time, the
   caret and arrow-key nudges at both step sizes, and the three different things that can
   move (the clip on the song, the film inside it, one trimmed end). No footage is
   recorded here: the inspector reads project.takes, not the blob, so a metadata-only take
   exercises every field and keeps the probe fast. */
const path = require('path')
const { withBrowser, desktopContext, seedProject, readProject, silentWav, screenshotDir, createChecklist } =
  require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const TAKE_ID = 'take-a'

/** Tolerance for a time the app rounds to milliseconds. */
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.0005

const PROJECT = {
  id: 'cliptimes1',
  name: 'Wedding medley 2026',
  audioName: 'probe.wav',
  duration: 60,
  segments: [
    {
      id: 's1',
      name: 'Bailando',
      start: 0,
      bpm: 120,
      anchor: 0,
      transitionIn: 0,
      countsPerRow: 8,
      lyrics: [],
      fit: { offset: 0, scale: 1 },
    },
  ],
  // A project with no blocks boots into the setup wizard (`src/lib/openProject.ts`), so
  // one placed move is what gets this probe to the sheet and its video button.
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 8 }],
  moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  people: [],
  movements: [],
  takes: [
    { id: TAKE_ID, name: 'full-run take 2.webm', duration: 12, bytes: 240000 },
    // Long enough that `headBound` can sit ahead of its own songStart, which `TAKE_ID`'s
    // 12s can't: that gap is what makes the head-trim floor land away from zero.
    { id: 'take-wide', name: 'wide shot.webm', duration: 90, bytes: 500000 },
  ],
  // `edit` is the clip every field is driven through; `atStart` sits on the take's first
  // frame, which is the only way to reach the slip clamp without hundreds of clicks.
  // `headBound` sits after both on the song (its songStart must sort last so index-based
  // `select()` calls above still land on `edit`/`atStart`), with srcIn ahead of songStart
  // by 3s so the head-trim floor is a real number, not the trivial 0 case.
  clips: [
    { id: 'edit', takeId: TAKE_ID, songStart: 20, srcIn: 3, srcOut: 8 },
    { id: 'atStart', takeId: TAKE_ID, songStart: 40, srcIn: 0, srcOut: 3 },
    { id: 'headBound', takeId: 'take-wide', songStart: 42, srcIn: 45, srcOut: 49 },
  ],
  floor: { cols: 6, rows: 4 },
  walkCounts: 8,
  pinned: [],
  focus: { kind: 'audience' },
  updatedAt: Date.now(),
}

async function main() {
  const { check, report } = createChecklist()
  const dir = screenshotDir('clip-times')

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))

    const clipOf = async (id) => (await readProject(page))?.clips?.find((c) => c.id === id)
    /** Clips render in song order, so the seeded pair is left-to-right on the lane. */
    const select = async (n) => {
      await page.locator('.vt-clip').nth(n).click()
      await page.waitForTimeout(250)
    }

    try {
      await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(60) })

      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.appbar button')].find((b) => b.querySelector('.ph-film-strip'))
        btn?.click()
      })
      await page.waitForSelector('.video-view', { timeout: 5000 })
      await select(0)

      const fields = await page.locator('.vs-insp .f input').count()
      const slipCarets = await page.locator('.vs-slip button').count()
      const stepChips = await page.locator('.vs-step button').count()
      check(
        'a selected clip gives the inspector three typed times, a sync pair and a step chip',
        fields === 3 && slipCarets === 2 && stepChips === 2,
        `${fields} inputs, ${slipCarets} sync carets, ${stepChips} step chips`,
      )

      // 1. Typing an exact song time. This is the ask: a number, not a drag.
      await page.locator('.vs-insp .f input').nth(0).fill('0:22.125')
      await page.keyboard.press('Enter')
      const typed = await clipOf('edit')
      check(
        'a typed song start lands to the millisecond',
        near(typed?.songStart, 22.125) && near(typed?.srcIn, 3),
        typed && `songStart ${typed.songStart}, srcIn ${typed.srcIn}`,
      )

      // 2. Footage sync: the film moves, the clip does not.
      await page.locator('.vs-slip button').nth(1).click()
      const slipped = await clipOf('edit')
      check(
        'a sync caret shifts the film 10ms and leaves the clip where it plays',
        near(slipped?.srcIn, 3.01) && near(slipped?.srcOut, 8.01) && near(slipped?.songStart, 22.125),
        slipped && `src ${slipped.srcIn}-${slipped.srcOut}, songStart ${slipped.songStart}`,
      )

      // 3. The step chip governs every nudge, carets and keys alike.
      await page.locator('.vs-step button').nth(1).click()
      await page.locator('.vs-slip button').nth(1).click()
      const coarse = await clipOf('edit')
      check(
        'switching the step to 0.1 makes the next sync caret worth 100ms',
        near(coarse?.srcIn, 3.11) && near(coarse?.srcOut, 8.11),
        coarse && `src ${coarse.srcIn}-${coarse.srcOut}`,
      )

      await page.keyboard.press('Shift+ArrowRight')
      const keySlip = await clipOf('edit')
      check(
        'Shift+Right syncs the film by the same step',
        near(keySlip?.srcIn, 3.21) && near(keySlip?.srcOut, 8.21) && near(keySlip?.songStart, 22.125),
        keySlip && `src ${keySlip.srcIn}-${keySlip.srcOut}, songStart ${keySlip.songStart}`,
      )

      await page.keyboard.press('ArrowLeft')
      const walked = await clipOf('edit')
      check(
        'a bare arrow walks the clip along the song and leaves the film alone',
        near(walked?.songStart, 22.025) && near(walked?.srcIn, 3.21),
        walked && `songStart ${walked.songStart}, srcIn ${walked.srcIn}`,
      )

      // 4. The keys must not fight the fields they sit next to.
      await page.locator('.vs-insp .f input').nth(0).focus()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      const whileTyping = await clipOf('edit')
      check(
        'arrows move the caret, not the clip, while a field has focus',
        near(whileTyping?.songStart, 22.025),
        whileTyping && `songStart ${whileTyping.songStart}`,
      )

      // 5. From is a head trim, exactly like the left handle: the clip keeps cutting out
      //    at the same moment of the song, so only its head moves.
      const beforeTrim = await clipOf('edit')
      const endBefore = beforeTrim.songStart + (beforeTrim.srcOut - beforeTrim.srcIn)
      await page.locator('.vs-insp .f input').nth(1).fill('0:04.210')
      await page.keyboard.press('Enter')
      const trimmed = await clipOf('edit')
      const endAfter = trimmed && trimmed.songStart + (trimmed.srcOut - trimmed.srcIn)
      check(
        'a typed From trims the head and holds the moment the clip cuts out',
        near(trimmed?.srcIn, 4.21) && near(trimmed?.songStart, 23.025) && near(endAfter, endBefore),
        trimmed && `srcIn ${trimmed.srcIn}, songStart ${trimmed.songStart}, cuts out ${endAfter?.toFixed(3)}`,
      )

      await page.screenshot({ path: path.join(dir, 'desktop-clip-inspector.png') })
      await page.locator('.vs-insp').screenshot({ path: path.join(dir, 'desktop-clip-inspector-bar.png') })

      // 6. The clamp: a clip already on the take's first frame has nothing earlier to show.
      await select(1)
      await page.locator('.vs-slip button').nth(0).click()
      const clamped = await clipOf('atStart')
      const toast = (await page.locator('.toast').textContent().catch(() => '')) || ''
      check(
        'syncing past the start of the take is refused rather than silently clamped',
        near(clamped?.srcIn, 0) && near(clamped?.srcOut, 3) && /no footage/i.test(toast),
        `srcIn ${clamped?.srcIn}, toast "${toast.trim()}"`,
      )

      // 7. The head-trim floor (`minSrcIn`) is one definition read by both the drag handle
      //    and the typed field. Drag first to whatever floor the handle finds on its own,
      //    then type an out-of-range value into From: if the field computed a different
      //    floor, this second step would move the clip again instead of leaving it put.
      await select(2)
      const beforeBound = await clipOf('headBound')
      const inHandle = page.locator('.vt-clip').nth(2).locator('.h.l')
      const handleBox = await inHandle.boundingBox()
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(handleBox.x - 4000, handleBox.y + handleBox.height / 2, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(400)
      const dragBound = await clipOf('headBound')
      check(
        'dragging the head handle all the way left stops at the take\'s first frame',
        near(dragBound?.srcIn, 3) && near(dragBound?.songStart, 0),
        dragBound && `srcIn ${beforeBound?.srcIn} -> ${dragBound.srcIn}, songStart ${beforeBound?.songStart} -> ${dragBound.songStart}`,
      )

      // `headBound`'s songStart just dropped to 0 by the drag above, ahead of `edit` and
      // `atStart` on the lane, so `select(2)` would now grab the wrong clip: it is already
      // selected from the drag's own pointerdown, so the inspector already reads it.
      await page.locator('.vs-insp .f input').nth(1).fill('0:00.000')
      await page.keyboard.press('Enter')
      const typedBound = await clipOf('headBound')
      check(
        'typing below the floor into From lands on the same srcIn and songStart the drag already found',
        near(typedBound?.srcIn, dragBound?.srcIn) && near(typedBound?.songStart, dragBound?.songStart),
        typedBound && `srcIn ${typedBound.srcIn}, songStart ${typedBound.songStart}`,
      )
    } catch (e) {
      // Report whatever already ran: a mid-probe throw is a failure worth seeing in
      // context, not a stack trace that hides the checks before it.
      check('probe ran to the end', false, String(e).split('\n')[0])
    }

    await context.close()
  })

  console.log(`\nscreenshots -> ${dir}`)
  report()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

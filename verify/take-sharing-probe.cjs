/* A duplicate shares its source's footage rather than copying it, so the only thing that
   model can get wrong is which deletes may remove a blob. This probe watches exactly that:
   the take files are stand-in bytes, since nothing here ever decodes them. */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '5173'
const URL = `http://localhost:${PORT}/`

function makeProject(id, name, takeId) {
  return {
    id,
    name,
    audioName: 'probe.wav',
    duration: 30,
    segments: [
      {
        id: `${id}-s1`,
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
    blocks: [{ id: `${id}-b1`, segmentId: `${id}-s1`, moveId: `${id}-mv`, startBeat: 0, beats: 8 }],
    moves: [{ id: `${id}-mv`, name: 'Step touch', beats: 2, energy: 1 }],
    markers: [],
    people: [],
    movements: [],
    takes: [{ id: takeId, name: `${takeId}.webm`, duration: 4, bytes: 2048 }],
    clips: [{ id: `${id}-c1`, takeId, songStart: 0, srcIn: 0, srcOut: 4 }],
    floor: { cols: 6, rows: 4 },
    walkCounts: 8,
    pinned: [],
    focus: { kind: 'audience' },
    updatedAt: Date.now(),
  }
}

const ORIGINAL = makeProject('copyA', 'Original medley', 'take-a')
const OTHER = makeProject('copyB', 'Unrelated number', 'take-b')

/** Adds the second project and both take files straight to disk; the app only ever writes
 *  its own active record, so it cannot clobber either. */
async function seedSecond(page, other, takeIds) {
  await page.evaluate(
    async ({ other, takeIds }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('countoff')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const put = (store, value, key) =>
        new Promise((resolve, reject) => {
          const r = db.transaction(store, 'readwrite').objectStore(store).put(value, key)
          r.onsuccess = () => resolve()
          r.onerror = () => reject(r.error)
        })
      await put('project', other, other.id)
      for (const id of takeIds) await put('takes', new Blob([new Uint8Array(2048)]), id)
    },
    { other, takeIds },
  )
}

function readStores(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const all = (store, method) =>
      new Promise((resolve, reject) => {
        const r = db.transaction(store, 'readonly').objectStore(store)[method]()
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const projects = await all('project', 'getAll')
    return {
      takeKeys: await all('takes', 'getAllKeys'),
      projects: projects.map((p) => ({ id: p.id, name: p.name, takeIds: (p.takes || []).map((t) => t.id) })),
    }
  })
}

/** Matched on the exact name: "Original medley" is a substring of "Original medley copy",
 *  so a hasText filter would happily act on the wrong row. */
const row = (page, name) =>
  page.locator('.modal .result').filter({ has: page.locator('.move-name', { hasText: new RegExp(`^${name}$`) }) })

const rowButton = (page, name, title) => row(page, name).locator(`button[title="${title}"]`)

const rowOpen = (page, name) => row(page, name).getByRole('button', { name: 'Open' })

/** Waits past the read-delete-sweep behind every take delete, which no click awaits. */
async function settle(page) {
  await page.waitForTimeout(700)
}

async function openProjects(page) {
  await page.click('button[title^="Projects:"]')
  await page.waitForSelector('.modal .result')
}

/** Drops the open project's only take from the video screen's takes bin, and comes back. */
async function dropTakeFromBin(page) {
  await page.click('button[title^="Video:"]')
  await page.waitForSelector('.vs-take')
  await page.click('.vs-take button[title="Remove this take and its clips"]')
  await page.waitForFunction(() => document.querySelectorAll('.vs-take').length === 0)
  await settle(page)
  await page.click('button[title="Back to the sheet"]')
  await page.waitForSelector('button[title^="Projects:"]')
}

async function main() {
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    page.on('console', (m) => m.type() === 'error' && console.log('  console.error ::', m.text()))
    page.on('dialog', (d) => void d.accept())

    await seedProject(page, URL, { project: ORIGINAL, audioBytes: silentWav(30) })
    await seedSecond(page, OTHER, ['take-a', 'take-b'])

    const seeded = await readStores(page)
    check('both take files are on disk to begin with', seeded.takeKeys.length === 2, seeded.takeKeys.join(', '))

    await openProjects(page)
    await rowButton(page, 'Original medley', 'Duplicate').click()
    await page.waitForSelector('.modal .result:nth-child(3)')
    await settle(page)

    const copied = await readStores(page)
    const copy = copied.projects.find((p) => p.name === 'Original medley copy')
    check('duplicating adds a third project', copied.projects.length === 3, copied.projects.map((p) => p.name).join(' | '))
    check('the copy cites the same take, not a new one', !!copy && copy.takeIds.join() === 'take-a', copy && copy.takeIds.join())
    check('duplicating copied no footage', copied.takeKeys.length === 2, copied.takeKeys.join(', '))

    // Todo 14: two projects share one file, so one of them dropping the take must not
    // empty the other's clips.
    await rowOpen(page, 'Original medley copy').click()
    await page.waitForSelector('button[title^="Video:"]')
    await dropTakeFromBin(page)

    const afterDrop = await readStores(page)
    const stripped = afterDrop.projects.find((p) => p.name === 'Original medley copy')
    check('the take really left the copy', !!stripped && stripped.takeIds.length === 0, stripped && stripped.takeIds.join())
    check(
      'dropping a shared take leaves the other project its footage',
      afterDrop.takeKeys.includes('take-a'),
      afterDrop.takeKeys.join(', ') || '(empty)',
    )

    // Todo 15: a project nobody else shares with takes its files with it.
    await openProjects(page)
    await rowButton(page, 'Unrelated number', 'Delete').click()
    await page.waitForFunction(() => document.querySelectorAll('.modal .result').length === 2)
    await settle(page)

    const afterOtherGone = await readStores(page)
    check(
      'deleting an unshared project sweeps its footage',
      !afterOtherGone.takeKeys.includes('take-b'),
      afterOtherGone.takeKeys.join(', ') || '(empty)',
    )
    check(
      'the surviving project keeps its own footage',
      afterOtherGone.takeKeys.includes('take-a'),
      afterOtherGone.takeKeys.join(', ') || '(empty)',
    )

    // The guard has to be a guard, not a blanket refusal: the last project citing a
    // take drops it, and the file goes.
    await rowOpen(page, 'Original medley').click()
    await page.waitForSelector('button[title^="Video:"]')
    await dropTakeFromBin(page)

    const afterLast = await readStores(page)
    check(
      'dropping the last claim on a take does delete the file',
      !afterLast.takeKeys.includes('take-a'),
      afterLast.takeKeys.join(', ') || '(empty)',
    )

    await context.close()
  })

  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

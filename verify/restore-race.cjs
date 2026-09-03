/* Regression probe for fcf63bd. Edits (queuing a save), restores INSIDE the 400ms
   debounce window, checks the restore survived. Check 1 asserts the window was hit:
   a restore after the debounce flushed could never fail and is not evidence.
   Run: node verify/restore-race.cjs [port] */
const { withBrowser, desktopContext, seedProject, silentWav, readProject, createChecklist } = require('./harness.cjs')
const { PROJECT } = require('./fixtures.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}`
const SNAPSHOT_NAME = 'Snapshot restore point'
const RACE_EDIT_NAME = 'RACE EDIT (queued save)'

const { check, report } = createChecklist()

async function main() {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(desktopContext())
    const page = await ctx.newPage()
    page.on('dialog', (d) => d.accept())
    await seedProject(page, URL, {
      project: PROJECT,
      audioBytes: silentWav(1),
      snapshots: [{ at: Date.now() - 60000, label: 'auto snapshot', project: { ...PROJECT, name: SNAPSHOT_NAME } }],
    })

    const t0 = Date.now()
    await page.fill('.project-name', RACE_EDIT_NAME)
    await page.click('button[title*="Backups"]')
    await page.waitForSelector('.modal-back')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore')?.click())
    const elapsed = Date.now() - t0
    check('restore fired inside the 400ms debounce window (else this run is not evidence)', elapsed < 380, `${elapsed}ms`)

    const after = await readProject(page)
    check('the restored snapshot survived the race, not the queued edit', after?.name === SNAPSHOT_NAME, after?.name)
    check('the queued pre-restore edit did not land back on top', after?.name !== RACE_EDIT_NAME, after?.name)
    await ctx.close()
  })
  report()
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

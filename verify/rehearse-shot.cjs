/* Screenshots the rehearse screen off the real shared link, which is the only place
   the footage and the cast actually exist: IndexedDB is per-origin, so localhost has
   no projects of its own and a share token is what loads one from Firestore. */
const path = require('path')
const { withBrowser, desktopContext, phoneContext, screenshotDir } = require('./harness.cjs')

/* First argument is a port for the dev server, or a full origin to shoot the deployed
   site instead. Pages serves the app from a subpath, so the origin carries it. */
const WHERE = process.argv[2] || '5173'
const TOKEN = process.argv[3] || '984a22aa0d1940429f665f80520cb562'
const BASE = WHERE.startsWith('http') ? WHERE.replace(/\/$/, '') : `http://localhost:${WHERE}`
const URL = `${BASE}/#${TOKEN}`

async function shoot(browser, label, context) {
  const page = await browser.newContext(context).then((c) => c.newPage())
  const dir = screenshotDir('rehearse')
  page.on('console', (m) => m.type() === 'error' && console.log(`  console: ${m.text().slice(0, 160)}`))

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)
  await page.screenshot({ path: path.join(dir, `${label}-1-landing.png`) })

  const rehearse = page.locator('button:has-text("Rehearse")').first()
  if (await rehearse.count()) {
    await rehearse.click()
    await page.waitForTimeout(2500)
  }
  await page.screenshot({ path: path.join(dir, `${label}-2-rehearse.png`) })

  // The first clip lands about twenty seconds in, and only a real play reaches it:
  // the transport is the audio element's own clock, with no seek exposed to the page.
  const play = page.locator('.rehearse .primary').first()
  if (await play.count()) {
    await play.click()
    for (const at of [24, 30]) {
      await page.waitForFunction((t) => document.querySelector('.rehearse-top .mono')?.textContent >= t, `0:${at}`, {
        timeout: 60000,
      })
      await page.screenshot({ path: path.join(dir, `${label}-3-clip-${at}.png`) })
    }
  }
  console.log(`${label}: ${dir}`)
  return page
}

withBrowser(async (browser) => {
  await shoot(browser, 'desktop', desktopContext())
  await shoot(browser, 'phone', phoneContext())
}).catch((e) => {
  console.error(e)
  process.exit(1)
})

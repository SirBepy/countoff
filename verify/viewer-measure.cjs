/* Measures a live share link's viewer playback: whether the footage keeps up with the song,
   and what the browser was doing on the network meanwhile. Promoted from the throwaway
   .for_bepy/viewer-repro.cjs that found, fixed and A/B-verified the 2026-09-10 viewer stall on
   the live share #camel-snow-savanna-mauve (28s vs 0s "no frame at the playhead" at 3 Mbps from
   song start) - see .claude/todos/53-...

   A measuring tool, not an assertion probe (see verify/rehearse-shot.cjs for the same shape):
   it prints per-second rows and a summary, and has no pass/fail count of its own. Real network,
   on purpose - it is the one tool here that is supposed to talk to production Storage/Firestore,
   same as rehearse-shot.cjs and share-cache-probe.cjs.

   Args: <link> <seconds> <throttleKbps> <startAt> <mobile 0|1> */
const path = require('path')
const { withBrowser, desktopContext, phoneContext, screenshotDir } = require('./harness.cjs')

const LINK = process.argv[2] || 'https://sirbepy.github.io/countoff/#camel-snow-savanna-mauve'
const SECONDS = Number(process.argv[3] || 45)
// kbit/s; 0 = no throttle. The stall this tool measures only reproduces around 3 Mbps
// (3000) on this app - an unthrottled run on a fast connection will not show it.
const THROTTLE = Number(process.argv[4] || 0)
const START_AT = Number(process.argv[5] || 0)
const MOBILE = process.argv[6] === '1'
const DIR = screenshotDir('viewer')

async function run() {
  return withBrowser(async (browser) => {
    const context = await browser.newContext(MOBILE ? phoneContext() : desktopContext())
    const page = await context.newPage()
    const inflight = new Map()
    const log = []
    const t0 = Date.now()
    const stamp = () => ((Date.now() - t0) / 1000).toFixed(1)
    page.on('request', (r) => {
      const u = r.url()
      if (!/firebasestorage|googleapis|storage/.test(u) || /firestore/.test(u)) return
      inflight.set(r, u)
      log.push(`${stamp()}s  -> ${r.method()} ${u.slice(0, 110)} range=${r.headers()['range'] || '-'}`)
    })
    page.on('requestfinished', (r) => {
      if (inflight.has(r)) {
        inflight.delete(r)
        log.push(`${stamp()}s  <- done ${r.url().slice(0, 90)}`)
      }
    })
    page.on('requestfailed', (r) => {
      if (inflight.has(r)) {
        inflight.delete(r)
        log.push(`${stamp()}s  <- FAILED ${r.failure()?.errorText} ${r.url().slice(0, 90)}`)
      }
    })
    page.on(
      'console',
      (m) => (m.type() === 'error' || m.type() === 'warning') && log.push(`${stamp()}s  console.${m.type()} ${m.text().slice(0, 400)}`),
    )

    if (THROTTLE) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 40,
        downloadThroughput: (THROTTLE * 1024) / 8,
        uploadThroughput: (THROTTLE * 1024) / 8,
      })
    }

    await page.goto(LINK, { waitUntil: 'domcontentloaded' })

    // Two link shapes reach the rehearse screen differently: a join-link/spectator token lands
    // straight in `.rehearse`, a project share token lands on a landing screen with its own
    // "Rehearse" button first (see verify/rehearse-shot.cjs). Handle both.
    const rehearseButton = page.locator('button:has-text("Rehearse")').first()
    await Promise.race([
      page.waitForSelector('.rehearse', { timeout: 120000 }),
      rehearseButton.waitFor({ state: 'visible', timeout: 120000 }).catch(() => {}),
    ])
    if (!(await page.locator('.rehearse').count()) && (await rehearseButton.count())) {
      await rehearseButton.click()
      await page.waitForSelector('.rehearse', { timeout: 30000 })
    }
    console.log(`rehearse up at ${stamp()}s`)
    await page.waitForTimeout(1500)
    // A fresh device is asked who it is; answer as a spectator so the whole cast's footage shows.
    const watching = page.getByText('I am just watching')
    if (await watching.count()) {
      await watching.first().click()
      await page.waitForTimeout(500)
    }

    const stage = () =>
      page.evaluate(() => {
        const a = document.querySelector('audio')
        // .vstage-on/.vstage-crop/.vstage-warm are wrapper divs, not the video itself; every
        // video inside carries .vstage-el regardless of which state its wrapper is in (see
        // src/components/VideoStage.tsx), so the video actually on screen has to be scoped
        // through the "on"/"crop" wrapper, and "warm" through its own wrapper.
        const main = document.querySelector('.vstage .vstage-on .vstage-el, .vstage .vstage-crop .vstage-el')
        const warm = [...document.querySelectorAll('.vstage .vstage-warm .vstage-el')]
        const desc = (v) => ({
          src: (v.getAttribute('src') || '').replace(/^(https?:\/\/[^/]+\/[^?]{0,40}).*$/, '$1…').replace(/^blob:.*$/, 'blob:'),
          t: Number(v.currentTime.toFixed(2)),
          ready: v.readyState,
          net: v.networkState,
          paused: v.paused,
          buffered: v.buffered.length ? `${v.buffered.start(0).toFixed(1)}-${v.buffered.end(v.buffered.length - 1).toFixed(1)}` : '-',
        })
        return {
          audio: a ? { t: Number(a.currentTime.toFixed(2)), paused: a.paused } : null,
          main: main ? desc(main) : null,
          warm: warm.map(desc),
          gap: !!document.querySelector('.vstage.is-gap'),
          videos: document.querySelectorAll('video').length,
        }
      })

    console.log('initial', JSON.stringify(await stage()))
    await page.screenshot({ path: path.join(DIR, 'viewer-00-loaded.png') })
    if (START_AT) {
      await page.evaluate((t) => (document.querySelector('audio').currentTime = t), START_AT)
      await page.waitForTimeout(1200)
      console.log('parked at', START_AT, JSON.stringify(await stage()))
    }
    await page.click('.rehearse button.primary')
    console.log(`pressed play at ${stamp()}s`)

    let lastMain = null
    let stuckRuns = 0
    let stallRuns = 0
    for (let i = 0; i < SECONDS; i++) {
      await page.waitForTimeout(1000)
      const s = await stage()
      const m = s.main
      const stuck = m && !s.gap && lastMain && lastMain.src === m.src && Math.abs(m.t - lastMain.t) < 0.05 && s.audio && !s.audio.paused
      if (stuck) stuckRuns++
      // No frame at the playhead while the song runs: what the viewer sees as frozen or black.
      // The app's own drift-correction seek assigns v.currentTime = target, which advances
      // currentTime even on a stuck video - that is why readyState, not currentTime, is the
      // signal that caught the 2026-09-10 stall (see the memory
      // measure-viewer-playback-by-readystate-not-currenttime).
      const stall = m && !s.gap && m.ready < 3 && s.audio && !s.audio.paused
      if (stall) stallRuns++
      console.log(
        `${stamp().padStart(5)}s audio=${s.audio?.t.toFixed(1).padStart(6)} ${s.gap ? 'GAP ' : '    '}main=${m ? `${m.src} t=${m.t} rs=${m.ready} ns=${m.net} ${m.paused ? 'PAUSED' : 'play'} buf=${m.buffered}` : '-'} warm=${s.warm.map((w) => `${w.src}@${w.t}/rs${w.ready}`).join(',')} inflight=${inflight.size}${stuck ? '  <<< STUCK' : ''}${stall ? '  <<< NO FRAME' : ''}`,
      )
      if (i === 10 || i === 25 || i === SECONDS - 1) await page.screenshot({ path: path.join(DIR, `viewer-${String(i).padStart(2, '0')}.png`) })
      lastMain = m
    }

    // stallRuns (readyState < 3 while the song plays) is the headline number: it is what gave
    // the honest 28s-vs-0s production/fixed comparison on 2026-09-10. stuckRuns (currentTime
    // frozen) is printed alongside as a secondary, weaker signal - the drift-correction seek
    // above makes it undercount, so a low stuckRuns with a high stallRuns is expected, not a
    // contradiction, and stallRuns is the one to act on.
    console.log(`\nno frame at the playhead (stallRuns): ${stallRuns}s of ${SECONDS}s watched`)
    console.log(`frozen currentTime (stuckRuns, weaker signal): ${stuckRuns}s`)
    console.log('\n--- network ---')
    for (const l of log) console.log(l)
    console.log(`still in flight: ${[...inflight.values()].map((u) => u.slice(0, 90)).join('\n  ')}`)
    return { stallRuns, stuckRuns }
  })
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

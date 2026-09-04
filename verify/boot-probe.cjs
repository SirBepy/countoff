/* Boot-time bugs: the empty state's route to an already-pulled project, whether the
   audio element survives a dev-mode hot reload, and whether lib/store.ts's own state
   survives one too rather than dropping the open project behind a live screen. */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')
const fs = require('fs')
const path = require('path')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`
const AUDIO_TS = path.join(__dirname, '..', 'src', 'lib', 'audio.ts')
const STORE_TS = path.join(__dirname, '..', 'src', 'lib', 'store.ts')

const projA = {
  id: 'pA', name: 'Project A', audioName: 'a.wav', duration: 30,
  segments: [{ id: 's1', name: 'Song', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } }],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'm1', startBeat: 0, beats: 2 }],
  markers: [], moves: [{ id: 'm1', name: 'Step', beats: 2, energy: 1 }], people: [], movements: [],
  floor: { cols: 11, rows: 7 }, walkCounts: 8, pinned: [], focus: { kind: 'audience' }, updatedAt: Date.now(),
}
const projB = { ...projA, id: 'pB', name: 'Project B' }

async function seedExtraProject(page, proj) {
  await page.evaluate(
    async ({ proj, audioBase64 }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('countoff', 1)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const put = (store, value, key) =>
        new Promise((resolve, reject) => {
          const r = db.transaction(store, 'readwrite').objectStore(store).put(value, key)
          r.onsuccess = () => resolve()
          r.onerror = () => reject(r.error)
        })
      await put('project', proj, proj.id)
      const bin = atob(audioBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await put('audio', new Blob([bytes]), proj.id)
    },
    { proj, audioBase64: Buffer.from(silentWav(30)).toString('base64') },
  )
}

const audioState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('audio')
    return { paused: el.paused, currentTime: el.currentTime }
  })

async function main() {
  const { check, report } = createChecklist()
  const originalAudioTs = fs.readFileSync(AUDIO_TS, 'utf8')
  const originalStoreTs = fs.readFileSync(STORE_TS, 'utf8')

  await withBrowser(async (browser) => {
    const context = await browser.newContext(desktopContext())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    // --- bug 2: the empty state routes to a project sitting unadopted in IndexedDB ---
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      indexedDB.deleteDatabase('countoff')
      localStorage.clear()
    })
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await seedExtraProject(page, projA)
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.drop', { timeout: 15000 })

    check('a project sitting in IndexedDB with no active id lands on the empty state', await page.locator('.drop').isVisible())
    check(
      'the empty state offers a route to the project list',
      await page.locator('button:has-text("Open an existing project")').isVisible(),
    )
    await page.click('button:has-text("Open an existing project")')
    await page.waitForSelector('.modal')
    await page.waitForSelector('.result')
    check('it opens the real Projects modal, not a new screen', await page.locator('.result:has-text("Project A")').isVisible())
    await page.click('.result:has-text("Project A") button:has-text("Open")')
    await page.waitForSelector('.sheet', { timeout: 5000 })
    check('picking it from the empty state adopts it without creating a new project first', await page.locator('.sheet').isVisible())

    // --- bug 3: sign-in state is visible on the empty state, not just implied by a button ---
    await page.evaluate(() => {
      indexedDB.deleteDatabase('countoff')
      localStorage.clear()
    })
    await page.goto(URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.drop', { timeout: 15000 })
    check(
      'signed out shows the sign-in control, not a signed-in claim',
      (await page.locator('button:has-text("Sign in and pull")').isVisible()) &&
        (await page.locator('text=Signed in as').count()) === 0,
    )

    // --- bug 4: play/pause survives switching between projects with real clicks ---
    await seedProject(page, URL, { project: projA, audioBytes: silentWav(30) })
    await seedExtraProject(page, projB)

    await page.click('.bar-play')
    await page.waitForTimeout(300)
    check('play starts the freshly booted project', !(await audioState(page)).paused)

    await page.click('.appbar button[title^="Projects"]')
    await page.waitForSelector('.modal')
    await page.click('.result:has-text("Project B") button:has-text("Open")')
    await page.waitForSelector('.sheet')
    await page.click('.bar-play')
    await page.waitForTimeout(300)
    check('play still works right after switching to another project', !(await audioState(page)).paused)

    await page.click('.appbar button[title^="Projects"]')
    await page.waitForSelector('.modal')
    await page.click('.result:has-text("Project A") button:has-text("Open")')
    await page.waitForSelector('.sheet')
    await page.click('.bar-play')
    await page.waitForTimeout(300)
    check('play works switching back to the first project too', !(await audioState(page)).paused)

    // --- bug 4 root cause: a real dev-mode hot reload of the audio module must not
    // leave the transport bound to a second, DOM-detached <audio> element ---
    await page.addInitScript(() => {
      window.__audioConstructCount = 0
      const RealAudio = window.Audio
      window.Audio = new Proxy(RealAudio, { construct: (t, a) => (window.__audioConstructCount++, new t(...a)) })
    })
    await seedProject(page, URL, { project: projA, audioBytes: silentWav(30) })
    await page.click('.bar-play')
    await page.waitForTimeout(300)

    fs.writeFileSync(AUDIO_TS, originalAudioTs + '\n// boot-probe hmr touch\n')
    await page.waitForTimeout(1500)
    fs.writeFileSync(AUDIO_TS, originalAudioTs)
    await page.waitForTimeout(500)

    check(
      'a hot reload of lib/audio.ts constructs the element only once across the session',
      (await page.evaluate(() => window.__audioConstructCount)) === 1,
    )
    const beforeClick = await audioState(page)
    await page.click('.bar-play')
    await page.waitForTimeout(400)
    const afterClick = await audioState(page)
    check(
      'the play button still controls real playback after the hot reload',
      afterClick.paused !== beforeClick.paused || afterClick.currentTime > beforeClick.currentTime,
      `before=${JSON.stringify(beforeClick)} after=${JSON.stringify(afterClick)}`,
    )

    // --- bug 4 regression: a hot reload must not stack native listeners, which
    // would silently double every timeupdate-driven effect - counting invocations,
    // not just constructions, since the construction count cannot see this ---
    await page.addInitScript(() => {
      window.__handlerTimeupdateCount = 0
      window.__clickCount = 0
      const origAdd = EventTarget.prototype.addEventListener
      window.__origAddEventListener = origAdd
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === 'timeupdate' && this instanceof HTMLMediaElement && typeof listener === 'function') {
          const wrapped = (...args) => {
            window.__handlerTimeupdateCount++
            return listener(...args)
          }
          return origAdd.call(this, type, wrapped, options)
        }
        return origAdd.call(this, type, listener, options)
      }
      // click() in lib/audio.ts calls this once per metronome tick; a stacked
      // second rAF loop from a duplicated 'play' listener would double this count.
      const patchOsc = () => {
        if (!window.AudioContext) return
        const orig = window.AudioContext.prototype.createOscillator
        window.AudioContext.prototype.createOscillator = function (...args) {
          window.__clickCount++
          return orig.apply(this, args)
        }
      }
      patchOsc()
    })
    await seedProject(page, URL, { project: projA, audioBytes: silentWav(30) })

    // Ground truth, registered once via the saved original addEventListener so this
    // counter itself can never be duplicated by a later reload the way app code can.
    await page.evaluate(() => {
      window.__nativeTimeupdateCount = 0
      window.__origAddEventListener.call(document.querySelector('audio'), 'timeupdate', () => window.__nativeTimeupdateCount++)
    })
    await page.click('button[title="Click every beat, accent on the 1"]')
    await page.click('.bar-play')
    await page.waitForTimeout(1600)
    const beforeCounts = await page.evaluate(() => ({
      native: window.__nativeTimeupdateCount,
      handler: window.__handlerTimeupdateCount,
      clicks: window.__clickCount,
    }))
    check(
      'exactly one timeupdate handler runs per native event before any reload',
      beforeCounts.native > 0 && beforeCounts.handler === beforeCounts.native,
      JSON.stringify(beforeCounts),
    )

    fs.writeFileSync(AUDIO_TS, originalAudioTs + '\n// boot-probe hmr touch\n')
    await page.waitForTimeout(1500)
    fs.writeFileSync(AUDIO_TS, originalAudioTs)
    await page.waitForTimeout(500)
    // The reload's re-adopt effect reloads the audio source, which pauses it. Whether
    // the metronome toggle itself survives a reload is a separate question from
    // whether its click rate doubles - force it back on either way for a fair compare.
    if ((await audioState(page)).paused) await page.click('.bar-play')
    const metronomeOn = await page.evaluate(
      () => document.querySelector('button[title="Click every beat, accent on the 1"]')?.classList.contains('on'),
    )
    if (!metronomeOn) await page.click('button[title="Click every beat, accent on the 1"]')
    await page.waitForTimeout(1600)
    const afterCounts = await page.evaluate(() => ({
      native: window.__nativeTimeupdateCount,
      handler: window.__handlerTimeupdateCount,
      clicks: window.__clickCount,
    }))
    check(
      'still exactly one timeupdate handler running per native event after a hot reload',
      afterCounts.native > beforeCounts.native && afterCounts.handler === afterCounts.native,
      JSON.stringify(afterCounts),
    )
    // 120 BPM: two clicks/second. A doubled metronome would show roughly twice this.
    const clickDelta = afterCounts.clicks - beforeCounts.clicks
    check(
      'the metronome click count does not double across the hot reload',
      clickDelta >= 1 && clickDelta <= 5,
      `pre-reload clicks=${beforeCounts.clicks} post-reload delta=${clickDelta}`,
    )

    // --- bug 1 root cause: a real hot reload of lib/store.ts must leave the open
    // project and its undo history alone, since the store anchors its whole mutable
    // set on globalThis rather than re-initialising module-scope lets ---
    const readStore = () =>
      page.evaluate(async () => {
        const appSrc = await (await fetch('/src/App.tsx')).text()
        const mod = await import(appSrc.match(/"([^"]*lib\/store\.ts[^"]*)"/)[1])
        const st = mod.getState()
        return { project: st.project && st.project.id, canUndo: st.canUndo, sheet: !!document.querySelector('.sheet') }
      })

    await page.evaluate(async () => {
      const appSrc = await (await fetch('/src/App.tsx')).text()
      const mod = await import(appSrc.match(/"([^"]*lib\/store\.ts[^"]*)"/)[1])
      mod.updateProject({ name: 'Renamed before the hot reload' })
    })
    const beforeHmr = await readStore()
    check('a project is open with undo history before the hot reload', !!beforeHmr.project && beforeHmr.canUndo, JSON.stringify(beforeHmr))

    fs.writeFileSync(STORE_TS, originalStoreTs + '\n// boot-probe hmr touch\n')
    await page.waitForTimeout(1500)
    fs.writeFileSync(STORE_TS, originalStoreTs)
    await page.waitForTimeout(800)

    const afterHmr = await readStore()
    check(
      'a hot reload of lib/store.ts leaves the open project on screen',
      afterHmr.project === beforeHmr.project && afterHmr.sheet,
      JSON.stringify(afterHmr),
    )
    check('undo history survives that same hot reload', afterHmr.canUndo, JSON.stringify(afterHmr))

    check('no console or page errors', errors.length === 0, errors.join(' | '))
    await context.close()
  })

  // Belt and suspenders: never leave audio.ts edited if a check above threw first.
  if (fs.readFileSync(AUDIO_TS, 'utf8') !== originalAudioTs) fs.writeFileSync(AUDIO_TS, originalAudioTs)
  if (fs.readFileSync(STORE_TS, 'utf8') !== originalStoreTs) fs.writeFileSync(STORE_TS, originalStoreTs)

  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

/* Shared browser-verify harness for countoff. See verify/README.md for the
   gotcha list every probe here already had to rediscover once. */
const fs = require('fs')
const path = require('path')
/* Chromium comes from the dev's shared Playwright install; this repo has no playwright
   dependency. Point COUNTOFF_CHROMIUM_RESOLVER elsewhere to run these on another machine. */
const RESOLVER =
  process.env.COUNTOFF_CHROMIUM_RESOLVER ||
  'C:/Users/tecno/.claude-personal/skills/_shared/playwright-resolve.cjs'

let getChromium
try {
  ;({ getChromium } = require(RESOLVER))
} catch {
  try {
    const { chromium } = require('playwright')
    getChromium = () => chromium
  } catch {
    throw new Error(
      `No chromium. Set COUNTOFF_CHROMIUM_RESOLVER to a module exporting getChromium(), or npm i -D playwright. Tried: ${RESOLVER}`,
    )
  }
}

async function withBrowser(fn, opts = {}) {
  const browser = await getChromium().launch(opts)
  try {
    return await fn(browser)
  } finally {
    await browser.close()
  }
}

function phoneContext() {
  return {
    viewport: { width: 393, height: 873 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 11; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  }
}

function desktopContext() {
  return { viewport: { width: 1440, height: 900 } }
}

/** Clear -> reload -> seed -> reload: the app flushes its in-memory project on
 *  pagehide/beforeunload, so a seed written while it's live gets clobbered. */
async function seedProject(page, url, { project, audioBytes, snapshots } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    indexedDB.deleteDatabase('countoff')
    localStorage.clear()
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ project, audioBase64, snapshots }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('countoff', 1)
        req.onupgradeneeded = () => {
          for (const s of ['project', 'audio', 'clips'])
            if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const put = (store, value, key) =>
        new Promise((resolve, reject) => {
          const r = db.transaction(store, 'readwrite').objectStore(store).put(value, key)
          r.onsuccess = () => resolve()
          r.onerror = () => reject(r.error)
        })
      if (project) {
        await put('project', project, project.id)
        // Stores are keyed by the project's own id (since c2fd274), not 'current'.
        localStorage.setItem('countoff.activeProjectId', project.id)
      }
      if (audioBase64 && project) {
        const bin = atob(audioBase64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        await put('audio', new Blob([bytes]), project.id)
      }
      if (snapshots && project) {
        localStorage.setItem(`countoff.snapshots.${project.id}`, JSON.stringify(snapshots))
      }
    },
    { project, audioBase64: audioBytes ? Buffer.from(audioBytes).toString('base64') : null, snapshots },
  )
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.counts, .drop', { timeout: 15000 })
  await page.waitForTimeout(600)
}

/** Reads the active project back out of IndexedDB, past the store's 400ms save debounce. */
async function readProject(page) {
  await page.waitForTimeout(500)
  return page.evaluate(async () => {
    const id = localStorage.getItem('countoff.activeProjectId')
    if (!id) return null
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('countoff', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return new Promise((resolve, reject) => {
      const r = db.transaction('project', 'readonly').objectStore('project').get(id)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  })
}

function wavHeader(dataLength, sampleRate = 44100, channels = 1, bitsPerSample = 16) {
  const blockAlign = (channels * bitsPerSample) / 8
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLength, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataLength, 40)
  return buf
}

/** Silence: lets any wrong tempo/beat answer pass, so only use where BPM doesn't matter. */
function silentWav(seconds, sampleRate = 44100) {
  const data = Buffer.alloc(Math.round(seconds * sampleRate) * 2)
  return Buffer.concat([wavHeader(data.length, sampleRate), data])
}

/** A point inside `sel` that actually hit-tests to it, so a probe can never
 *  report an app bug when it really tapped a sticky header or a block. */
function hitPoint(page, sel, n = 0) {
  return page.evaluate(
    ({ sel, n }) => {
      const el = document.querySelectorAll(sel)[n]
      if (!el) return null
      const r = el.getBoundingClientRect()
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.3, 0.6],
        [0.7, 0.4],
      ]) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        if (document.elementFromPoint(x, y)?.closest(sel) === el) return { x, y }
      }
      return null
    },
    { sel, n },
  )
}

const cdpSessions = new WeakMap()
async function getCdp(page) {
  if (!cdpSessions.has(page)) cdpSessions.set(page, await page.context().newCDPSession(page))
  return cdpSessions.get(page)
}

/** Real touch via CDP, hit-tested first. Touch points always carry an `id`,
 *  or Chrome treats successive moves as different fingers and never resolves
 *  the gesture into a scroll. */
async function tap(page, selector, { nth = 0, hold = 90, settle = 350 } = {}) {
  const point = await hitPoint(page, selector, nth)
  if (!point) throw new Error(`tap: no hit-testable element for ${selector}[${nth}]`)
  const cdp = await getCdp(page)
  const finger = (x, y) => [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(point.x, point.y) })
  await page.waitForTimeout(hold)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(settle)
  return point
}

function screenshotDir(label) {
  const dir = path.join(__dirname, '..', '.for_bepy', 'screenshots', `verify-${label}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Tiny assertion collector so a probe file reads as assertions, not scaffolding. */
function createChecklist() {
  const results = []
  const check = (name, pass, detail) => results.push({ name, pass, detail })
  function report() {
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` :: ${r.detail}` : ''}`)
    const failed = results.filter((r) => !r.pass).length
    console.log(`\n${results.length - failed}/${results.length} passed`)
    process.exitCode = failed ? 1 : 0
    return failed === 0
  }
  return { check, report }
}

module.exports = {
  withBrowser,
  phoneContext,
  desktopContext,
  seedProject,
  readProject,
  silentWav,
  hitPoint,
  tap,
  screenshotDir,
  createChecklist,
}

/* Collaboration end to end, against the real Firestore and Storage rules running in the
   Firebase emulator suite. Static review cannot close a rules question: a rule that is too
   loose and a rule that is too tight both compile, and only a second signed-in account can
   tell them apart.

   Needs BOTH servers up first:
     firebase emulators:start --only auth,firestore,storage
     npm run dev -- --port 42210

   node verify/collab-probe.cjs [port]

   NOTE: the emulator does not enforce composite/collection-group indexes, so a green run
   here does NOT prove firestore.indexes.json is deployed. That one needs the real project.
*/
const fs = require('fs')
const path = require('path')
const { withBrowser, desktopContext, seedProject, silentWav, screenshotDir, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || 42210
const URL = `http://localhost:${PORT}/?emulator=1`
const FIRESTORE = 'http://127.0.0.1:8080/v1/projects/generic-sirbepy-project/databases/(default)/documents'

// The auth emulator accepts anything here, and the accounts it makes live exactly as long
// as the emulator process does, so this is a required argument rather than a credential.
// It has to be stable across runs all the same: the accounts survive between them, and a
// fresh value would fail to create an account that exists and fail to sign into one it
// does not have the argument for.
const SIGN_IN_ARG = process.env.COUNTOFF_PROBE_SIGN_IN || 'changeme'

const OWNER = { email: 'owner@countoff.test', pass: SIGN_IN_ARG }
// Deliberately mixed case: the invite is keyed lowercase and the token comes back however
// the account was created, so this is the assertion that the two still meet.
const MATE = { email: 'Mate@Countoff.Test', pass: SIGN_IN_ARG }
const GUEST = { email: 'guest@countoff.test', pass: SIGN_IN_ARG }

const PROJECT = {
  id: 'collab-probe-project',
  name: 'Collab probe medley',
  audioName: 'probe.wav',
  duration: 12,
  segments: [
    { id: 's1', name: 'Song 1', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [{ id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 }],
  moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  updatedAt: Date.now(),
}

/** The emulator honours the rules for a normal request and skips them for `Bearer owner`,
 *  which is how a probe reads ground truth without granting the app anything. */
async function adminRaw(docPath) {
  const res = await fetch(`${FIRESTORE}/${docPath}`, { headers: { Authorization: 'Bearer owner' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`admin read ${docPath}: HTTP ${res.status}`)
  return (await res.json()).fields ?? null
}

/** Firestore REST wraps every value in a type tag; the probe only ever wants the value. */
function plain(fields) {
  if (!fields) return null
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    const [kind, raw] = Object.entries(value)[0]
    out[key] =
      kind === 'integerValue' || kind === 'doubleValue'
        ? Number(raw)
        : kind === 'mapValue'
          ? plain(raw.fields)
          : kind === 'arrayValue'
            ? (raw.values ?? []).map((v) => plain({ v }).v)
            : kind === 'nullValue'
              ? null
              : raw
  }
  return out
}

const admin = async (docPath) => plain(await adminRaw(docPath))

const signIn = (page, who) => page.evaluate((w) => window.__testSignIn(w.email, w.pass), who)
const ruleRead = (page, docPath) => page.evaluate((p) => window.__testGet(p), docPath)

/** Only the fields a probe asserts on: the whole state carries the project and every blob
 *  url with it, and serialising that across the bridge on every poll is pure cost. */
const openState = (page) =>
  page.evaluate(() => {
    const s = globalThis.__countoffStore?.state
    return s ? { role: s.role, readOnly: s.readOnly, shareView: s.shareView, projectId: s.project?.id ?? null } : null
  })

/** Polls rather than sleeping a fixed span: the push is debounced and the emulator is fast,
 *  so a fixed wait is either flaky or several times slower than it needs to be. */
async function waitFor(what, probe, timeout = 40000) {
  const until = Date.now() + timeout
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function freshPage(browser) {
  const context = await browser.newContext(desktopContext())
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  // Every failure in this file is a rules denial somewhere; without the console line the
  // probe only ever reports "timed out" and says nothing about which write was refused.
  page.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text().slice(0, 300)))
  return page
}

/** Clean state per run, or the second run reads the first run's roster. */
async function wipe() {
  const list = async (collection) => {
    const res = await fetch(`${FIRESTORE}/${collection}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })
    return res.ok ? ((await res.json()).documents ?? []) : []
  }
  const drop = (relative) =>
    fetch(`${FIRESTORE}/${relative}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
  const relative = (doc) => doc.name.split('/documents/')[1]

  for (const project of await list('projects')) {
    const base = relative(project)
    // Deleting a document does not delete its subcollections, so the known ones go by name.
    for (const child of ['content', 'members']) for (const kid of await list(`${base}/${child}`)) await drop(relative(kid))
    await drop(base)
  }
  for (const link of await list('links')) await drop(relative(link))
  for (const invitee of await list('invites')) for (const kid of await list(`${relative(invitee)}/for`)) await drop(relative(kid))
}

async function openSharePeople(page) {
  if (!(await page.$('.modal .tabs'))) {
    await page.click('button[title^="Share"]')
    await page.waitForSelector('.modal .tabs', { timeout: 8000 })
  }
  await page.click('.tabs button:has-text("People")')
  await page.waitForTimeout(600)
}

const closeModal = async (page) => {
  const x = await page.$('.modal header button.icon')
  if (x) await x.click()
  await page.waitForTimeout(200)
}

async function run(browser) {
  const { check, report } = createChecklist()
  const shots = screenshotDir('collab')
  await wipe()
  const pages = {}

  /** Every failure here is a rules denial two screens back, so a thrown probe still has to
   *  say what each browser was actually looking at when it gave up. */
  async function dumpAll(why) {
    console.log(`
-- probe stopped: ${why}`)
    for (const [name, page] of Object.entries(pages)) {
      try {
        await page.screenshot({ path: path.join(shots, `stopped-${name}.png`) })
        const text = (await page.textContent('body')).replace(/\s+/g, ' ').trim()
        console.log(`   ${name}: ${text.slice(0, 220)}`)
      } catch (e) {
        console.log(`   ${name}: could not be read (${e.message})`)
      }
    }
  }

  try {
  // --- the owner gets the project onto the service ------------------------------------
  const a = (pages.owner = await freshPage(browser))
  await seedProject(a, URL, { project: PROJECT, audioBytes: silentWav(12) })
  await signIn(a, OWNER)

  const meta = await waitFor('the project document', () => admin(`projects/${PROJECT.id}`))
  check('a signed-in owner pushes the project into the shared collection', !!meta, meta && meta.name)
  check('the project document names the owner', meta.ownerEmail === OWNER.email, meta.ownerEmail)
  check('the choreography is NOT in the card document', !('data' in meta), Object.keys(meta).join(','))

  const content = await waitFor('the content document', () => admin(`projects/${PROJECT.id}/content/project`))
  check('the choreography lands in its own subdocument', !!content.data, Object.keys(content).join(','))

  const withSong = await waitFor('the song upload', async () => {
    const current = await admin(`projects/${PROJECT.id}`)
    return current?.audioUrl ? current : null
  })
  check('the song is uploaded once so a collaborator can hear it', !!withSong.audioUrl, String(withSong.audioUrl).slice(0, 70))
  check('and its storage key is random rather than the project id', !String(withSong.audioKey).includes(PROJECT.id), withSong.audioKey)

  // --- inviting somebody by address ---------------------------------------------------
  await openSharePeople(a)
  await a.fill('#share-email', MATE.email)
  await a.selectOption('#share-add-role', 'editor')
  await a.click('.modal .content button.primary')
  await a.waitForTimeout(1500)
  await a.screenshot({ path: path.join(shots, '1-invited.png') })

  const invite = await waitFor('the invite', () => admin(`invites/${MATE.email.toLowerCase()}/for/${PROJECT.id}`))
  check('inviting by address writes an invite the invitee can find', invite.role === 'editor', invite.role)
  const pending = (await admin(`projects/${PROJECT.id}`)).pending
  check('the owner sees them listed as pending', pending.length === 1, JSON.stringify(pending))
  await closeModal(a)

  // --- the invitee signs in and the project is simply there ---------------------------
  const b = (pages.invited = await freshPage(browser))
  await b.goto(URL, { waitUntil: 'networkidle' })
  await b.waitForSelector('.home', { timeout: 15000 })
  const emptyLibrary = await b.textContent('.home-body')
  check('a signed-out home screen shows the sign-in offer', emptyLibrary.includes('Sign in to see what people shared with you'))

  await signIn(b, MATE)
  await b.waitForSelector('.home-card:not(.new)', { timeout: 25000 })
  await b.waitForTimeout(1200)
  await b.screenshot({ path: path.join(shots, '2-shared-with-you.png') })

  const mateHome = await b.textContent('.home-body')
  check('an address invited while signed out claims it on the next sign-in', mateHome.includes(PROJECT.name))
  check('mixed-case addresses still match the lowercased invite', mateHome.includes('Shared with you'))
  check('their card says what they may do', mateHome.includes('Can edit'))

  // --- what an editor may and may not do ----------------------------------------------
  await b.click('.home-grid .home-card:not(.new)')
  await b.waitForSelector('.counts, .setup-flow, .setup', { timeout: 25000 })
  const asEditor = await openState(b)
  check('an editor opens the project with edit rights', asEditor?.role === 'editor' && asEditor?.readOnly === false, JSON.stringify(asEditor))

  const memberRead = await ruleRead(b, `projects/${PROJECT.id}`)
  check('a member may read the project document', !memberRead?.denied, JSON.stringify(memberRead?.denied ?? 'allowed'))

  // --- somebody with no invite at all -------------------------------------------------
  const c = (pages.stranger = await freshPage(browser))
  await c.goto(URL, { waitUntil: 'networkidle' })
  await c.waitForSelector('.home', { timeout: 15000 })
  await signIn(c, GUEST)
  await c.waitForTimeout(2500)
  const strangerRead = await ruleRead(c, `projects/${PROJECT.id}`)
  check('an account nobody invited is refused the project outright', !!strangerRead?.denied, JSON.stringify(strangerRead))
  check('and sees nothing of it in their library', !(await c.textContent('.home-body')).includes(PROJECT.name))

  // --- the link, and what it grants ---------------------------------------------------
  await openSharePeople(a)
  await a.selectOption('#share-link-role', 'editor')
  const linked = await waitFor('the link', async () => {
    const current = await admin(`projects/${PROJECT.id}`)
    return current?.link ? current : null
  })
  check('turning the link on mints a token', !!linked.link.token, linked.link.token)
  check('six words, not the four a view-only link carries', String(linked.link.token).split('-').length === 6, linked.link.token)
  await a.screenshot({ path: path.join(shots, '3-link-on.png') })
  await closeModal(a)

  await c.goto(`${URL}#join/${linked.link.token}`, { waitUntil: 'networkidle' })
  await c.waitForSelector('.counts, .setup-flow, .setup', { timeout: 30000 })
  await c.waitForTimeout(1500)
  const afterJoin = await openState(c)
  check(
    'the link lets a signed-in stranger in as an editor',
    afterJoin?.role === 'editor' && afterJoin?.projectId === PROJECT.id,
    JSON.stringify(afterJoin),
  )
  check('and the token is spent, not left in the address bar', (await c.evaluate(() => location.hash)) === '')
  await c.screenshot({ path: path.join(shots, '4-joined-via-link.png') })

  // --- demoting somebody -------------------------------------------------------------
  await openSharePeople(a)
  await a.screenshot({ path: path.join(shots, '5-roster.png') })
  const roster = await a.textContent('.modal .content')
  fs.writeFileSync(path.join(shots, 'roster.txt'), roster)
  check('the roster names everyone who got in', roster.includes(MATE.email.toLowerCase()) && roster.includes(GUEST.email))

  await a.locator('.share-person', { hasText: MATE.email.toLowerCase() }).locator('select').selectOption('viewer')
  await a.waitForTimeout(2000)
  await closeModal(a)

  // Never networkidle past this point: the open project holds a live Firestore listener,
  // so the network never goes quiet and the wait only ever times out.
  await b.reload({ waitUntil: 'domcontentloaded' })
  await b.waitForSelector('.counts, .home', { timeout: 25000 })
  await b.waitForTimeout(2500)
  const demoted = await openState(b)
  check('a demoted account re-opens as a viewer', demoted?.role === 'viewer', JSON.stringify(demoted))
  check('and a viewer is read-only', demoted?.readOnly === true, String(demoted?.readOnly))
  await b.screenshot({ path: path.join(shots, '6-demoted-to-viewer.png') })

  } catch (e) {
    await dumpAll(e.message)
    check(`the probe ran to the end`, false, e.message)
  }
  return report()
}

withBrowser((browser) => run(browser)).catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})

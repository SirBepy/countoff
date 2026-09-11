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
// Todo 40: the storage emulator's own JSON API, mirrored the same way FIRESTORE above
// mirrors Firestore's - real object metadata, no admin token needed because
// storage.rules already grants `songs/{uid}/{key}` a public read.
const STORAGE_OBJECT = (key) =>
  `http://127.0.0.1:9199/v0/b/generic-sirbepy-project.firebasestorage.app/o/${encodeURIComponent(key)}`

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

// Todo 14: a second, wholly unrelated project. Every id inside it (project id, segment,
// block, move) is distinct from PROJECT's own, so any assertion comparing the two catches
// a leak in either direction rather than passing by coincidence on a shared name.
const PROJECT2 = {
  id: 'collab-probe-project-two',
  name: 'Collab probe second project',
  audioName: 'probe2.wav',
  duration: 8,
  segments: [
    { id: 't1', name: 'Song 2', start: 0, bpm: 100, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [{ id: 'b2', segmentId: 't1', moveId: 'clap-solo', startBeat: 0, beats: 4 }],
  moves: [{ id: 'clap-solo', name: 'Clap solo', beats: 4, energy: 1 }],
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

/** Every document in a collection, via the same admin bypass `adminRaw` uses. Shared by
 *  `wipe()` and the defect-C guard below, which needs to find a member row by its role or
 *  email rather than a uid nothing here already knows. */
async function listAdmin(relative) {
  const res = await fetch(`${FIRESTORE}/${relative}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })
  return res.ok ? ((await res.json()).documents ?? []) : []
}

/** 200 while the object is there, 404 once it is gone. Any other status is a probe bug
 *  (wrong bucket, emulator down) rather than an answer either way, so it throws. */
async function songObjectStatus(key) {
  const res = await fetch(STORAGE_OBJECT(key))
  if (res.status !== 200 && res.status !== 404) throw new Error(`storage read ${key}: HTTP ${res.status}`)
  return res.status
}

// Todo 54: the auth emulator's own REST sign-in, mirroring what the SDK does over the wire,
// so a delete attempt made with this token is checked against the real security rules
// rather than skipped the way `adminRaw`'s `Bearer owner` bypass is. Returns the uid
// alongside the token: `res.ok` only proves the emulator answered 200, not that the token
// resolved to the account the caller asked for, and a rule denial for the wrong reason
// (an empty or mismatched token) would still read as a 403 to `userDeleteStatus` below.
async function realIdToken(who) {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: who.email, password: who.pass, returnSecureToken: true }),
  })
  if (!res.ok) throw new Error(`REST sign-in for ${who.email}: HTTP ${res.status}`)
  const body = await res.json()
  return { idToken: body.idToken, uid: body.localId }
}

/** A rules-enforced delete attempt, as the signed-in user rather than the admin bypass: the
 *  status code IS the assertion, not an error to unwrap. */
async function userDeleteStatus(idToken, docPath) {
  const res = await fetch(`${FIRESTORE}/${docPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } })
  return res.status
}

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
  // Todo 40's delete goes through Home.tsx's window.confirm(); Playwright dismisses an
  // unhandled dialog, which would silently no-op the delete instead of running it.
  page.on('dialog', (d) => void d.accept())
  return page
}

/** Clean state per run, or the second run reads the first run's roster. */
async function wipe() {
  const drop = (relative) =>
    fetch(`${FIRESTORE}/${relative}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } })
  const relative = (doc) => doc.name.split('/documents/')[1]

  for (const project of await listAdmin('projects')) {
    const base = relative(project)
    // Deleting a document does not delete its subcollections, so the known ones go by name.
    for (const child of ['content', 'members']) for (const kid of await listAdmin(`${base}/${child}`)) await drop(relative(kid))
    await drop(base)
  }
  for (const link of await listAdmin('links')) await drop(relative(link))
  for (const invitee of await listAdmin('invites')) for (const kid of await listAdmin(`${relative(invitee)}/for`)) await drop(relative(kid))
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

async function goHome(page) {
  await page.click('button[title^="Your choreographies"]')
  await page.waitForSelector('.home-card:not(.new)', { timeout: 15000 })
}

/** Matched on the exact name, or "Collab probe medley" would also hit-test the second
 *  project's card once its name is a substring of the first's. */
const homeCard = (page, name) =>
  page.locator('.home-card').filter({ has: page.locator('.home-name', { hasText: new RegExp(`^${name}$`) }) })

async function deleteFromHome(page, name) {
  await homeCard(page, name).locator('.home-more').click()
  await page.locator('.home-menu button', { hasText: 'Delete' }).click()
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

  // --- todo 54: the owner's own row must stay undeletable while the project lives ------
  // firestore.rules:108-109 says removing the owner row while the project still exists
  // would lock everyone out of a project nobody can then re-share. This is the regression
  // guard on the delete rule touched below: proven with a real rules-enforced request, not
  // the admin bypass `adminRaw` uses, so a widened rule that reopens this would be caught.
  const ownerAuth = await realIdToken(OWNER)
  check(
    'the REST sign-in for the owner returned a usable bearer token',
    typeof ownerAuth.idToken === 'string' && ownerAuth.idToken.length > 0,
    JSON.stringify(typeof ownerAuth.idToken),
  )
  check(
    "the REST sign-in resolved to the SAME uid the SDK is using, not a denial for the wrong reason",
    ownerAuth.uid === meta.ownerUid,
    JSON.stringify({ rest: ownerAuth.uid, sdk: meta.ownerUid }),
  )
  const blockedDeleteStatus = await userDeleteStatus(ownerAuth.idToken, `projects/${PROJECT.id}/members/${meta.ownerUid}`)
  check(
    "the owner's own member row cannot be deleted while its project still exists",
    blockedDeleteStatus === 403,
    String(blockedDeleteStatus),
  )
  const ownerRowSurvivesAttempt = await admin(`projects/${PROJECT.id}/members/${meta.ownerUid}`)
  check('that refused delete left the row untouched', ownerRowSurvivesAttempt?.role === 'owner', JSON.stringify(ownerRowSurvivesAttempt))

  // --- todo 14: a second project must stay separate from the first ---------------------
  // The regression the GitHub transport was fixed for on 2026-08-29: opening and syncing
  // one project must never overwrite another. Only ever proven against that old transport;
  // this is the first time it runs against Firestore.
  const d = (pages.owner2 = await freshPage(browser))
  await seedProject(d, URL, { project: PROJECT2, audioBytes: silentWav(8) })
  await signIn(d, OWNER)

  const meta2 = await waitFor('the second project document', () => admin(`projects/${PROJECT2.id}`))
  check('a second, distinct project pushes independently of the first', !!meta2, meta2 && meta2.name)

  const content2 = await waitFor('the second project content document', () => admin(`projects/${PROJECT2.id}/content/project`))
  check(
    "the second project's content carries its own choreography, not the first's",
    content2.data?.blocks?.[0]?.moveId === PROJECT2.moves[0].id,
    JSON.stringify(content2.data?.blocks),
  )

  const metaAfterSecondPush = await admin(`projects/${PROJECT.id}`)
  check(
    "pushing the second project leaves the first project's meta document untouched",
    metaAfterSecondPush.name === PROJECT.name && metaAfterSecondPush.audioName === PROJECT.audioName,
    JSON.stringify({ name: metaAfterSecondPush.name, audioName: metaAfterSecondPush.audioName }),
  )

  const contentAfterSecondPush = await admin(`projects/${PROJECT.id}/content/project`)
  check(
    "pushing the second project leaves the first project's content subdocument untouched",
    contentAfterSecondPush.data?.blocks?.[0]?.moveId === PROJECT.moves[0].id,
    JSON.stringify(contentAfterSecondPush.data?.blocks),
  )

  // A fresh device that has never seen either project pulls both rather than one clobbering
  // the other in the home library, and opening the second one lands on the second one.
  const e = (pages.ownerPull = await freshPage(browser))
  await e.goto(URL, { waitUntil: 'networkidle' })
  await e.waitForSelector('.home', { timeout: 15000 })
  await signIn(e, OWNER)
  await e.waitForSelector('.home-card:not(.new)', { timeout: 25000 })
  await e.waitForTimeout(1200)
  const pulledLibrary = (await e.textContent('.home-body')).replace(/\s+/g, ' ')
  check(
    "a fresh device pulls both of the owner's projects",
    pulledLibrary.includes(PROJECT.name) && pulledLibrary.includes(PROJECT2.name),
    pulledLibrary.slice(0, 220),
  )

  await homeCard(e, PROJECT2.name).click()
  await e.waitForSelector('.counts, .setup-flow, .setup', { timeout: 25000 })
  const pulledState = await openState(e)
  check('pulling the second project opens the second project, never the first', pulledState?.projectId === PROJECT2.id, JSON.stringify(pulledState))

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

  // --- todo 41: two invites fired without awaiting each other must both survive --------
  // A second, independent signed-in session of the SAME owner account, so the two writes
  // below are genuinely concurrent (two separate SDK connections) rather than two clicks
  // serialised by one page's own `busy` state, which a single page's share panel enforces
  // and would never race no matter how fast the clicks land.
  const owner2 = (pages.owner2ndSession = await freshPage(browser))
  await owner2.goto(URL, { waitUntil: 'networkidle' })
  await owner2.waitForSelector('.home', { timeout: 15000 })
  await signIn(owner2, OWNER)
  await owner2.waitForSelector('.home-card:not(.new)', { timeout: 25000 })
  await homeCard(owner2, PROJECT.name).click()
  await owner2.waitForSelector('.counts, .setup-flow, .setup', { timeout: 25000 })
  await openSharePeople(owner2)
  await openSharePeople(a)

  const RACE_1 = 'race1@countoff.test'
  const RACE_2 = 'race2@countoff.test'
  await a.fill('#share-email', RACE_1)
  await owner2.fill('#share-email', RACE_2)
  // Neither click awaits the other's round trip before firing: this is the read-modify-write
  // window the bug lived in.
  await Promise.all([a.click('.modal .content button.primary'), owner2.click('.modal .content button.primary')])
  await a.waitForTimeout(1500)

  const racedPending = await waitFor('both raced invites landing in pending', async () => {
    const current = (await admin(`projects/${PROJECT.id}`)).pending
    return current.length >= 3 ? current : null
  })
  const racedEmails = racedPending.map((p) => p.email)
  check(
    'two invites fired without awaiting each other both survive, neither drops the other',
    racedEmails.includes(RACE_1) && racedEmails.includes(RACE_2),
    JSON.stringify(racedEmails),
  )
  await closeModal(owner2)
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

  // --- todo 54 defect C: the member-delete rule's isOwner-or-self clause is load-bearing ---
  // The GUEST account above has no relationship to this project - not invited, not a member -
  // which is exactly what the vacuous-403 hole in the old guard never tested. Run before the
  // link section: GUEST joins as an editor down there, which would make it a member and no
  // longer the stranger this check needs.
  const mateMemberDoc = (await listAdmin(`projects/${PROJECT.id}/members`)).find(
    (d) => plain(d.fields).email === MATE.email.toLowerCase(),
  )
  const mateUid = mateMemberDoc.name.split('/').pop()
  const guestAuth = await realIdToken(GUEST)
  check(
    'the REST sign-in for the guest also returned a usable bearer token',
    typeof guestAuth.idToken === 'string' && guestAuth.idToken.length > 0,
    JSON.stringify(typeof guestAuth.idToken),
  )
  const strangerDeleteStatus = await userDeleteStatus(guestAuth.idToken, `projects/${PROJECT.id}/members/${mateUid}`)
  check(
    "a signed-in account with no relationship to the project cannot delete another member's row",
    strangerDeleteStatus === 403,
    String(strangerDeleteStatus),
  )
  const mateRowSurvivesStrangerAttempt = await admin(`projects/${PROJECT.id}/members/${mateUid}`)
  check(
    "that refused delete left the mate's row untouched",
    mateRowSurvivesStrangerAttempt?.role === 'editor',
    JSON.stringify(mateRowSurvivesStrangerAttempt),
  )

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

  // --- todo 40: deleting a project reclaims its song from Storage ---------------------
  // Last, deliberately: this ends PROJECT's life, and everything above still reads it.
  const beforeDelete = await songObjectStatus(withSong.audioKey)
  check('the uploaded song is really in Storage before the project is deleted', beforeDelete === 200, String(beforeDelete))

  await goHome(a)
  await deleteFromHome(a, PROJECT.name)

  const afterDelete = await waitFor('the song object to leave Storage', async () => {
    const status = await songObjectStatus(withSong.audioKey)
    return status === 404 ? status : null
  })
  check('deleting the project also deletes its song from Storage', afterDelete === 404, String(afterDelete))

  // --- todo 54: the owner's own member row must not survive the project it belonged to ---
  // `null` is the success value here, not a truthy one, so this polls directly rather than
  // through `waitFor` (which treats a falsy probe result as "not yet").
  const ownerRowGoneAfterDelete = await (async () => {
    const until = Date.now() + 40000
    for (;;) {
      const row = await admin(`projects/${PROJECT.id}/members/${meta.ownerUid}`)
      if (row === null) return { gone: true }
      if (Date.now() > until) return { gone: false, row }
      await new Promise((r) => setTimeout(r, 500))
    }
  })()
  check(
    "deleting the project also deletes the owner's own member row",
    ownerRowGoneAfterDelete.gone === true,
    JSON.stringify(ownerRowGoneAfterDelete),
  )

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

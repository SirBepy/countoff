/* One-command verify suite runner - see .claude/todos/48-...
 *
 * Discovery: probes come from `fs.readdirSync(verify/)`, never a hardcoded list. A
 * hardcoded array goes stale the same week (this todo's own probe counts were already
 * wrong by the time it got picked up: 25/27 claimed, 30 files on disk). NON_PROBES below
 * excludes files that are not runnable assertion probes; everything else ending in
 * `.cjs` or `.mjs` (PROBE_EXTENSIONS) is treated as one - see .claude/todos/59-... for
 * why `.mjs` is included: a probe importing a `.ts` module directly needs it, and
 * PROBE_EXTENSIONS carries the extra node flags that extension needs to run.
 *
 * Ports: each probe has its own default port (42210, 42001, 5173, 42211-42216, ...).
 * Those defaults are parsed out of verify/README.md's own run-list (`defaults to N`)
 * rather than duplicated into a second map here, so the two can't silently drift apart -
 * a probe whose README line has no explicit default falls back to GLOBAL_DEFAULT_PORT,
 * which matches every such probe's own `process.argv[2] || ...` fallback (checked against
 * all of them this session). `--port N` on the CLI forces one port for every probe, for
 * a run where only one dev server is up.
 *
 * Verdicts come from each probe's exit code only, never stdout parsing - two throwaway
 * scripts (2026-09-07) got this wrong by grepping output for "errors" or a "N/M passed"
 * line, and both misreported real runs. A probe that cannot even attempt its assertions
 * (its port isn't serving, or - for collab-probe - the Firebase emulator suite isn't up)
 * is reported SKIPPED with the reason, never silently dropped and never counted as FAIL.
 *
 * Serial execution only: several probes share port 42210 and all of them drive a real
 * browser, so concurrency would produce flaky nonsense (see refs/process-hygiene.md's
 * concurrency cap, which this respects by using 1, not the max of 5).
 */
const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const VERIFY_DIR = __dirname
const README_PATH = path.join(VERIFY_DIR, 'README.md')
const FIREBASE_JSON_PATH = path.join(VERIFY_DIR, '..', 'firebase.json')

const GLOBAL_DEFAULT_PORT = '42210'
const PORT_CHECK_TIMEOUT_MS = 1500
const PROBE_TIMEOUT_MS = 120000

// Libraries the probes import (harness.cjs, fixtures.cjs), this runner itself, and a
// screenshot tool with no pass count (rehearse-shot.cjs). desktop-check.cjs used to be
// excluded here too - it only called process.exit(1) from its top-level catch on a
// thrown exception, never from its own `findings` array, so it reported PASS on every
// run that didn't throw regardless of what it found. Fixed in .claude/todos/55-...: it
// now uses the same createChecklist convention as every other assertion probe, so it
// belongs in the discovered set like any of them.
const NON_PROBES = new Set(['harness.cjs', 'fixtures.cjs', 'rehearse-shot.cjs', 'run-all.cjs'])

// Probes that take no port argument at all.
const NO_PORT = new Set(['readme-list-check', 'setup-lyrics-fit-unit'])

// Extensions treated as probe files, and the extra node flags each needs to run. A .mjs
// probe (verify/setup-lyrics-fit-unit.mjs, see .claude/todos/59-...) imports a .ts module
// directly and needs --experimental-strip-types; .cjs probes need nothing extra.
const PROBE_EXTENSIONS = { '.cjs': [], '.mjs': ['--experimental-strip-types'] }

function readFirebaseEmulatorPorts() {
  try {
    const cfg = JSON.parse(fs.readFileSync(FIREBASE_JSON_PATH, 'utf8'))
    const e = cfg.emulators || {}
    return { auth: e.auth && e.auth.port, firestore: e.firestore && e.firestore.port, storage: e.storage && e.storage.port }
  } catch {
    return {}
  }
}

/** Parses every `verify/<name>.cjs` or `verify/<name>.mjs` line out of the README's
 *  run-list: the default port if the line says "defaults to N", and whether the probe
 *  needs the Firebase emulator (the line says so in prose, for collab-probe). Returns a
 *  Map keyed by name, covering every name the README documents - including ones excluded
 *  from execution above - so a probe deleted out from under a still-current README entry
 *  is caught as a failure below rather than just quietly vanishing from the discovered
 *  list. Still anchors on a leading `node `, so an incidental prose mention of a path
 *  (e.g. "`verify/harness.cjs` is the shared module...") isn't mistaken for a run-list
 *  line; `(?:--[\w-]+ )*` skips over node flags like the .mjs unit test's
 *  `node --experimental-strip-types verify/...`. */
function parseReadme(readmeText) {
  const info = new Map()
  for (const line of readmeText.split('\n')) {
    const m = line.match(/node (?:--[\w-]+ )*verify\/([\w-]+)\.[cm]js/)
    if (!m) continue
    const name = m[1]
    if (info.has(name)) continue // README mentions collab-probe twice (run-list + emulator section); first line wins
    const portMatch = line.match(/defaults to (\d+)/)
    info.set(name, { port: portMatch ? portMatch[1] : null, requiresEmulator: /firebase emulators/i.test(line) })
  }
  return info
}

function checkPort(port, timeout = PORT_CHECK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: 'localhost', port: Number(port) })
    const finish = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** Runs one probe with a hard wall-clock timeout. Uses spawn (not spawnSync) so a
 *  timeout can be enforced with `taskkill /T` on Windows: a plain SIGTERM/kill() only
 *  reaches the Node process, not the Chromium tree it launched, which would otherwise
 *  orphan a chromium.exe on every probe that ever hangs. */
function runProbe(scriptPath, args, nodeFlags = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...nodeFlags, scriptPath, ...args], { cwd: VERIFY_DIR })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)])
      else child.kill('SIGKILL')
    }, PROBE_TIMEOUT_MS)
    child.stdout.on('data', (d) => process.stdout.write(d))
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, error: err })
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  let forcedPort = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') forcedPort = args[++i]
    else if (!forcedPort && /^\d+$/.test(args[i])) forcedPort = args[i]
  }

  const readmeInfo = parseReadme(fs.readFileSync(README_PATH, 'utf8'))
  const emulatorPorts = readFirebaseEmulatorPorts()

  const probeExts = Object.keys(PROBE_EXTENSIONS)
  const diskFiles = new Set(fs.readdirSync(VERIFY_DIR).filter((f) => probeExts.some((ext) => f.endsWith(ext))))
  // Name -> extension, so the run loop below knows which node flags a given probe needs.
  const extByName = new Map([...diskFiles].map((f) => [f.replace(/\.[cm]js$/, ''), path.extname(f)]))
  const probes = [...diskFiles].filter((f) => !NON_PROBES.has(f)).map((f) => f.replace(/\.[cm]js$/, '')).sort()

  const results = []
  const log = (status, name, extra) => {
    const line = `${status.padEnd(5)} ${name}${extra ? ` :: ${extra}` : ''}`
    console.log(line)
    results.push({ name, status, reason: extra })
  }

  // Reverse of readme-list-check.cjs: catches a probe the README still documents but
  // that no longer exists on disk (a deleted/renamed probe), which is a real regression
  // in the suite, not an environment gap - so it fails loudly rather than just dropping
  // out of the discovered list below.
  for (const [name, meta] of readmeInfo) {
    void meta
    if (!probeExts.some((ext) => diskFiles.has(`${name}${ext}`)))
      log('FAIL', name, 'listed in verify/README.md but no verify/' + name + '.cjs or .mjs on disk')
  }

  for (const name of probes) {
    const meta = readmeInfo.get(name)
    const noPort = NO_PORT.has(name)
    const port = forcedPort || (meta && meta.port) || GLOBAL_DEFAULT_PORT
    const label = noPort ? name : `${name} (port ${port})`

    if (!noPort) {
      const reachable = await checkPort(port)
      if (!reachable) {
        log('SKIP', label, `no server listening on port ${port}`)
        continue
      }
    }

    if (meta && meta.requiresEmulator) {
      const need = [emulatorPorts.auth, emulatorPorts.firestore, emulatorPorts.storage]
      if (need.some((p) => !p)) {
        log('SKIP', label, 'firebase.json has no emulators.auth/firestore/storage port configured')
        continue
      }
      const checks = await Promise.all(need.map((p) => checkPort(p)))
      if (checks.some((ok) => !ok)) {
        log('SKIP', label, `Firebase emulator suite not reachable (auth ${need[0]}/firestore ${need[1]}/storage ${need[2]}) - run: firebase emulators:start --only auth,firestore,storage`)
        continue
      }
    }

    console.log(`RUN   ${label}`)
    const ext = extByName.get(name)
    const scriptPath = path.join(VERIFY_DIR, `${name}${ext}`)
    const spawnArgs = noPort ? [] : [port]
    const { code, timedOut, error } = await runProbe(scriptPath, spawnArgs, PROBE_EXTENSIONS[ext])

    if (error) log('FAIL', label, `could not start: ${error.message}`)
    else if (timedOut) log('FAIL', label, `timed out after ${PROBE_TIMEOUT_MS}ms`)
    else if (code === 0) log('PASS', label)
    else log('FAIL', label, `exit code ${code}`)
  }

  const passed = results.filter((r) => r.status === 'PASS')
  const failed = results.filter((r) => r.status === 'FAIL')
  const skipped = results.filter((r) => r.status === 'SKIP')

  console.log('\n==== verify suite summary ====')
  console.log(`${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped, ${results.length} total`)
  if (failed.length) {
    console.log('\nFAILED:')
    for (const f of failed) console.log(`  - ${f.name} :: ${f.reason}`)
  }
  if (skipped.length) {
    console.log('\nSKIPPED:')
    for (const s of skipped) console.log(`  - ${s.name} :: ${s.reason}`)
  }

  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

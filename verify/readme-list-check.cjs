/* Guards against verify/README.md drifting behind verify/*.cjs and verify/*.mjs (see
 * .claude/todos/28-... and .claude/todos/59-...): every probe needs a `verify/<name>`
 * run-list line in the README, or a new session that can't see it hand-writes a
 * duplicate. Pure filesystem check, no browser/dev server. */
const fs = require('fs')
const path = require('path')

const VERIFY_DIR = __dirname
const README = path.join(VERIFY_DIR, 'README.md')
const EXCLUDE = new Set(['harness.cjs', 'fixtures.cjs', 'readme-list-check.cjs'])

const probes = fs
  .readdirSync(VERIFY_DIR)
  .filter((f) => (f.endsWith('.cjs') || f.endsWith('.mjs')) && !EXCLUDE.has(f))
  .map((f) => f.replace(/\.[cm]js$/, ''))

const readme = fs.readFileSync(README, 'utf8')
// Substring only (not anchored on "node "): the .mjs unit test's run-list line is
// `node --experimental-strip-types verify/setup-lyrics-fit-unit.mjs`, so "node " isn't
// immediately followed by "verify/" the way every .cjs probe's line is.
const missing = probes.filter((name) => !readme.includes(`verify/${name}`))

if (missing.length) {
  console.error(`verify/README.md is missing a run-list line for: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`verify/README.md lists all ${probes.length} tracked probes.`)

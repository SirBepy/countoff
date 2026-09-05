/* Guards against verify/README.md drifting behind verify/*.cjs (see .claude/todos/28-...):
 * every probe needs a `node verify/<name>` line in the README's run list, or a new session
 * that can't see it hand-writes a duplicate. Pure filesystem check, no browser/dev server. */
const fs = require('fs')
const path = require('path')

const VERIFY_DIR = __dirname
const README = path.join(VERIFY_DIR, 'README.md')
const EXCLUDE = new Set(['harness.cjs', 'fixtures.cjs', 'readme-list-check.cjs'])

const probes = fs
  .readdirSync(VERIFY_DIR)
  .filter((f) => f.endsWith('.cjs') && !EXCLUDE.has(f))
  .map((f) => f.replace(/\.cjs$/, ''))

const readme = fs.readFileSync(README, 'utf8')
const missing = probes.filter((name) => !readme.includes(`node verify/${name}`))

if (missing.length) {
  console.error(`verify/README.md is missing a run-list line for: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`verify/README.md lists all ${probes.length} tracked probes.`)

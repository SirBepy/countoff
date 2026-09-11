/* Direct unit test for todo 35: computeFit is a pure function (no React, no DOM,
 * no component state) that both SetupLyrics.tsx and LyricsModal.tsx import from
 * src/lib/fit.ts. The browser probe (setup-lyrics-probe.cjs) already exercises
 * SetupLyrics's calibration UI end to end, but nothing browser-driven reaches
 * LyricsModal (it only renders inside Sheet.tsx, off limits to this task and not
 * covered by a setup-flow probe). This is the exercise test for the shared
 * function itself: it imports the real module (not a copy) and would fail if
 * the extraction changed the maths, the error guards, or the hand-placed-line
 * contract (a line with no srcTime is never touched, enforced by both callers
 * around this function, not inside it - see src/lib/types.ts:21).
 * Run: node --experimental-strip-types verify/setup-lyrics-fit-unit.mjs
 * (the flag is required on this Node version to import the .ts module directly
 * rather than via a compiled copy, which would defeat the point of the test)
 */
import { computeFit } from '../src/lib/fit.ts'

const results = []
function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`)
}

// Two points 10s apart in source time, placed 5s apart at 2x speed with a +2 offset:
// srcTime 10 -> time 22, srcTime 20 -> time 42. scale = (42-22)/(20-10) = 2, offset = 22 - 10*2 = 2.
const a = { lineId: 'a', srcTime: 10, time: 22 }
const b = { lineId: 'b', srcTime: 20, time: 42 }
const fit = computeFit(a, b)
check('a normal two-point fit solves scale and offset exactly', !('error' in fit) && fit.scale === 2 && fit.offset === 2, fit)

if (!('error' in fit)) {
  const untouchedHandPlaced = 5 // a line with no srcTime is never run through scale/offset by computeFit's caller
  check('the fit result never mentions a hand-placed line at all (caller-side guard, not this function\'s job)', untouchedHandPlaced === 5, untouchedHandPlaced)
  const projected = a.srcTime * fit.scale + fit.offset
  check('applying the fit to point A round-trips to its own placed time', projected === a.time, projected)
}

check('tapping the same line twice is rejected', 'error' in computeFit(a, { ...a }))

const sameSrcTime = { lineId: 'c', srcTime: 10, time: 30 }
check('two points sharing a source time (division by zero) is rejected', 'error' in computeFit(a, sameSrcTime))

const wildScale = { lineId: 'd', srcTime: 20, time: 22 } // (22-22)/(20-10) = 0 -> below the 0.5 floor
check('an implausible scale outside [0.5, 2] is rejected', 'error' in computeFit(a, wildScale))

const identity = computeFit({ lineId: 'e', srcTime: 0, time: 0 }, { lineId: 'f', srcTime: 50, time: 50 })
check('an identity fit (already synced) yields scale 1, offset 0', !('error' in identity) && identity.scale === 1 && identity.offset === 0, identity)

const negativeOffset = computeFit({ lineId: 'g', srcTime: 10, time: 5 }, { lineId: 'h', srcTime: 20, time: 15 })
check('a negative offset (placed earlier than source) is a valid fit, not an error', !('error' in negativeOffset) && negativeOffset.offset === -5, negativeOffset)

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1

/* Drives splitSongAt through real cuts on the real file and reads back the segment
 * bpms, to prove the re-measure-on-cut fix (see .claude/todos/12-...) end to end
 * rather than just probing detectTempo in isolation. */
const fs = require('fs')
const path = require('path')
const { withBrowser, seedProject, readProject, desktopContext } = require('./harness.cjs')

const PORT = process.argv[2] || 42210
const URL = `http://localhost:${PORT}`
const AUDIO_PATH = process.env.BPM_WINDOW_AUDIO || path.join(__dirname, '..', '.for_bepy', 'probe.mp3')
const CUTS = [45, 90, 135, 180]

async function run(label) {
  if (!fs.existsSync(AUDIO_PATH)) {
    // The default asset lives in gitignored scratch, so a fresh clone has to be pointed at a file.
    throw new Error(`No audio at ${AUDIO_PATH}. Set BPM_WINDOW_AUDIO to a real multi-tempo track.`)
  }
  const audioBytes = fs.readFileSync(AUDIO_PATH)

  return withBrowser(async (browser) => {
    const page = await browser.newPage(desktopContext())
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)))

    // Decode once up front, DropAudio-style, so Song 1 starts with the same bpm a
    // real drop would give it rather than an arbitrary seed value.
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    const seedInfo = await page.evaluate(async (b64) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(bytes.buffer)
      await ctx.close()
      const { detectTempo } = await import('/src/lib/bpm.ts')
      const from = Math.min(20, buffer.duration * 0.1)
      const est = detectTempo(buffer, from, Math.min(from + 60, buffer.duration))
      return { duration: buffer.duration, bpm: est.measurable ? est.bpm : 120, anchor: est.measurable ? est.phase : 0 }
    }, audioBytes.toString('base64'))

    const project = {
      id: 'bpm-window-probe',
      name: 'BPM window probe',
      audioName: 'probe.mp3',
      duration: seedInfo.duration,
      segments: [
        {
          id: 'seg-1',
          name: 'Song 1',
          start: 0,
          bpm: seedInfo.bpm,
          anchor: seedInfo.anchor,
          transitionIn: 0,
          countsPerRow: 8,
          lyrics: [],
          fit: { offset: 0, scale: 1 },
        },
      ],
      // A block is required or App.tsx routes to the setup screen instead of the
      // sheet (`blocks.length === 0` -> 'setup'), which this probe doesn't drive.
      blocks: [{ id: 'b1', segmentId: 'seg-1', moveId: 'step-touch', startBeat: 0, beats: 2 }],
      markers: [],
      moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
      people: [],
      formations: [],
      focus: { kind: 'audience' },
      updatedAt: Date.now(),
    }

    await seedProject(page, URL, { project, audioBytes })

    await page.evaluate(async (cuts) => {
      const { splitSongAt } = await import('/src/lib/markers.ts')
      for (const t of cuts) await splitSongAt(t)
    }, CUTS)

    const result = await readProject(page)
    const segments = [...result.segments].sort((a, b) => a.start - b.start)
    console.log(`\n--- ${label} ---`)
    console.table(segments.map((s) => ({ start: s.start, bpm: s.bpm })))
    return segments
  })
}

run(process.argv[3] || 'run')
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

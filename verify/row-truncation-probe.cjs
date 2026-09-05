/* Regression probe for todo 13: a row cut short must not reserve the empty columns
   past the cut - no grid tracks, no lyric target, no background strip. Seeds an
   8-count/120bpm song cut on beat 13, which truncates its second row to 5 visible
   counts while row 0 stays a full 8. Run: node verify/row-truncation-probe.cjs [port] */
const { withBrowser, desktopContext, seedProject, silentWav, createChecklist } = require('./harness.cjs')

const PORT = process.argv[2] || '42210'
const URL = `http://localhost:${PORT}/`

const PROJECT = {
  id: 'trunc1',
  name: 'Row truncation probe',
  audioName: 'probe.wav',
  duration: 10,
  segments: [
    { id: 's1', name: 'Song A', start: 0, bpm: 120, anchor: 0, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
    // 120 BPM = 0.5s/beat, so starting s2 at 6.5s cuts s1 after beat 13: row 0
    // (beats 0-7) stays a full 8 counts, row 1 (beats 8-15) truncates to 5.
    { id: 's2', name: 'Song B', start: 6.5, bpm: 120, anchor: 6.5, transitionIn: 0, countsPerRow: 8, lyrics: [], fit: { offset: 0, scale: 1 } },
  ],
  blocks: [
    // Beats 10-13: starts inside row 1's visible 5 counts, ends past the cut.
    { id: 'b-straddle', segmentId: 's1', moveId: 'step-touch', startBeat: 10, beats: 4 },
  ],
  moves: [{ id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 }],
  markers: [],
  updatedAt: Date.now(),
}

async function main() {
  const { check, report } = createChecklist()

  await withBrowser(async (browser) => {
    const ctx = await browser.newContext(desktopContext())
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

    await seedProject(page, URL, { project: PROJECT, audioBytes: silentWav(10) })
    await page.waitForSelector('.counts[data-segment-id="s1"][data-row="1"]')

    const m = await page.evaluate(() => {
      const row0 = document.querySelector('.counts[data-segment-id="s1"][data-row="0"]')
      const row1 = document.querySelector('.counts[data-segment-id="s1"][data-row="1"]')
      const row0Rect = row0.getBoundingClientRect()
      const row1Rect = row1.getBoundingClientRect()
      const tracks = (el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
      const cell0 = row0.querySelector('.count-cell').getBoundingClientRect()
      const cell1 = row1.querySelector('.count-cell').getBoundingClientRect()

      // row-lyric is always the counts row's immediately preceding sibling.
      const lyric1 = row1.previousElementSibling
      const lyric1Rect = lyric1.getBoundingClientRect()

      // A point that would have fallen inside the old, unclamped 8-column row,
      // clearly past where the truncated 5-column row now ends.
      const ghostX = row1Rect.left + row0Rect.width * 0.9
      const countsHit = document.elementFromPoint(ghostX, row1Rect.top + row1Rect.height / 2)
      const lyricHit = document.elementFromPoint(ghostX, lyric1Rect.top + lyric1Rect.height / 2)

      const block = document.querySelector('.block[data-block-id="b-straddle"]')

      return {
        row0Cells: row0.querySelectorAll('.count-cell').length,
        row1Cells: row1.querySelectorAll('.count-cell').length,
        row0Tracks: tracks(row0).length,
        row1Tracks: tracks(row1).length,
        row0Width: row0Rect.width,
        row1Width: row1Rect.width,
        cell0Width: cell0.width,
        cell1Width: cell1.width,
        lyric1Width: lyric1Rect.width,
        ghostX,
        row1Right: row1Rect.right,
        countsHitInsideRow1: !!countsHit && countsHit.closest('.counts') === row1,
        lyricHitInsideLyric1: !!lyricHit && lyricHit.closest('.row-lyric') === lyric1,
        blockLeft: block ? parseFloat(block.style.left) : null,
        blockWidth: block ? parseFloat(block.style.width) : null,
      }
    })

    check('row 0 stays a full 8 counts', m.row0Cells === 8, m.row0Cells)
    check('row 1 truncates to 5 counts', m.row1Cells === 5, m.row1Cells)
    check('row 0 grid has 8 tracks', m.row0Tracks === 8, m.row0Tracks)
    check('row 1 grid has only 5 tracks, not 8', m.row1Tracks === 5, m.row1Tracks)
    check(
      'the truncated row box ends at 5/8 width, not the full row',
      Math.abs(m.row1Width - m.row0Width * (5 / 8)) < 1.5,
      `row0=${m.row0Width} row1=${m.row1Width} expected=${m.row0Width * (5 / 8)}`,
    )
    check(
      'a count cell is the same width whether its row is full or truncated',
      Math.abs(m.cell0Width - m.cell1Width) < 1,
      `cell0=${m.cell0Width} cell1=${m.cell1Width}`,
    )
    check(
      'the lyric strip shortens with the counts row beneath it',
      Math.abs(m.lyric1Width - m.row1Width) < 1.5,
      `lyric1=${m.lyric1Width} row1=${m.row1Width}`,
    )
    check(
      'the ghost point is actually past where the truncated row ends (test sanity)',
      m.ghostX > m.row1Right,
      `ghostX=${m.ghostX} row1Right=${m.row1Right}`,
    )
    check('no clickable count cell past the cut', !m.countsHitInsideRow1)
    check('no clickable lyric target past the cut', !m.lyricHitInsideLyric1)
    check(
      'a block straddling the cut still gets a correct left%',
      m.blockLeft !== null && Math.abs(m.blockLeft - 40) < 0.5,
      m.blockLeft,
    )
    check(
      'a block straddling the cut still gets a correct width%, even past 100% where it clips',
      m.blockWidth !== null && Math.abs(m.blockWidth - 80) < 0.5,
      m.blockWidth,
    )
    check('no console or page errors', errors.length === 0, errors.join(' | '))

    await ctx.close()
  })

  report()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

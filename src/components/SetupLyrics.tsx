import { useState } from 'react'
import { audio } from '../lib/audio'
import { segmentEnd } from '../lib/grid'
import { parseLrc, parsePlain, shiftLyrics } from '../lib/lrc'
import { flash, uid, updateSegment } from '../lib/store'
import type { LyricLine, Project, Segment } from '../lib/types'

interface CalPoint {
  lineId: string
  srcTime: number
  time: number
}

/** Same two-point solve as LyricsModal's Calibrate tab: scale from the ratio of
 * placed-time gap to source-time gap, offset from anchoring point A. LyricsModal
 * is off limits to restructure here (the sheet still owns it), so this is a lift
 * of the logic, not a shared import. */
function computeFit(a: CalPoint, b: CalPoint): { offset: number; scale: number } | { error: string } {
  if (a.lineId === b.lineId) return { error: 'Tap two different lines to calibrate.' }
  const dSrc = b.srcTime - a.srcTime
  if (Math.abs(dSrc) < 1e-6) return { error: 'Those two lines share the same source time. Pick lines further apart in the song.' }
  const scale = (b.time - a.time) / dSrc
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 2) {
    return { error: `That works out to a ${Number.isFinite(scale) ? scale.toFixed(2) : '?'}x scale, unlikely to be right. Check you tapped the correct line.` }
  }
  const offset = a.time - a.srcTime * scale
  if (!Number.isFinite(offset)) return { error: 'Could not compute a fit from those points.' }
  return { offset, scale }
}

/**
 * One song's lyric intake: paste, per-line timing, and a two-tap fit - the same
 * primitives LyricsModal exposes, lifted inline so this step never opens a modal
 * on top of itself. Keyed by segment id from the parent, so switching songs always
 * starts this panel with fresh paste/calibration drafts instead of carrying stale ones.
 */
function SongLyricsEditor({ project, segment }: { project: Project; segment: Segment }) {
  const [pasted, setPasted] = useState('')
  const [calA, setCalA] = useState<CalPoint | null>(null)
  const [calB, setCalB] = useState<CalPoint | null>(null)

  const setLyrics = (lyrics: LyricLine[]) =>
    updateSegment(segment.id, { lyrics: [...lyrics].sort((a, b) => a.time - b.time), noLyrics: false })

  function importPaste() {
    const lines = pasted.includes('[') ? shiftLyrics(parseLrc(pasted), segment.start) : parsePlain(pasted)
    if (!lines.length) return flash('Nothing to import')
    setLyrics(lines)
    setPasted('')
    const timed = lines.filter((l) => l.time >= 0).length
    const untimed = lines.length - timed
    flash(untimed ? `${timed} timed, ${untimed} still need timing` : `${timed} timed lines`)
  }

  function updateLine(index: number, patch: Partial<LyricLine>, coalesceKey?: string) {
    updateSegment(
      segment.id,
      { lyrics: [...segment.lyrics.map((l, i) => (i === index ? { ...l, ...patch } : l))].sort((a, b) => a.time - b.time) },
      coalesceKey,
    )
  }

  function addLine() {
    setLyrics([...segment.lyrics, { id: uid(), time: audio.el.currentTime, text: 'New line' }])
  }

  /** First tap of a pair fills point A, second fills B (even the same line - that's
   * a real mistake worth catching), a third tap starts the next pair. */
  function captureCalibration(line: LyricLine) {
    if (line.srcTime === undefined) return
    const point: CalPoint = { lineId: line.id, srcTime: line.srcTime, time: audio.el.currentTime }
    if (calA && calB) {
      setCalA(point)
      setCalB(null)
    } else if (!calA) {
      setCalA(point)
    } else {
      setCalB(point)
    }
  }

  function applyFit(fit: { offset: number; scale: number }) {
    const lyrics = segment.lyrics.map((l) => (l.srcTime === undefined ? l : { ...l, time: l.srcTime * fit.scale + fit.offset }))
    const moved = lyrics.filter((l, i) => l.srcTime !== undefined && Math.abs(l.time - segment.lyrics[i].time) > 0.0005).length
    updateSegment(segment.id, { lyrics: [...lyrics].sort((a, b) => a.time - b.time), fit })
    setCalA(null)
    setCalB(null)
    flash(`Fit applied - ${moved} line${moved === 1 ? '' : 's'} moved.`)
  }

  const calibratable = segment.lyrics.filter((l): l is LyricLine & { srcTime: number } => l.srcTime !== undefined)
  const fitResult = calA && calB ? computeFit(calA, calB) : null
  const proposal = fitResult && !('error' in fitResult) ? fitResult : null
  const segIndex = project.segments.findIndex((s) => s.id === segment.id)
  const segEnd = segmentEnd(project.segments, segIndex, project.duration)
  const preview = proposal ? calibratable.map((l) => ({ before: l.time, after: l.srcTime * proposal.scale + proposal.offset })) : []
  const movedCount = preview.filter((c) => Math.abs(c.after - c.before) > 0.0005).length
  const avgShift = preview.length ? preview.reduce((sum, c) => sum + Math.abs(c.after - c.before), 0) / preview.length : 0
  const outOfBounds = preview.filter((c) => c.after < segment.start || c.after >= segEnd).length

  return (
    <>
      <textarea
        rows={6}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="Paste lyrics here. One line per row, or LRC format with [00:12.34] timestamps."
      />
      <div className="row">
        <button className="primary" onClick={importPaste} disabled={!pasted.trim()}>
          Import {pasted.split('\n').filter((l) => l.trim()).length} lines
        </button>
        <button onClick={addLine}>
          <i className="ph ph-plus i" /> Add line at playhead
        </button>
      </div>

      {segment.lyrics.map((line, i) => (
        <div key={line.id} className="lyric-edit">
          <input
            className="mono"
            type="number"
            step="0.05"
            value={line.time < 0 ? '' : line.time.toFixed(2)}
            placeholder="--"
            onChange={(e) => updateLine(i, { time: Number(e.target.value) })}
          />
          <input value={line.text} onChange={(e) => updateLine(i, { text: e.target.value }, `setup-lyric-text-${line.id}`)} />
          <button className="ghost icon" title="Set to playhead" onClick={() => updateLine(i, { time: audio.el.currentTime })}>
            <i className="ph ph-crosshair" />
          </button>
          <button className="ghost icon" title="Delete line" onClick={() => setLyrics(segment.lyrics.filter((_, j) => j !== i))}>
            <i className="ph ph-x" />
          </button>
        </div>
      ))}
      {!segment.lyrics.length && <p className="muted">No lines yet. Paste above, or play the song and tap "Add line at playhead".</p>}

      {calibratable.length >= 2 && (
        <div className="fit-panel">
          <p className="faint" style={{ fontSize: 11, margin: 0 }}>
            Play the song (Space). When a synced line actually lands, tap its target. Two taps on
            two different lines solve the fit for every line that came in synced.
          </p>
          {calibratable.map((line) => {
            const mark = calA?.lineId === line.id ? 'A' : calB?.lineId === line.id ? 'B' : null
            return (
              <div key={line.id} className="lyric-edit">
                <span className="mono" style={{ width: 46 }}>
                  {line.srcTime.toFixed(2)}
                </span>
                <span style={{ minWidth: 0 }}>{line.text}</span>
                {mark && (
                  <span className="chip">
                    {mark} @ {(mark === 'A' ? calA! : calB!).time.toFixed(2)}s
                  </span>
                )}
                <button className={mark ? 'on' : 'ghost icon'} title="Tap when this line lands" onClick={() => captureCalibration(line)}>
                  <i className="ph ph-target" />
                </button>
              </div>
            )
          })}
          {calA && calB && fitResult && 'error' in fitResult && <p className="muted">{fitResult.error}</p>}
          {proposal && (
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <p className="muted">
                Scale {proposal.scale.toFixed(4)}x, offset {proposal.offset >= 0 ? '+' : ''}
                {proposal.offset.toFixed(2)}s. {movedCount} of {calibratable.length} synced lines move, {avgShift.toFixed(2)}s on
                average.
                {outOfBounds > 0 ? ` ${outOfBounds} would land outside this song's bounds.` : ''}
              </p>
              <div className="row">
                <button className="primary" onClick={() => applyFit(proposal)}>
                  Apply fit
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setCalA(null)
                    setCalB(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * Step 3: one song at a time in cut order, its name and lyric state, with next/back
 * between songs living inside the step (distinct from SetupFlow's own step Back/Next,
 * which moves between Cuts/Beats/Lyrics). "No lyrics for this one" is a first-class
 * one-tap answer since plenty of a medley is instrumental.
 */
export default function SetupLyrics({ project }: { project: Project }) {
  const segments = [...project.segments].sort((a, b) => a.start - b.start)
  const [index, setIndex] = useState(0)
  const clamped = Math.min(index, Math.max(0, segments.length - 1))
  const segment = segments[clamped]

  if (!segment) {
    return (
      <div className="lyrics-step">
        <p className="muted">No songs yet. Add cuts first.</p>
      </div>
    )
  }

  return (
    <div className="lyrics-step">
      <div className="setup-head">
        <button className="ghost icon" disabled={clamped === 0} onClick={() => setIndex(clamped - 1)} title="Previous song">
          <i className="ph ph-caret-left" />
        </button>
        <strong>{segment.name}</strong>
        <span className="faint" style={{ fontSize: 12 }}>
          Song {clamped + 1} of {segments.length}
        </span>
        <div className="spacer" />
        <button className="ghost icon" disabled={clamped === segments.length - 1} onClick={() => setIndex(clamped + 1)} title="Next song">
          <i className="ph ph-caret-right" />
        </button>
      </div>

      <div className="setup-list">
        <div className="setup-card">
          <label className="setup-field">
            Song name
            <input
              className="seg-title"
              value={segment.name}
              onChange={(e) => updateSegment(segment.id, { name: e.target.value }, `setup-lyrics-name-${segment.id}`)}
            />
          </label>
        </div>

        <div className="setup-card lyrics-card">
          {segment.noLyrics ? (
            <div className="row">
              <i className="ph ph-microphone-slash i" />
              <span className="muted" style={{ flex: 1 }}>
                Marked as having no lyrics.
              </span>
              <button className="ghost" onClick={() => updateSegment(segment.id, { noLyrics: false })}>
                Actually, add lyrics
              </button>
            </div>
          ) : (
            <>
              {!segment.lyrics.length && (
                <div className="row">
                  <span className="muted" style={{ flex: 1 }}>
                    No lyrics yet for this song.
                  </span>
                  <button onClick={() => updateSegment(segment.id, { noLyrics: true })}>
                    <i className="ph ph-microphone-slash i" /> No lyrics for this one
                  </button>
                </div>
              )}
              <SongLyricsEditor key={segment.id} project={project} segment={segment} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

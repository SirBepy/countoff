import { useState } from 'react'
import { audio } from '../lib/audio'
import { formatTime, segmentEnd } from '../lib/grid'
import { parseLrc, parsePlain, searchLyrics, shiftLyrics, type LrcResult } from '../lib/lrc'
import { flash, uid, updateSegment } from '../lib/store'
import type { LyricLine, Project, Segment } from '../lib/types'

interface Props {
  project: Project
  segment: Segment
  onClose: () => void
}

interface CalPoint {
  lineId: string
  srcTime: number
  time: number
}

/** Exact two-point solve: scale from the ratio of placed-time gap to source-time
 * gap, offset from anchoring point A. Guards the ways a mistaken tap turns into
 * garbage: same line twice, equal srcTimes (division by zero), or an implausible
 * scale that means the wrong line was tapped. */
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

export default function LyricsModal({ project, segment, onClose }: Props) {
  const [tab, setTab] = useState<'find' | 'paste' | 'edit' | 'fit'>(segment.lyrics.length ? 'edit' : 'find')
  const [query, setQuery] = useState(segment.name)
  const [results, setResults] = useState<LrcResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [pasted, setPasted] = useState('')
  const [calA, setCalA] = useState<CalPoint | null>(null)
  const [calB, setCalB] = useState<CalPoint | null>(null)

  const setLyrics = (lyrics: LyricLine[], coalesceKey?: string) =>
    updateSegment(segment.id, { lyrics: [...lyrics].sort((a, b) => a.time - b.time) }, coalesceKey)

  async function search() {
    setBusy(true)
    try {
      setResults(await searchLyrics(query))
    } catch {
      flash('Could not reach LRCLIB. Paste the lyrics instead.')
    }
    setBusy(false)
  }

  function importResult(row: LrcResult) {
    if (row.syncedLyrics) {
      // LRC times are relative to the original release, so rebase onto this cut.
      const lines = shiftLyrics(parseLrc(row.syncedLyrics), segment.start)
      setLyrics(lines)
      updateSegment(segment.id, { fit: { offset: segment.start, scale: 1 }, lrcSource: `${row.artistName} - ${row.trackName}` })
      flash(`${describeCounts(lines)}. Calibrate two lines to line them up exactly.`)
    } else if (row.plainLyrics) {
      setLyrics(parsePlain(row.plainLyrics))
      flash('Plain lyrics only. Use "Set to playhead" on each line to time them.')
    }
    setTab('edit')
  }

  function nudgeAll(by: number) {
    setLyrics(shiftLyrics(segment.lyrics, by))
    updateSegment(segment.id, { fit: { ...segment.fit, offset: segment.fit.offset + by } })
  }

  function addLine() {
    setLyrics([...segment.lyrics, { id: uid(), time: audio.el.currentTime, text: 'New line' }])
  }

  /** Reports the timed/untimed split after a paste or import, since a silent partial import is the actual defect. */
  function describeCounts(lines: LyricLine[]) {
    const timed = lines.filter((l) => l.time >= 0).length
    const untimed = lines.length - timed
    return untimed ? `${timed} timed, ${untimed} still need timing` : `${timed} timed lines`
  }

  function updateLine(index: number, patch: Partial<LyricLine>, coalesceKey?: string) {
    setLyrics(
      segment.lyrics.map((l, i) => (i === index ? { ...l, ...patch } : l)),
      coalesceKey,
    )
  }

  /** Records the playhead against a synced line: first tap of a pair fills point A,
   * second fills B (even if it's the same line - that's a real mistake worth catching,
   * not something to silently paper over), a third tap starts the next pair. */
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
  const preview = proposal ? calibratable.map((l) => ({ before: l.time, after: l.srcTime * proposal.scale + proposal.offset })) : []
  const movedCount = preview.filter((c) => Math.abs(c.after - c.before) > 0.0005).length
  const avgShift = preview.length ? preview.reduce((sum, c) => sum + Math.abs(c.after - c.before), 0) / preview.length : 0
  const segIndex = project.segments.findIndex((s) => s.id === segment.id)
  const segEnd = segmentEnd(project.segments, segIndex, project.duration)
  const outOfBounds = preview.filter((c) => c.after < segment.start || c.after >= segEnd).length

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className="ph ph-microphone-stage i" /> Lyrics for {segment.name}
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="row">
            {(['find', 'paste', 'edit', 'fit'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : 'ghost'} onClick={() => setTab(t)}>
                {{ find: 'Find online', paste: 'Paste', edit: `Edit (${segment.lyrics.length})`, fit: 'Calibrate' }[t]}
              </button>
            ))}
          </div>

          {tab === 'find' && (
            <>
              <div className="row">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Song name and artist"
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                />
                <button className="primary" onClick={search} disabled={busy}>
                  {busy ? 'Searching...' : 'Search'}
                </button>
              </div>
              <p className="faint" style={{ fontSize: 11, margin: 0 }}>
                Free lyrics from lrclib.net. Results with a clock icon come with timestamps.
              </p>
              {results?.map((row) => (
                <div key={row.id} className="result" onClick={() => importResult(row)}>
                  <i className={`ph ${row.syncedLyrics ? 'ph-clock' : 'ph-text-align-left'} i`} style={{ color: row.syncedLyrics ? 'var(--e1)' : 'var(--text-faint)' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="move-name">{row.trackName}</div>
                    <div className="move-note">
                      {row.artistName}
                      {row.duration ? ` - ${formatTime(row.duration)}` : ''}
                    </div>
                  </div>
                  <i className="ph ph-arrow-right" />
                </div>
              ))}
              {results && !results.length && <p className="muted">No matches. Try the Paste tab.</p>}
            </>
          )}

          {tab === 'paste' && (
            <>
              <textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="One line per row. LRC format with [00:12.34] timestamps also works." />
              <button
                className="primary"
                onClick={() => {
                  const lines = pasted.includes('[') ? shiftLyrics(parseLrc(pasted), segment.start) : parsePlain(pasted)
                  if (!lines.length) return flash('Nothing to import')
                  setLyrics(lines)
                  setTab('edit')
                  flash(describeCounts(lines))
                }}
              >
                Import {pasted.split('\n').filter((l) => l.trim()).length} lines
              </button>
            </>
          )}

          {tab === 'edit' && (
            <>
              <div className="row">
                <span className="muted">Shift all lines</span>
                {[-1, -0.25, 0.25, 1].map((by) => (
                  <button key={by} onClick={() => nudgeAll(by)}>
                    {by > 0 ? `+${by}s` : `${by}s`}
                  </button>
                ))}
                <div className="spacer" />
                <button onClick={addLine}>
                  <i className="ph ph-plus i" /> Add at playhead
                </button>
              </div>
              {segment.lyrics.map((line, i) => (
                <div key={i} className="lyric-edit">
                  <input
                    className="mono"
                    type="number"
                    step="0.05"
                    value={line.time < 0 ? '' : line.time.toFixed(2)}
                    placeholder="--"
                    onChange={(e) => updateLine(i, { time: Number(e.target.value) })}
                  />
                  <input
                    value={line.text}
                    onChange={(e) => updateLine(i, { text: e.target.value }, `lyric-text-${line.id}`)}
                  />
                  <button className="ghost icon" title="Set to playhead" onClick={() => updateLine(i, { time: audio.el.currentTime })}>
                    <i className="ph ph-crosshair" />
                  </button>
                  <button
                    className="ghost icon"
                    title="Delete line"
                    onClick={() => setLyrics(segment.lyrics.filter((_, j) => j !== i))}
                  >
                    <i className="ph ph-x" />
                  </button>
                </div>
              ))}
              {!segment.lyrics.length && <p className="muted">No lines yet.</p>}
            </>
          )}

          {tab === 'fit' && (
            <>
              <p className="faint" style={{ fontSize: 11, margin: 0 }}>
                Play the song. When a synced line actually lands, tap its target. Two taps on two
                different lines solve the fit for every line that came from a synced import.
              </p>
              {calibratable.length < 2 ? (
                <p className="muted">Needs at least two synced lines (import from Find online) to calibrate.</p>
              ) : (
                <>
                  {calibratable.map((line) => {
                    const mark = calA?.lineId === line.id ? 'A' : calB?.lineId === line.id ? 'B' : null
                    return (
                      <div key={line.id} className="lyric-edit">
                        <span className="mono" style={{ width: 46 }}>
                          {line.srcTime.toFixed(2)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>{line.text}</span>
                        {mark && <span className="chip">{mark} @ {(mark === 'A' ? calA! : calB!).time.toFixed(2)}s</span>}
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
                </>
              )}
            </>
          )}
        </div>

        <footer>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

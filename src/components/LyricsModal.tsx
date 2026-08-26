import { useState } from 'react'
import { audio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { parseLrc, parsePlain, searchLyrics, shiftLyrics, type LrcResult } from '../lib/lrc'
import { flash, updateSegment } from '../lib/store'
import type { LyricLine, Segment } from '../lib/types'

interface Props {
  segment: Segment
  onClose: () => void
}

export default function LyricsModal({ segment, onClose }: Props) {
  const [tab, setTab] = useState<'find' | 'paste' | 'edit'>(segment.lyrics.length ? 'edit' : 'find')
  const [query, setQuery] = useState(segment.name)
  const [results, setResults] = useState<LrcResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [pasted, setPasted] = useState('')

  const setLyrics = (lyrics: LyricLine[]) =>
    updateSegment(segment.id, { lyrics: [...lyrics].sort((a, b) => a.time - b.time) })

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
      updateSegment(segment.id, { lyricOffset: segment.start, lrcSource: `${row.artistName} - ${row.trackName}` })
      flash(`${lines.length} timed lines. Nudge the offset until they land.`)
    } else if (row.plainLyrics) {
      setLyrics(parsePlain(row.plainLyrics))
      flash('Plain lyrics only. Use "Set to playhead" on each line to time them.')
    }
    setTab('edit')
  }

  function nudgeAll(by: number) {
    setLyrics(shiftLyrics(segment.lyrics, by))
    updateSegment(segment.id, { lyricOffset: segment.lyricOffset + by })
  }

  function addLine() {
    setLyrics([...segment.lyrics, { time: audio.el.currentTime, text: 'New line' }])
  }

  function updateLine(index: number, patch: Partial<LyricLine>) {
    setLyrics(segment.lyrics.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

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
            {(['find', 'paste', 'edit'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : 'ghost'} onClick={() => setTab(t)}>
                {{ find: 'Find online', paste: 'Paste', edit: `Edit (${segment.lyrics.length})` }[t]}
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
                  <input value={line.text} onChange={(e) => updateLine(i, { text: e.target.value })} />
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

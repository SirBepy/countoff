import { useEffect, useRef, useState } from 'react'
import { audio } from '../lib/audio'
import { bpmFromTaps } from '../lib/bpm'
import { formatTime } from '../lib/grid'
import { flash, removeSegment, updateSegment } from '../lib/store'
import type { Segment } from '../lib/types'

interface Props {
  segment: Segment
  end: number
  selected: boolean
  removable: boolean
  /** True for the opening segment, which has no incoming transition to adjust. */
  first: boolean
  onSelect: () => void
  onEditLyrics: () => void
}

export default function SegmentHeader({ segment, end, selected, removable, first, onSelect, onEditLyrics }: Props) {
  const taps = useRef<number[]>([])
  const [tapping, setTapping] = useState(false)
  const tapStartBpm = useRef<number | null>(null)
  // Eleven controls do not fit a quiet header, so they fold behind the BPM chip and a kebab menu.
  const [openPopover, setOpenPopover] = useState<'bpm' | 'menu' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(segment.name)
  const skipCommit = useRef(false)
  const bpmRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) nameInputRef.current?.select()
  }, [renaming])

  function endTapSession() {
    taps.current = []
    setTapping(false)
    tapStartBpm.current = null
  }

  function closePopover() {
    if (openPopover === 'bpm' && tapping) endTapSession()
    setOpenPopover(null)
  }

  useEffect(() => {
    if (!openPopover) return
    const ref = openPopover === 'bpm' ? bpmRef : menuRef
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) closePopover()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePopover()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openPopover, tapping])

  function tap() {
    const now = performance.now() / 1000
    if (!tapping) tapStartBpm.current = segment.bpm
    // A gap this long means a fresh attempt, not a continuation.
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2) taps.current = []
    taps.current.push(now)
    setTapping(true)
    const bpm = bpmFromTaps(taps.current)
    if (bpm) updateSegment(segment.id, { bpm })
  }

  /** Right-click bails out of a stray tap session and puts the BPM back where it started. */
  function cancelTap(e: React.MouseEvent) {
    e.preventDefault()
    if (!tapping) return
    const revertTo = tapStartBpm.current
    endTapSession()
    if (revertTo !== null) updateSegment(segment.id, { bpm: revertTo })
  }

  function startRename() {
    setNameDraft(segment.name)
    setRenaming(true)
    setOpenPopover(null)
  }

  function commitName() {
    if (skipCommit.current) {
      skipCommit.current = false
    } else if (nameDraft.trim()) {
      updateSegment(segment.id, { name: nameDraft }, `segment-name-${segment.id}`)
    }
    setRenaming(false)
  }

  function onNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') {
      skipCommit.current = true
      setNameDraft(segment.name)
      e.currentTarget.blur()
    }
  }

  const nudgeTransition = (by: number) =>
    updateSegment(segment.id, { transitionIn: Math.max(0, Number((segment.transitionIn + by).toFixed(2))) })

  return (
    <div className="seg-head" onPointerDown={onSelect} style={{ opacity: selected ? 1 : 0.85 }}>
      {renaming ? (
        <input
          ref={nameInputRef}
          className="seg-title"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={onNameKeyDown}
        />
      ) : (
        <span className="seg-title">{segment.name}</span>
      )}

      <span className="seg-time">
        {formatTime(segment.start)} - {formatTime(end)}
      </span>

      <div className="seg-anchor" ref={bpmRef} onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`sm${openPopover === 'bpm' ? ' on' : ''}`}
          onClick={() => setOpenPopover(openPopover === 'bpm' ? null : 'bpm')}
        >
          <i className="ph ph-metronome i" /> {segment.bpm} BPM
        </button>
        {openPopover === 'bpm' && (
          <div className="seg-popover seg-bpm-pop">
            <span className="chip">
              BPM
              <input
                className="mono"
                type="number"
                step="0.1"
                inputMode="decimal"
                value={segment.bpm}
                onChange={(e) => updateSegment(segment.id, { bpm: Number(e.target.value) || segment.bpm })}
                style={{ width: 58 }}
              />
            </span>
            <button className="sm" onClick={() => updateSegment(segment.id, { bpm: segment.bpm / 2 })} title="Halve the tempo">
              ÷2
            </button>
            <button className="sm" onClick={() => updateSegment(segment.id, { bpm: segment.bpm * 2 })} title="Double the tempo">
              ×2
            </button>
            <button
              className={`sm${tapping ? ' on' : ''}`}
              onClick={tap}
              onContextMenu={cancelTap}
              title="Tap 4+ times on the beat. Right-click cancels and restores the BPM; clicking away keeps it."
            >
              <i className="ph ph-hand-tap i" /> Tap tempo
            </button>
            <span className="chip">
              Count in
              <input
                className="mono"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={segment.countsPerRow}
                onChange={(e) =>
                  updateSegment(segment.id, {
                    countsPerRow: Math.max(1, Math.round(Number(e.target.value)) || segment.countsPerRow),
                  })
                }
                style={{ width: 42 }}
              />
            </span>
          </div>
        )}
      </div>

      <div className="seg-anchor" ref={menuRef} onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`ghost sm icon${openPopover === 'menu' ? ' on' : ''}`}
          onClick={() => setOpenPopover(openPopover === 'menu' ? null : 'menu')}
          title="Song actions"
        >
          <i className="ph ph-dots-three-vertical" />
        </button>
        {openPopover === 'menu' && (
          <div className="seg-popover seg-menu">
            <button className="seg-menu-item" onClick={startRename}>
              <i className="ph ph-pencil-simple i" /> Rename
            </button>
            <button
              className="seg-menu-item"
              onClick={() => {
                onEditLyrics()
                setOpenPopover(null)
              }}
            >
              <i className="ph ph-microphone-stage i" /> {segment.lyrics.length ? `${segment.lyrics.length} lines` : 'Lyrics'}
            </button>
            <button
              className="seg-menu-item"
              onClick={() => {
                updateSegment(segment.id, { anchor: audio.el.currentTime })
                flash('Downbeat set to the playhead')
                setOpenPopover(null)
              }}
            >
              <i className="ph ph-crosshair i" /> Set the 1
            </button>
            {!first && (
              <div className="seg-menu-transition">
                <span>Transition {segment.transitionIn.toFixed(1)}s</span>
                <button className="ghost sm icon" onClick={() => nudgeTransition(-0.5)} title="Shorten the transition by 0.5s">
                  <i className="ph ph-caret-left" />
                </button>
                <button className="ghost sm icon" onClick={() => nudgeTransition(0.5)} title="Lengthen the transition by 0.5s">
                  <i className="ph ph-caret-right" />
                </button>
              </div>
            )}
            {removable && (
              <button
                className="seg-menu-item"
                onClick={() => {
                  removeSegment(segment.id)
                  setOpenPopover(null)
                }}
                style={{ color: 'var(--danger)' }}
              >
                <i className="ph ph-trash i" /> Delete song
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

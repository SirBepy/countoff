import { useEffect, useMemo, useRef, useState } from 'react'
import { audio, useAudio } from '../lib/audio'
import { beatAt, orderedMovements, stints } from '../lib/floor'
import { beatDuration, beatToTime, formatTime, segmentEnd } from '../lib/grid'
import { useMenuFit } from '../lib/menuFit'
import { addClip, beginGesture, endGesture, flash, removeClip, set, uid, updateClip, updateTake, useStore } from '../lib/store'
import { dropTake, importTake } from '../lib/takes'
import {
  clipEnd,
  clipLength,
  coveredSeconds,
  fitClip,
  MIN_CLIP,
  orderedClips,
  placedBlocks,
  roomAt,
  takeSrc,
} from '../lib/video'
import type { Clip, Crop, Project, Take } from '../lib/types'
import VideoStage from './VideoStage'

/** 1 fits the whole medley; the top end puts a couple of bars across the screen. */
const ZOOM_MAX = 60
/** A drag under this many pixels is a click, so tapping a clip selects instead of retiming it. */
const DRAG_SLOP = 4
/** Marks a bin drag as one of ours, so the file-upload overlay stays out of its way. */
const TAKE_DRAG = 'application/x-countoff-take'

type Grab = 'body' | 'in' | 'out'

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`

const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

export default function VideoScreen({ project }: { project: Project }) {
  const { time, playing, rate } = useAudio()
  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const [menu, setMenu] = useState<{ clipId: string; x: number; y: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [ghost, setGhost] = useState<number | null>(null)
  // Which take is open in the crop editor, and the rect being dragged there before Save
  // commits it. Null draft means nothing has been drawn yet on a take with no crop.
  const [cropTake, setCropTake] = useState<string | null>(null)
  const [draft, setDraft] = useState<Crop | null>(null)
  const [cropRatio, setCropRatio] = useState(16 / 9)
  const scroll = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const cropArea = useRef<HTMLDivElement>(null)
  const { ref: menuEl, offset } = useMenuFit<HTMLDivElement>(menu)
  const takeUrls = useStore((s) => s.takeUrls)

  const duration = project.duration || 1
  const pct = (t: number) => `${(t / duration) * 100}%`
  const clips = orderedClips(project)
  const clip = clips.find((c) => c.id === selected) ?? null
  const take = clip && project.takes.find((t) => t.id === clip.takeId)
  const moves = useMemo(() => placedBlocks(project), [project])
  const here = beatAt(project, clip ? clip.songStart : time)
  const menuClip = menu ? (clips.find((c) => c.id === menu.clipId) ?? null) : null
  const menuTake = menuClip && project.takes.find((t) => t.id === menuClip.takeId)
  const cropTakeObj = cropTake ? (project.takes.find((t) => t.id === cropTake) ?? null) : null
  const cropSrc = cropTakeObj && takeSrc(cropTakeObj, takeUrls)

  /** A cut needs a clip's worth of footage either side of it, or it makes a sliver. */
  const cuttable = (c: Clip) => time > c.songStart + MIN_CLIP && time < clipEnd(c) - MIN_CLIP

  /** Time under a client x, measured against the track column rather than the whole lane. */
  function timeAt(clientX: number) {
    const track = scroll.current!.querySelector('.vt-track')!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - track.left) / track.width) * duration))
  }

  function enterCrop(t: Take) {
    setCropTake(t.id)
    setDraft(t.crop ?? null)
  }

  /** Point under a client x/y as a 0..1 fraction of the crop box, which is sized to the
   *  take's own ratio so this maps straight onto the source frame with no letterbox math. */
  function cropPointAt(clientX: number, clientY: number) {
    const box = cropArea.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (clientY - box.top) / box.height)),
    }
  }

  /** A pointerdown outside the rect starts a fresh one from that corner. */
  function drawCrop(e: React.PointerEvent) {
    if (e.button === 2) return
    e.preventDefault()
    const start = cropPointAt(e.clientX, e.clientY)
    const move = (ev: PointerEvent) => {
      const cur = cropPointAt(ev.clientX, ev.clientY)
      setDraft({ x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /** Drags the whole rect without resizing it, clamped so it never slides off the frame. */
  function moveCrop(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const base = draft!
    const start = cropPointAt(e.clientX, e.clientY)
    const move = (ev: PointerEvent) => {
      const cur = cropPointAt(ev.clientX, ev.clientY)
      setDraft({
        x: Math.max(0, Math.min(1 - base.w, base.x + (cur.x - start.x))),
        y: Math.max(0, Math.min(1 - base.h, base.y + (cur.y - start.y))),
        w: base.w,
        h: base.h,
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /** Resizes from one corner, holding the opposite corner fixed. */
  function resizeCrop(corner: 'nw' | 'ne' | 'sw' | 'se', e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const base = draft!
    const fixed = { x: corner.includes('w') ? base.x + base.w : base.x, y: corner.includes('n') ? base.y + base.h : base.y }
    const move = (ev: PointerEvent) => {
      const cur = cropPointAt(ev.clientX, ev.clientY)
      setDraft({
        x: Math.min(fixed.x, cur.x),
        y: Math.min(fixed.y, cur.y),
        w: Math.abs(cur.x - fixed.x),
        h: Math.abs(cur.y - fixed.y),
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function saveCrop() {
    if (!cropTake || !draft) return
    updateTake(cropTake, { crop: draft })
    setCropTake(null)
  }

  function clearCrop() {
    if (!cropTake) return
    updateTake(cropTake, { crop: undefined })
    setCropTake(null)
  }

  /** Counts are what a dancer hears, so a drag lands on one unless snapping is off. */
  function maybeSnap(t: number) {
    if (!snap) return t
    const at = beatAt(project, t)
    return at ? Math.max(0, beatToTime(at.segment, at.beat)) : t
  }

  function scrub(e: React.PointerEvent) {
    if (e.button === 2) return
    e.preventDefault()
    audio.seek(timeAt(e.clientX))
    const move = (ev: PointerEvent) => audio.seek(timeAt(ev.clientX))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /** The body slides a clip along the song; the out handle is when it cuts out; the in
   *  handle trims the head, moving song start and source in-point together at 1x. */
  function grab(c: Clip, how: Grab, e: React.PointerEvent) {
    if (e.button === 2) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(c.id)
    const startX = e.clientX
    const key = `clip-${c.id}-${how}`
    const source = project.takes.find((t) => t.id === c.takeId)
    let moved = false

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_SLOP) return
      if (!moved) beginGesture(key)
      moved = true
      const delta = timeAt(ev.clientX) - timeAt(startX)

      if (how === 'body') {
        const songStart = Math.max(0, Math.min(maybeSnap(c.songStart + delta), duration - clipLength(c)))
        return updateClip(c.id, { songStart }, key)
      }
      if (how === 'in') {
        // Head trim cannot pass the tail, and cannot ask for footage before the file starts.
        const room = clipLength(c) - MIN_CLIP
        const shift = Math.max(-Math.min(c.srcIn, c.songStart), Math.min(maybeSnap(c.songStart + delta) - c.songStart, room))
        return updateClip(c.id, { songStart: c.songStart + shift, srcIn: c.srcIn + shift }, key)
      }
      const limit = Math.min(source ? source.duration : Infinity, c.srcIn + roomAt(project, c.songStart, c.id))
      const srcOut = Math.max(c.srcIn + MIN_CLIP, Math.min(c.srcIn + (maybeSnap(clipEnd(c) + delta) - c.songStart), limit))
      updateClip(c.id, { srcOut }, key)
    }
    const stop = () => {
      if (!moved) audio.seek(c.songStart)
      endGesture()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /** Lays a take down, trimmed to whatever gap is actually free there. The playhead is
   *  where the bin's button drops it; a drag onto the lane names its own time. */
  function lay(source: Take, at = time) {
    const fitted = fitClip(project, source, maybeSnap(at), uid())
    if (!fitted) return flash('No room here, the next clip starts too soon')
    addClip(fitted)
    setSelected(fitted.id)
  }

  /** Cuts a clip in two at the playhead, so one take can carry two moments. With no clip
   *  named it takes whichever one the playhead is inside, so nothing has to be selected. */
  function split(target?: Clip) {
    const cut = target ?? clips.find(cuttable)
    if (!cut || !cuttable(cut)) return flash('Put the playhead inside the clip first')
    const at = cut.srcIn + (time - cut.songStart)
    const tail: Clip = { id: uid(), takeId: cut.takeId, songStart: time, srcIn: at, srcOut: cut.srcOut }
    updateClip(cut.id, { srcOut: at })
    addClip(tail)
    setSelected(tail.id)
  }

  function erase(id: string) {
    removeClip(id)
    if (selected === id) setSelected(null)
  }

  async function pick(files: FileList | null) {
    for (const file of Array.from(files ?? [])) await importTake(file)
    if (picker.current) picker.current.value = ''
  }

  // No dependency array: the blade reads the playhead, which moves every frame. Capture
  // phase, so the Escape that shuts the menu never also walks back to the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if (e.key === 'Escape' && menu) {
        e.stopPropagation()
        return setMenu(null)
      }
      if (e.key === 'Escape' && cropTake) {
        e.stopPropagation()
        return setCropTake(null)
      }
      // The sheet already owns 's' for splitting the song, so the blade takes its own key.
      if (e.key.toLowerCase() === 'b') split()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const covered = coveredSeconds(project)

  return (
    <div
      className="app video-view"
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setImporting(true)
      }}
      onDragLeave={(e) => {
        // relatedTarget is where the pointer went; still inside means this was a child
        // boundary, not the screen edge, and the overlay would otherwise flicker.
        if (hasFiles(e) && !e.currentTarget.contains(e.relatedTarget as Node)) setImporting(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setImporting(false)
        void pick(e.dataTransfer.files)
      }}
    >
      <div className="appbar">
        <button className="ghost icon" onClick={() => set({ view: 'sheet' }, false)} title="Back to the sheet">
          <i className="ph ph-caret-left i" />
        </button>
        <div className="brand">
          <span className="dot" /> Video
        </div>
        <span className="chip only-wide">
          <i className="ph ph-film-strip i" /> {project.takes.length} takes
        </span>
        <span className="chip only-wide">
          <i className="ph ph-scissors i" /> {project.clips.length} clips
        </span>
        <span className="chip only-wide">
          <i className="ph ph-percent i" /> covers {formatTime(covered)} of {formatTime(duration)}
        </span>
        <div className="spacer" />
        <button
          className={snap ? 'on' : ''}
          onClick={() => setSnap(!snap)}
          title="Land drags and trims on the nearest count instead of the nearest frame"
        >
          <i className="ph ph-magic-wand i" /> Snap to counts
        </button>
        <button className="primary" onClick={() => picker.current?.click()}>
          <i className="ph ph-plus i" /> Add video
        </button>
        <input
          ref={picker}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => void pick(e.target.files)}
        />
      </div>

      <div className="vs-top">
        <div className="vs-monitor">
        <VideoStage project={project} time={time} playing={playing} rate={rate}>
          <div className="vs-badges">
            {here && (
              <span>
                <i className="ph ph-music-notes" /> {here.segment.name} · count{' '}
                <b>{(here.beat % here.segment.countsPerRow) + 1}</b>
              </span>
            )}
            {(() => {
              const showing = clips.find((c) => time >= c.songStart && time < clipEnd(c))
              return showing ? <span className="cut">cuts out in {formatTime(clipEnd(showing) - time)}</span> : null
            })()}
          </div>
        </VideoStage>
        </div>

        <div className="vs-bin">
          <h3>Takes</h3>
          <div className="vs-takes">
            {project.takes.map((t) => (
              <div
                key={t.id}
                className="vs-take"
                draggable
                title="Drag onto the Video lane, or use the button to drop it at the playhead"
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAKE_DRAG, t.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={() => setGhost(null)}
              >
                <span className="thumb">
                  <i className="ph ph-play" />
                </span>
                <span className="t">
                  <b>{t.name}</b>
                  <span>
                    {formatTime(t.duration)} · {mb(t.bytes)}
                  </span>
                </span>
                <button className="ghost icon" title="Lay this take at the playhead" onClick={() => lay(t)}>
                  <i className="ph ph-arrow-fat-down" />
                </button>
                <button
                  className={`ghost icon${t.crop ? ' on' : ''}`}
                  title="Crop this take's footage"
                  onClick={() => enterCrop(t)}
                >
                  <i className="ph ph-crop" />
                </button>
                <button className="ghost icon" title="Remove this take and its clips" onClick={() => void dropTake(t.id)}>
                  <i className="ph ph-trash" />
                </button>
              </div>
            ))}
          </div>
          <div
            className="vs-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void pick(e.dataTransfer.files)
            }}
            onClick={() => picker.current?.click()}
          >
            <i className="ph ph-upload-simple" />
            Drop a video here, then send it to the playhead
          </div>
        </div>
      </div>

      <div className="vs-insp">
        {clip && take ? (
          <>
            <i className="ph ph-scissors head" />
            <div className="f">
              <label>Source</label>
              <span className="v src">{take.name}</span>
            </div>
            <div className="f">
              <label>From</label>
              <span className="v">{formatTime(clip.srcIn)}</span>
            </div>
            <div className="f">
              <label>To</label>
              <span className="v">{formatTime(clip.srcOut)}</span>
            </div>
            <div className="f">
              <label>Starts on song</label>
              <span className="v">{formatTime(clip.songStart)}</span>
            </div>
            <div className="f">
              <label>Length</label>
              <span className="v">{formatTime(clipLength(clip))}</span>
            </div>
            {here && (
              <div className="f">
                <label>Lands on</label>
                <span className="v">count {(here.beat % here.segment.countsPerRow) + 1}</span>
              </div>
            )}
          </>
        ) : (
          <span className="faint">
            {project.takes.length
              ? 'Right-click a clip to cut or delete it, or drag a take onto the track.'
              : 'Add a video, then drag it onto the track or send it down at the playhead.'}
          </span>
        )}
        <div className="spacer" />
        <button onClick={() => split()} title="Cut the clip under the playhead in two (B)">
          <i className="ph ph-arrows-in-line-vertical i" /> Split at playhead
        </button>
        {clip && (
          <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => erase(clip.id)}>
            <i className="ph ph-trash i" /> Delete clip
          </button>
        )}
      </div>

      <div
        className="vt"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setZoom(Math.max(1, Math.min(ZOOM_MAX, zoom * (e.deltaY < 0 ? 1.25 : 0.8))))
        }}
      >
        <div className="vt-scroll" ref={scroll}>
          <div className="vt-inner" style={{ width: `calc(var(--who) + (100% - var(--who)) * ${zoom})` }}>
            <div className="vt-lane vt-ruler">
              <div className="vt-who" />
              <div className="vt-track" onPointerDown={scrub}>
                {project.segments.map((seg, i) => {
                  const end = segmentEnd(project.segments, i, duration)
                  const bar = beatDuration(seg.bpm) * seg.countsPerRow
                  const bars = Math.floor((end - seg.anchor) / bar)
                  const step = Math.max(1, Math.ceil(bars / (12 * zoom)))
                  return (
                    <span key={seg.id} className="vt-seg" style={{ left: pct(seg.start), width: pct(end - seg.start) }}>
                      <b>{seg.name}</b>
                      {Array.from({ length: Math.floor(bars / step) }, (_, n) => {
                        const at = seg.anchor + (n + 1) * step * bar
                        return (
                          <i key={n} className="vt-bar" style={{ left: `${((at - seg.start) / (end - seg.start)) * 100}%` }}>
                            {(n + 1) * step + 1}
                          </i>
                        )
                      })}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="vt-lane vt-video">
              <div className="vt-who">
                <i className="ph ph-film-strip di" />
                <span className="nm">Video</span>
              </div>
              <div
                className="vt-track"
                onPointerDown={scrub}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(TAKE_DRAG)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setGhost(maybeSnap(timeAt(e.clientX)))
                }}
                onDragLeave={() => setGhost(null)}
                onDrop={(e) => {
                  const source = project.takes.find((t) => t.id === e.dataTransfer.getData(TAKE_DRAG))
                  setGhost(null)
                  if (!source) return
                  e.preventDefault()
                  lay(source, timeAt(e.clientX))
                }}
              >
                {ghost !== null && <span className="vt-ghost" style={{ left: pct(ghost) }} />}
                {clips.map((c) => {
                  const source = project.takes.find((t) => t.id === c.takeId)
                  return (
                    <span
                      key={c.id}
                      className={`vt-clip${c.id === selected ? ' sel' : ''}`}
                      style={{ left: pct(c.songStart), width: pct(clipLength(c)) }}
                      title={`${source?.name ?? 'missing take'} · ${formatTime(c.srcIn)}–${formatTime(c.srcOut)}. Right-click to cut or delete.`}
                      onPointerDown={(e) => grab(c, 'body', e)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setSelected(c.id)
                        setMenu({ clipId: c.id, x: e.clientX, y: e.clientY })
                      }}
                    >
                      <span className="h l" onPointerDown={(e) => grab(c, 'in', e)} />
                      <span className="lab">
                        <b>{source?.name ?? 'missing take'}</b>
                        <span>
                          {formatTime(c.srcIn)} – {formatTime(c.srcOut)}
                        </span>
                      </span>
                      <span className="h r" onPointerDown={(e) => grab(c, 'out', e)} />
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="vt-lane moves">
              <div className="vt-who">
                <i className="ph ph-sneaker-move di" />
                <span className="nm">Moves</span>
              </div>
              <div className="vt-track" onPointerDown={scrub}>
                {moves.map((m) => (
                  <span
                    key={m.id}
                    className={`vt-move e${m.energy}${m.comment ? ' comment' : ''}`}
                    style={{ left: pct(m.from), width: pct(m.to - m.from) }}
                    title={`${m.name} from ${formatTime(m.from)}`}
                  >
                    <b>{m.name}</b>
                  </span>
                ))}
              </div>
            </div>

            {project.people.map((person) => (
              <div key={person.id} className="vt-lane">
                <div className="vt-who">
                  <span className="disc" style={{ background: person.colour }}>
                    {person.initials}
                  </span>
                  <span className="nm">{person.name}</span>
                </div>
                <div className="vt-track" onPointerDown={scrub}>
                  {stints(project, person.id).map((run, n) => (
                    <span
                      key={n}
                      className="vt-hold"
                      style={{ left: pct(run.from), width: pct(run.to - run.from), background: person.colour }}
                    />
                  ))}
                  {orderedMovements(project, person.id).map(({ movement, arrive, depart }) => (
                    <span
                      key={movement.id}
                      className="vt-walk"
                      style={{ left: pct(depart), width: pct(arrive - depart), background: person.colour }}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="vt-playhead" style={{ left: `calc(var(--who) + (100% - var(--who)) * ${time / duration})` }} />
          </div>
        </div>
      </div>

      <div className="vs-trans">
        <button className="icon" onClick={() => audio.nudge(-5)}>
          <i className="ph ph-rewind" />
        </button>
        <button className="primary icon" onClick={() => audio.toggle()}>
          <i className={`ph ${playing ? 'ph-pause' : 'ph-play'}`} />
        </button>
        <button className="icon" onClick={() => audio.nudge(5)}>
          <i className="ph ph-fast-forward" />
        </button>
        <span className="faint mono">{formatTime(time)}</span>
      </div>

      {menuClip && menu && (
        <>
          <div className="mv-menu-back" onPointerDown={() => setMenu(null)} onContextMenu={() => setMenu(null)} />
          <div className="mv-menu" ref={menuEl} style={{ left: menu.x + offset.dx, top: menu.y + offset.dy }}>
            <div className="mh">{menuTake?.name ?? 'missing take'}</div>
            <button className="mi" disabled={!cuttable(menuClip)} onClick={() => (split(menuClip), setMenu(null))}>
              <i className="ph ph-arrows-in-line-vertical" />
              Split at playhead
              <span className="k">B</span>
            </button>
            <button className="mi danger" onClick={() => (erase(menuClip.id), setMenu(null))}>
              <i className="ph ph-trash" />
              Delete clip
            </button>
          </div>
        </>
      )}

      {importing && (
        <div className="vs-dropall">
          <i className="ph ph-upload-simple" />
          <b>Drop to add footage</b>
        </div>
      )}

      {cropTakeObj && (
        <div className="vs-cropmodal">
          <div className="vs-crop" ref={cropArea} style={{ '--car': cropRatio } as React.CSSProperties} onPointerDown={drawCrop}>
            {cropSrc && (
              <video
                src={cropSrc}
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  v.currentTime = Math.min(1, v.duration / 2)
                  if (v.videoWidth && v.videoHeight) setCropRatio(v.videoWidth / v.videoHeight)
                }}
              />
            )}
            {draft && (
              <div
                className="vs-croprect"
                style={{
                  left: `${draft.x * 100}%`,
                  top: `${draft.y * 100}%`,
                  width: `${draft.w * 100}%`,
                  height: `${draft.h * 100}%`,
                }}
                onPointerDown={moveCrop}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                  <span key={c} className={`h ${c}`} onPointerDown={(e) => resizeCrop(c, e)} />
                ))}
              </div>
            )}
          </div>
          <div className="vs-croptools">
            <span className="faint">Drag out a rect over the frame it should show, then save.</span>
            <div className="spacer" />
            {cropTakeObj.crop && (
              <button className="ghost" onClick={clearCrop}>
                <i className="ph ph-arrow-counter-clockwise i" /> Clear crop
              </button>
            )}
            <button className="ghost" onClick={() => setCropTake(null)}>
              Cancel
            </button>
            <button className="primary" disabled={!draft || draft.w < 0.02 || draft.h < 0.02} onClick={saveCrop}>
              <i className="ph ph-check i" /> Save crop
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

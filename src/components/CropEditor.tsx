import { useRef, useState } from 'react'
import { takeSrc } from '../lib/video'
import type { Crop, Take } from '../lib/types'

interface Props {
  take: Take
  takeUrls: Record<string, string>
  onSave: (crop: Crop) => void
  onClear: () => void
  onClose: () => void
}

/** Draws or drags a crop rect over a still of the take's frame. Owns the in-progress
 *  rect until Save commits it; VideoScreen only tracks which take is open. */
export default function CropEditor({ take, takeUrls, onSave, onClear, onClose }: Props) {
  const [draft, setDraft] = useState<Crop | null>(take.crop ?? null)
  const [cropRatio, setCropRatio] = useState(16 / 9)
  const cropArea = useRef<HTMLDivElement>(null)
  const src = takeSrc(take, takeUrls)

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

  return (
    <div className="vs-cropmodal">
      <div className="vs-crop" ref={cropArea} style={{ '--car': cropRatio } as React.CSSProperties} onPointerDown={drawCrop}>
        {src && (
          <video
            src={src}
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
        {take.crop && (
          <button className="ghost" onClick={onClear}>
            <i className="ph ph-arrow-counter-clockwise i" /> Clear crop
          </button>
        )}
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" disabled={!draft || draft.w < 0.02 || draft.h < 0.02} onClick={() => draft && onSave(draft)}>
          <i className="ph ph-check i" /> Save crop
        </button>
      </div>
    </div>
  )
}

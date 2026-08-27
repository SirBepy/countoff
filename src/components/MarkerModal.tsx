import { audio } from '../lib/audio'
import { formatTime } from '../lib/grid'
import { MARKER_COLOUR, MARKER_ICON } from '../lib/markers'
import { removeMarker, updateMarker } from '../lib/store'
import type { Marker } from '../lib/types'

const NUDGES = [-1, -0.1, 0.1, 1]

export default function MarkerModal({ marker, onClose }: { marker: Marker; onClose: () => void }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <i className={`ph ${MARKER_ICON} i`} style={{ color: MARKER_COLOUR }} />
          Marker
          <div className="spacer" />
          <button className="ghost icon" onClick={onClose}>
            <i className="ph ph-x" />
          </button>
        </header>

        <div className="content">
          <div className="field">
            <label>Label</label>
            <input
              autoFocus
              value={marker.label}
              onChange={(e) => updateMarker(marker.id, { label: e.target.value }, `marker-label-${marker.id}`)}
            />
          </div>

          <div className="field">
            <label>At {formatTime(marker.time)} ({marker.time.toFixed(2)}s)</label>
            <div className="row wrap">
              <button onClick={() => audio.seek(Math.max(0, marker.time - 2))}>
                <i className="ph ph-play i" /> Listen
              </button>
              <button onClick={() => updateMarker(marker.id, { time: audio.el.currentTime })}>
                <i className="ph ph-crosshair i" /> Set to playhead
              </button>
              {NUDGES.map((by) => (
                <button key={by} onClick={() => updateMarker(marker.id, { time: Math.max(0, marker.time + by) })}>
                  {by > 0 ? `+${by}s` : `${by}s`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer>
          <button
            className="ghost"
            style={{ color: 'var(--danger)', marginRight: 'auto' }}
            onClick={() => {
              removeMarker(marker.id)
              onClose()
            }}
          >
            <i className="ph ph-trash i" /> Delete
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

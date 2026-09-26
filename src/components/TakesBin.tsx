import { formatTime } from '../lib/grid'
import { dropTake } from '../lib/takes'
import type { Take } from '../lib/types'

/** Marks a bin drag as one of ours, so the file-upload overlay stays out of its way.
 *  Shared with VideoScreen's clip track, which is the drop target for this drag. */
export const TAKE_DRAG = 'application/x-countoff-take'

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`

interface Props {
  takes: Take[]
  /** Lays the take at the playhead; needs VideoScreen's own time/snap state to place it. */
  onLay: (take: Take) => void
  /** Opens the crop editor; VideoScreen tracks which take is open. */
  onCrop: (take: Take) => void
  /** Imports dropped files through the single file-picker input VideoScreen's appbar
   *  button also shares, so a chosen file always clears the same input afterwards. */
  onImport: (files: FileList | null) => void
  /** Clicks that same shared input open. */
  onPickFile: () => void
  /** Clears the clip track's drop-preview ghost, which this bin's drag can end without
   *  ever crossing the track. */
  onDragEnd: () => void
}

/** The take list: drags a take onto the clip track, drops or picks new footage in,
 *  and opens the crop editor per take. Owns none of the state it hands off - that
 *  lives in VideoScreen, which is why every action here is a callback prop. */
export default function TakesBin({ takes, onLay, onCrop, onImport, onPickFile, onDragEnd }: Props) {
  return (
    <div className="vs-bin">
      <h3>Takes</h3>
      <div className="vs-takes">
        {takes.map((t) => (
          <div
            key={t.id}
            className="vs-take"
            draggable
            title="Drag onto the Video lane, or use the button to drop it at the playhead"
            onDragStart={(e) => {
              e.dataTransfer.setData(TAKE_DRAG, t.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onDragEnd={onDragEnd}
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
            <button className="ghost icon" title="Lay this take at the playhead" onClick={() => onLay(t)}>
              <i className="ph ph-arrow-fat-down" />
            </button>
            <button
              className={`ghost icon${t.crop ? ' on' : ''}`}
              title="Crop this take's footage"
              onClick={() => onCrop(t)}
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
          onImport(e.dataTransfer.files)
        }}
        onClick={onPickFile}
      >
        <i className="ph ph-upload-simple" />
        Drop a video here, then send it to the playhead
      </div>
    </div>
  )
}

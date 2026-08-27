import { audio } from '../lib/audio'
import { beatToTime } from '../lib/grid'
import { removeBlocks, set, useStore } from '../lib/store'
import type { Project } from '../lib/types'

/**
 * The bridge between picking counts and picking a move. On a phone the library
 * is a closed sheet, so without this there is no path from a selection to a fill.
 */
export default function SelectionBar({ project }: { project: Project }) {
  const selection = useStore((s) => s.selection)
  if (!selection) return null

  const segment = project.segments.find((s) => s.id === selection.segmentId)
  const first = selection.startBeat % (segment?.countsPerRow ?? 8)
  const covered = project.blocks.filter(
    (b) =>
      b.segmentId === selection.segmentId &&
      b.startBeat < selection.startBeat + selection.beats &&
      b.startBeat + b.beats > selection.startBeat,
  )

  return (
    <div className="selbar">
      <span className="count mono">
        {selection.beats === 1 ? `count ${first + 1}` : `${selection.beats} counts`}
      </span>
      <button className="primary" onClick={() => set({ libraryOpen: true }, false)}>
        <i className="ph ph-person-simple-walk i" /> Fill with a move
      </button>
      {segment && (
        <button
          className="ghost icon"
          title="Loop this selection"
          onClick={() => {
            audio.setLoop({
              from: beatToTime(segment, selection.startBeat),
              to: beatToTime(segment, selection.startBeat + selection.beats),
            })
            audio.seek(beatToTime(segment, selection.startBeat))
            audio.play()
          }}
        >
          <i className="ph ph-repeat" />
        </button>
      )}
      <button
        className="ghost icon"
        disabled={!covered.length}
        title="Clear the moves in this selection"
        onClick={() => removeBlocks(covered.map((b) => b.id))}
      >
        <i className="ph ph-eraser" />
      </button>
      <div className="spacer" />
      <button className="ghost icon" title="Deselect" onClick={() => set({ selection: null }, false)}>
        <i className="ph ph-x" />
      </button>
    </div>
  )
}

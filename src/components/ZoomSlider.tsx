import { clampZoom, sliderFromZoom, ZOOM_MAX, ZOOM_MIN, zoomFromSlider } from '../lib/timeline'

interface Props {
  zoom: number
  onZoom: (zoom: number) => void
}

/** A timeline's zoom as a control rather than a gesture. Ctrl or Cmd and scroll still
 *  works on both timelines; it is no longer the only way in, which it was on a trackpad
 *  that reads the same gesture as a page zoom. */
export default function ZoomSlider({ zoom, onZoom }: Props) {
  return (
    <span className="step zoomer">
      <button
        className="ghost icon"
        title="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoom(clampZoom(zoom / 1.6))}
      >
        <i className="ph ph-magnifying-glass-minus" />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={sliderFromZoom(zoom)}
        title="Drag to zoom the timeline around the playhead"
        onChange={(e) => onZoom(zoomFromSlider(Number(e.target.value)))}
      />
      <button
        className="ghost icon"
        title="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(clampZoom(zoom * 1.6))}
      >
        <i className="ph ph-magnifying-glass-plus" />
      </button>
      <b>{zoom < 1.05 ? 'fit' : `${Math.round(zoom)}×`}</b>
    </span>
  )
}

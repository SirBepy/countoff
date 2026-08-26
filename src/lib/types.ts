export type MoveId = string

export interface Move {
  id: MoveId
  name: string
  beats: number
  /** 1 chill, 2 medium, 3 big. Drives the block colour so the sheet reads as a shape. */
  energy: 1 | 2 | 3
  note?: string
  /** Set when the user records or uploads a clip; the blob itself lives in IndexedDB. */
  hasClip?: boolean
  builtin?: boolean
}

export interface LyricLine {
  /** Seconds into the audio file, already offset-corrected on load. */
  time: number
  text: string
}

/** One song inside the medley. Cut markers are the boundaries between segments. */
export interface Segment {
  id: string
  name: string
  /** Seconds into the audio file where this song starts. */
  start: number
  bpm: number
  /** Absolute time of the first downbeat at or after `start`. */
  anchor: number
  beatsPerBar: number
  lyrics: LyricLine[]
  /** Applied when importing from LRCLIB, kept so the user can re-nudge later. */
  lyricOffset: number
  lrcSource?: string
}

export type MarkerKind = 'transition' | 'drop' | 'break' | 'cue'

/**
 * A moment worth choreographing to: a twirl over a DJ blend, a riser, a drop.
 * A segment boundary is different, it starts a song with its own tempo.
 */
export interface Marker {
  id: string
  time: number
  kind: MarkerKind
  label: string
}

export interface Block {
  id: string
  segmentId: string
  moveId: MoveId
  /** Beat index relative to the segment's anchor. */
  startBeat: number
  beats: number
}

export interface Project {
  id: string
  name: string
  audioName: string
  duration: number
  segments: Segment[]
  blocks: Block[]
  moves: Move[]
  markers: Marker[]
  updatedAt: number
}

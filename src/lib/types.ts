export type MoveId = string

export interface Move {
  id: MoveId
  name: string
  beats: number
  /** 1 chill, 2 medium, 3 big. Drives the block colour so the sheet reads as a shape. */
  energy: 1 | 2 | 3
  note?: string
  /** Link to a demo video (e.g. YouTube), shared by every placement of this move. */
  videoUrl?: string
  builtin?: boolean
  /** Manual rail position from dragging to reorder; absent until the first drag. */
  order?: number
}

export interface LyricLine {
  id: string
  /** Seconds into the audio file. */
  time: number
  text: string
  /** Time in the source track's own timeline, kept so a re-fit stays lossless. Absent on hand-placed lines. */
  srcTime?: number
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
  /** Seconds of blend before this song takes over; 0 on the first segment. */
  transitionIn: number
  /** The row/count unit for this song, e.g. 8 for an 8-count, 6 for a 6-count. */
  countsPerRow: number
  lyrics: LyricLine[]
  /** Maps a line's `srcTime` onto this cut: placed time = srcTime * scale + offset.
   * Lines with no `srcTime` (hand-placed) are never touched by it. */
  fit: { offset: number; scale: number }
  lrcSource?: string
}

/**
 * A moment worth choreographing to: a twirl over a DJ blend, a riser, a drop.
 * A segment boundary is different, it starts a song with its own tempo.
 */
export interface Marker {
  id: string
  time: number
  label: string
}

export interface Block {
  id: string
  segmentId: string
  /** Absent on a comment: a block that spans counts carrying only its `note`. */
  moveId?: MoveId
  /** Beat index relative to the segment's anchor. */
  startBeat: number
  beats: number
  /** Annotates this one placement, unlike `Move.note` which is shared by every copy.
   * On a comment block it is the whole content, not an annotation. */
  note?: string
}

/** A block with no move is a comment; its `note` is the text on the sheet. */
export const isComment = (block: Block) => !block.moveId

/** Someone dancing. Colour and initials are what identify them on the floor at a glance. */
export interface Person {
  id: string
  name: string
  /** Up to two characters on the puck, seeded from the name but editable for two Anas. */
  initials: string
  colour: string
}

/** One person getting somewhere. `beat` is the arrival, not the departure: the walk
 *  is fitted into the `travel` counts in front of it. A null `to` walks them off. */
export interface Movement {
  id: string
  personId: string
  segmentId: string
  /** Beat index relative to the segment's anchor, like `Block.startBeat`. */
  beat: number
  travel: number
  to: { col: number; row: number } | null
  note?: string
}

export interface FloorSize {
  cols: number
  rows: number
}

/** What the dancers face: a crowd along the front edge, or one seated person. */
export type Focus = { kind: 'audience' } | { kind: 'person'; name: string; col: number; row: number }

export interface Project {
  id: string
  name: string
  audioName: string
  duration: number
  segments: Segment[]
  blocks: Block[]
  moves: Move[]
  markers: Marker[]
  people: Person[]
  movements: Movement[]
  floor: FloorSize
  /** Counts a new movement's walk takes, until that one is retimed. */
  walkCounts: number
  focus: Focus
  updatedAt: number
}

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

/** A named edge of the floor, in the vocabulary of what is drawn on screen: back is
 *  row 0, front the row nearest the audience, left and right the drawn sides. */
export type Side = 'back' | 'front' | 'left' | 'right'

/** Someone dancing. Colour and initials are what identify them on the floor at a glance. */
export interface Person {
  id: string
  name: string
  /** Up to two characters on the puck, seeded from the name but editable for two Anas. */
  initials: string
  colour: string
  /** This dancer's default wing, until one movement overrides it. Absent picks the nearest edge. */
  side?: Side
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
  /** Overrides `Person.side` for this one entrance or exit. */
  side?: Side
}

export interface FloorSize {
  cols: number
  rows: number
}

/** The chair being wheeled somewhere mid-number. Same shape as `Movement` minus the
 *  dancer, and `to` is never null: a chair has nowhere to walk off to. */
export interface FocusKey {
  id: string
  segmentId: string
  /** Beat index relative to the segment's anchor, like `Movement.beat`. */
  beat: number
  travel: number
  to: { col: number; row: number }
}

/** What the dancers face: a crowd along the front edge, or one seated person. `col`/`row`
 *  is where that chair starts; `keys` moves it from there, and its absence is the whole
 *  migration story for a project saved before the chair could move. */
export type Focus =
  | { kind: 'audience' }
  | { kind: 'person'; name: string; col: number; row: number; keys?: FocusKey[] }

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
  /** Timeline lanes kept in view while the rest scroll. Person ids, plus `moves`. */
  pinned: string[]
  focus: Focus
  /** Present once this project has been shared: the unguessable path segment in /v/<token>. */
  shareToken?: string
  updatedAt: number
}

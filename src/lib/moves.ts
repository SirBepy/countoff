import type { Move, MoveShape, MoveTurn } from './types'

/** How a move reads on the floor: the figure its puck draws, and any turn it carries.
 *  Sits ahead of `note` because almost every move sets one and almost none sets both. */
interface Reads {
  shape?: MoveShape
  turn?: MoveTurn
}

const m = (id: string, name: string, beats: number, energy: 1 | 2 | 3, reads: Reads = {}, note?: string): Move => ({
  id,
  name,
  beats,
  energy,
  note,
  builtin: true,
  ...reads,
})

/** Anyone can do these after one showing, which is the bar for a wedding crowd. */
export const GENERIC_MOVES: Move[] = [
  m('bounce', 'Bounce', 1, 1, { shape: 'bounce' }, 'Knees only, stay in place'),
  m('clap', 'Clap', 1, 1, { shape: 'pulse' }),
  m('step-touch', 'Step touch', 2, 1, { shape: 'step' }, 'Step out, tap foot in'),
  m('heel-dig', 'Heel dig', 2, 1, { shape: 'step' }),
  m('point', 'Point', 2, 2, { shape: 'reach' }, 'One arm out, any direction'),
  m('hip-bump', 'Hip bump', 2, 2, { shape: 'shake' }),
  m('shimmy', 'Shimmy', 2, 2, { shape: 'wiggle' }),
  m('jump-clap', 'Jump + clap', 2, 3, { shape: 'bounce' }),
  m('clap-overhead', 'Clap overhead', 2, 2, { shape: 'reach' }),
  m('squat-drop', 'Squat drop', 2, 3, { shape: 'drop' }),
  m('kick-ball-change', 'Kick ball change', 2, 2, { shape: 'step' }),
  m('freeze', 'Freeze / pose', 2, 3, { shape: 'still' }, 'Hold it, do not move'),
  m('half-turn', 'Half turn', 2, 2, { turn: 180 }, 'Half round, and stay facing that way'),
  m('grapevine', 'Grapevine', 4, 2, { shape: 'step' }, 'Side, behind, side, together'),
  m('box-step', 'Box step', 4, 1, { shape: 'step' }),
  m('body-roll', 'Body roll', 4, 2, { shape: 'sway' }),
  m('twist', 'Twist', 4, 2, { shape: 'wiggle' }),
  m('slide', 'Slide', 4, 2, { shape: 'step' }),
  m('turn-360', 'Turn 360', 4, 3, { turn: 360 }),
  m('running-man', 'Running man', 4, 3, { shape: 'bounce' }),
  m('arm-wave', 'Arms up wave', 4, 2, { shape: 'reach' }),
  m('march', 'March in place', 4, 1, { shape: 'bounce' }),
  m('travel-4', 'Travel 4 steps', 4, 2, { shape: 'step' }, 'Forward, back, or into place'),
]

/** Instantly recognisable, which is most of what makes a flashmob land. */
export const SIGNATURE_MOVES: Move[] = [
  m('dab', 'Dab', 2, 2, { shape: 'reach' }),
  m('disco-point', 'Disco point', 2, 3, { shape: 'reach' }, 'Saturday Night Fever, up and down'),
  m('cha-cha-left', 'Slide to the left', 4, 2, { shape: 'step' }, 'Cha Cha Slide'),
  m('criss-cross', 'Criss cross', 2, 2, { shape: 'step' }, 'Cha Cha Slide'),
  m('gangnam', 'Gangnam horse', 4, 3, { shape: 'bounce' }),
  m('sprinkler', 'Sprinkler', 4, 2, { shape: 'sway' }),
  m('lawnmower', 'Lawnmower', 4, 2, { shape: 'sway' }),
  m('shopping-cart', 'Shopping cart', 4, 2, { shape: 'reach' }),
  m('thriller-claw', 'Thriller claw', 4, 3, { shape: 'reach' }),
  m('single-ladies', 'Single Ladies hand', 4, 2, { shape: 'shake' }),
  m('vogue', 'Vogue hands', 4, 2, { shape: 'wiggle' }),
  m('robot', 'Robot', 4, 2, { shape: 'shake' }),
  m('floss', 'Floss', 4, 3, { shape: 'sway' }),
  m('cotton-eye-joe', 'Cotton Eye Joe stomp', 4, 3, { shape: 'bounce' }),
  m('time-warp', 'Jump to the left', 2, 3, { shape: 'step' }, 'Time Warp'),
  m('macarena', 'Macarena arms', 8, 2, { shape: 'reach' }, 'Full 8-count sequence'),
  m('ymca', 'Y-M-C-A', 8, 3, { shape: 'reach' }, 'One letter every 2 counts'),
  m('moonwalk', 'Moonwalk', 8, 3, { shape: 'step' }),
]

export const STARTER_MOVES: Move[] = [...GENERIC_MOVES, ...SIGNATURE_MOVES]

export const ENERGY_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Chill',
  2: 'Medium',
  3: 'Big',
}

/** `cycle` is the shape's natural length in counts, so a 1-count wiggle reads as one
 *  wiggle per count whatever the move it is attached to. `still` has no cycle: it is a
 *  held pose, drawn as a ring rather than as motion, because a dancer deliberately not
 *  moving is a choice and must not look like a dancer with nothing set. */
export const SHAPE_META: Record<MoveShape, { label: string; cycle: number; example: string }> = {
  wiggle: { label: 'Wiggle', cycle: 1, example: 'Shimmy' },
  bounce: { label: 'Bounce', cycle: 1, example: 'Jump + clap' },
  shake: { label: 'Shake', cycle: 1, example: 'Hip bump' },
  pulse: { label: 'Pulse', cycle: 1, example: 'Clap' },
  sway: { label: 'Sway', cycle: 2, example: 'Body roll' },
  drop: { label: 'Drop', cycle: 2, example: 'Squat drop' },
  reach: { label: 'Reach', cycle: 2, example: 'Y-M-C-A' },
  step: { label: 'Side-step', cycle: 2, example: 'Step touch' },
  still: { label: 'Still', cycle: 0, example: 'Freeze / pose' },
}

export const MOVE_SHAPES = Object.keys(SHAPE_META) as MoveShape[]

/** How long one cycle of a shape lasts, in counts. A shape never outruns its own move,
 *  so a 2-count sway placed on a 1-count block sways once across that single count. */
export const shapeCycle = (shape: MoveShape, beats: number) => Math.min(SHAPE_META[shape].cycle, beats)

export const MOVE_TURNS: { deg: MoveTurn; label: string; hint: string }[] = [
  { deg: 180, label: 'Half right', hint: 'ends facing away' },
  { deg: -180, label: 'Half left', hint: 'ends facing away' },
  { deg: 360, label: 'Full right', hint: 'lands where it started' },
  { deg: -360, label: 'Full left', hint: 'lands where it started' },
]

/** Whether a turn leaves anything behind. A full one nets to zero, so it needs no
 *  undoing later; a half one is a debt the choreography has to pay back. */
export const turnKeepsFacing = (deg: MoveTurn) => deg % 360 !== 0

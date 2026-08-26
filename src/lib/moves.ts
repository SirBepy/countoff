import type { Move } from './types'

const m = (id: string, name: string, beats: number, energy: 1 | 2 | 3, note?: string): Move => ({
  id,
  name,
  beats,
  energy,
  note,
  builtin: true,
})

/** Anyone can do these after one showing, which is the bar for a wedding crowd. */
export const GENERIC_MOVES: Move[] = [
  m('bounce', 'Bounce', 1, 1, 'Knees only, stay in place'),
  m('clap', 'Clap', 1, 1),
  m('step-touch', 'Step touch', 2, 1, 'Step out, tap foot in'),
  m('heel-dig', 'Heel dig', 2, 1),
  m('point', 'Point', 2, 2, 'One arm out, any direction'),
  m('hip-bump', 'Hip bump', 2, 2),
  m('shimmy', 'Shimmy', 2, 2),
  m('jump-clap', 'Jump + clap', 2, 3),
  m('clap-overhead', 'Clap overhead', 2, 2),
  m('squat-drop', 'Squat drop', 2, 3),
  m('kick-ball-change', 'Kick ball change', 2, 2),
  m('freeze', 'Freeze / pose', 2, 3, 'Hold it, do not move'),
  m('grapevine', 'Grapevine', 4, 2, 'Side, behind, side, together'),
  m('box-step', 'Box step', 4, 1),
  m('body-roll', 'Body roll', 4, 2),
  m('twist', 'Twist', 4, 2),
  m('slide', 'Slide', 4, 2),
  m('turn-360', 'Turn 360', 4, 3),
  m('running-man', 'Running man', 4, 3),
  m('arm-wave', 'Arms up wave', 4, 2),
  m('march', 'March in place', 4, 1),
  m('travel-4', 'Travel 4 steps', 4, 2, 'Forward, back, or into formation'),
]

/** Instantly recognisable, which is most of what makes a flashmob land. */
export const SIGNATURE_MOVES: Move[] = [
  m('dab', 'Dab', 2, 2),
  m('disco-point', 'Disco point', 2, 3, 'Saturday Night Fever, up and down'),
  m('cha-cha-left', 'Slide to the left', 4, 2, 'Cha Cha Slide'),
  m('criss-cross', 'Criss cross', 2, 2, 'Cha Cha Slide'),
  m('gangnam', 'Gangnam horse', 4, 3),
  m('sprinkler', 'Sprinkler', 4, 2),
  m('lawnmower', 'Lawnmower', 4, 2),
  m('shopping-cart', 'Shopping cart', 4, 2),
  m('thriller-claw', 'Thriller claw', 4, 3),
  m('single-ladies', 'Single Ladies hand', 4, 2),
  m('vogue', 'Vogue hands', 4, 2),
  m('robot', 'Robot', 4, 2),
  m('floss', 'Floss', 4, 3),
  m('cotton-eye-joe', 'Cotton Eye Joe stomp', 4, 3),
  m('time-warp', 'Jump to the left', 2, 3, 'Time Warp'),
  m('macarena', 'Macarena arms', 8, 2, 'Full 8-count sequence'),
  m('ymca', 'Y-M-C-A', 8, 3, 'One letter every 2 counts'),
  m('moonwalk', 'Moonwalk', 8, 3),
]

export const STARTER_MOVES: Move[] = [...GENERIC_MOVES, ...SIGNATURE_MOVES]

export const ENERGY_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Chill',
  2: 'Medium',
  3: 'Big',
}

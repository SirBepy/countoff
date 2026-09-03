/* Shared seed project for mobile-probe.cjs and desktop-check.cjs, so both
   probes exercise the same choreography and desktop-check can't drift from it. */
function lyrics(id, start, texts) {
  return texts.map((text, i) => ({ id: 'l-' + id + i, time: start + 1 + i * 4, text }))
}
function seg(id, name, start, bpm, texts) {
  return { id, name, start, bpm, anchor: start, transitionIn: 0, countsPerRow: 8, lyrics: lyrics(id, start, texts), fit: { offset: 0, scale: 1 } }
}

const PROJECT = {
  id: 'm1',
  name: 'Wedding medley 2026',
  audioName: 'probe.mp3',
  duration: 246,
  segments: [
    seg('s1', 'I Will Survive', 0, 117, ['At first I was afraid, I was petrified', 'Kept thinking I could never live without you', 'But then I spent so many nights']),
    seg('s2', 'Cotton Eye Joe', 120, 144.5, ['Where did you come from, where did you go']),
  ],
  blocks: [
    { id: 'b1', segmentId: 's1', moveId: 'step-touch', startBeat: 0, beats: 2 },
    { id: 'b2', segmentId: 's1', moveId: 'clap', startBeat: 4, beats: 1, note: 'turn' },
    { id: 'b3', segmentId: 's1', moveId: 'grapevine', startBeat: 8, beats: 4 },
    { id: 'b4', segmentId: 's1', moveId: 'body-roll', startBeat: 17, beats: 4 },
  ],
  moves: [
    { id: 'step-touch', name: 'Step touch', beats: 2, energy: 1 },
    { id: 'clap', name: 'Clap', beats: 1, energy: 1 },
    { id: 'grapevine', name: 'Grapevine', beats: 4, energy: 2 },
    { id: 'body-roll', name: 'Body roll', beats: 4, energy: 3, note: 'slow from the chest' },
  ],
  markers: [{ id: 'mk1', time: 12, label: 'lift' }],
  updatedAt: Date.now(),
}

module.exports = { PROJECT }

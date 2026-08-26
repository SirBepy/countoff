# Countoff

Plan choreography on the beat grid of your own music.

Drop in a track, Countoff finds the tempo and lays the song out as 8-counts. Lyrics run along the top
of each row, moves go underneath, so the sheet reads the way a choreographer actually writes one.

Built to plan a wedding flashmob.

## What it does

**Beat grid.** Tempo is detected from the audio; you confirm the downbeat with one tap. BPM and the
"1" are both editable, because a detector that is 0.3 BPM out will drift a four-minute song.

**Medley aware.** Mark where each song starts, and where the DJ transitions, drops and breaks land.
Hit `S`, `T`, `D` or `B` while the track plays to drop a marker at the playhead. Each song keeps its
own tempo, downbeat and lyrics. `Suggest` scans for loudness changes and proposes candidates, which
you accept or reject by ear.

**Lyrics.** Pulled from [LRCLIB](https://lrclib.net) with timestamps, or pasted in. Every line's text
and timing is editable, and a per-song offset re-aligns lyrics that were timed against the original
release rather than your cut.

**Moves.** Around 40 built in, from step-touch to the Macarena, each with a beat length and an energy
level. Add your own, record a clip straight from the webcam or upload one, and rename or retime
anything.

**Arranging.** Drag across counts to select, then click a move to fill the selection with repeats: a
2-beat move across two bars becomes four repeats. Shift-click a second move to alternate A B A B.
Blocks drag, stretch and delete.

**Rehearsing.** Full-screen mode shows the current move large, the lyric above it, an 8-count pulse
and what comes next. Loop a section, turn on the click, slow to 60% without the pitch dropping.

**Your data.** Everything stays in the browser: nothing is uploaded. Storage is marked persistent so
the browser will not evict it, a version history is kept automatically, and the whole project
including move clips exports to a single file. The song is not in that file, so the same panel can
swap in an audio file without disturbing a single count.

## On a phone

Built mobile first, and installable. Under 900px the move library becomes a bottom sheet you reach
from the selection bar, tempo controls fold behind the BPM chip, and the transport collapses to the
essentials with the rest one tap away. Add it to your home screen and it runs offline, which matters
at a venue with no signal. Audio keeps playing with the screen locked, with lock-screen controls.

Storage is per browser and per address, so a project built at `localhost` will not appear on the
hosted URL. Move between them with Export backup and Restore from file, then re-pick the song.

## Running it

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/` that works from any path, installs as a PWA and runs
offline.

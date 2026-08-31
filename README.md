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
level. Add your own, link a video that shows how one goes, and rename or retime anything.

**Arranging.** Drag across counts to select, then click a move to fill the selection with repeats: a
2-beat move across two bars becomes four repeats, or drag a move straight onto a count. Shift-click a
second move to alternate A B A B. Blocks drag, stretch and delete, and each placed block can carry
its own note, so the second of four can say "turn".

**Rehearsing.** Full-screen mode shows the current move large, the lyric above it, an 8-count pulse
and what comes next. Loop a section, turn on the click, slow to 60% without the pitch dropping.

**Your data.** Everything lives in the browser by default. Storage is marked persistent so the
browser will not evict it, a version history is kept automatically, and the whole project exports to
a single file. Sign in with Google and your choreographies follow you between devices. The song
itself never leaves the machine it is on, so every device picks the audio file once; the same panel
swaps it in without disturbing a single count.

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

## Android shell

For phones where a screen-time blocker treats installed PWAs as Chrome and blocks them, `android/`
is a small hand-written WebView shell that points at the hosted app and runs as its own process
instead. It carries no web assets of its own and needs no `npm install`; it is a separate Gradle
project.

The project has no Gradle wrapper: the `android.yml` workflow provides Gradle itself via
`gradle/actions/setup-gradle`, so building locally means having a `gradle` command on your own
`PATH` rather than running `./gradlew`.

To install the APK on a phone, open the latest release on the (public) repo in a browser:

```
https://github.com/SirBepy/countoff/releases/latest
```

and download the `.apk` asset, which needs no authentication since the repo is public. To cut a
new release:

```bash
git tag v0.1.0
git push --tags
```

which triggers the workflow and attaches a signed APK to the release. Signing needs four repo
secrets configured first: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the release build fails on purpose rather
than shipping an unsigned APK.

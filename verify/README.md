# verify/

A tracked (not gitignored) Playwright verify harness for countoff. Ten sessions each hand-wrote
substantially the same seed script into `.for_bepy/`, which is gitignored, and lost it. This lives
at top-level `verify/` on purpose, not `.claude/verify/`: `.claude/` is a directory people routinely
gitignore wholesale, and burying the anti-gitignore-loss harness there would repeat the exact bug
this exists to fix.

## Running a probe

The dev server must already be running (`npm run dev`, or via `/supervised-run`). Then:

```
node verify/menu-probe.cjs [port]      # sheet menu, comments, drag, lanes - defaults to 42210
node verify/mobile-probe.cjs [port]    # phone touch/scroll/layout findings - defaults to 42001
node verify/desktop-check.cjs [port]   # 1440px layout regression - defaults to 42001
node verify/restore-race.cjs [port]    # snapshot-restore vs debounced-save race
node verify/floor-probe.cjs [port]     # cast, movements, the walk menu, the sheet cue lane
```

On the Mac, chromium comes from a playwright install kept outside this repo, so the harness
default (a Windows path) has to be overridden:

```
COUNTOFF_CHROMIUM_RESOLVER=~/.playwright-host/playwright-resolve.cjs node verify/floor-probe.cjs 5173
```

`verify/harness.cjs` is the shared module (`withBrowser`, `seedProject`, `readProject`,
`silentWav`, `phoneContext`/`desktopContext`, `hitPoint`, `tap`, `screenshotDir`,
`createChecklist`). `verify/fixtures.cjs` holds the shared seed project used by
the mobile/desktop pair. Write a new probe against the harness rather than re-deriving any of the
below.

## Gotchas the harness already owns

1. The app renders only a drop screen unless BOTH a project and an audio blob are in IndexedDB, so
   `seedProject` always writes both.
2. IndexedDB is db `countoff`, stores `project` / `audio` / `clips` / `takes`. The `project` and
   `audio` stores are keyed by the project's own `id`, **not** `current` (since commit `c2fd274`),
   and `localStorage['countoff.activeProjectId']` must name that project or boot finds nothing.
   `takes` is keyed by take id, not project id, and holds one video blob per take.
3. Seed order is clear -> reload -> seed -> reload. The app flushes its in-memory project on
   `pagehide`/`beforeunload`, so a seed written while the app is live gets overwritten by stale
   state on the next reload.
4. The store's save is debounced 400ms (`src/lib/store.ts`), so any assertion reading IndexedDB
   back must wait >= 500ms after a UI action; `readProject` already does.
5. Touch points need an `id`. Without `{ x, y, id: 1 }`, Chrome treats successive `touchMove`s as
   different fingers, never resolves the gesture into a scroll, and every swipe assertion reports
   `scrollTop` unchanged.
6. Hit-test before tapping: `elementFromPoint` must confirm the target owns the point, or a probe
   can report an app bug when it really tapped a `.block` or the sticky `.seg-head` instead of the
   empty cell it meant. `hitPoint`/`tap` already do this.
7. `document.querySelector('.scroll')` is the move rail, not the sheet, because the rail renders
   first. Use `.main .scroll`.
8. Chrome eats the click of the first tap inside a scroller it has just flung, at any delay. Only
   `mobile-probe.cjs` flings, and its `reset()` already settles the scroller (it zeroes `scrollTop`
   and waits 700ms) before every gesture that follows.
9. The dev server binds IPv6, so `127.0.0.1` refuses and `localhost` works.

# src/lib conventions

## Where a React hook lives

A hook lives in the domain module it wraps, **unless that module is React-free** - then it gets
its own `useXxx.ts` file.

The tree already follows this, so it is a rule to read before the next extraction, not a migration
to perform:

- `useAudio` in `audio.ts`, `useMenuFit` in `menuFit.ts`, `useSyncStatus` in `syncEngine.ts`,
  `useFollowPlayhead` and `useZoomAnchor` in `timeline.ts`, plus one each in `media.ts` and
  `store.ts`. Every one of those modules already imports React, so the hook sits next to the pure
  helpers it wraps and a reader opening the file sees the whole subject at once.
- `useSignIn.ts` and `useTapTempo.ts` in their own files. They wrap `firebase.ts` and `bpm.ts`,
  which are the only two modules here with no React import at all. Folding them in would put React
  state into a module that has none, which is a worse trade than one extra file.

Decided 2026-09-26. The alternative considered was "every hook gets its own file", which the two
newest hooks had independently reached for; it was rejected because it would move six working hooks
away from their domains and fill this folder with one-export files to settle a question that the
React-free test already answers.

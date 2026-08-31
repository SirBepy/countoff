import { useSyncExternalStore } from 'react'

/** Mirrors the 900px breakpoint in src/styles/base.css. */
const desktop = window.matchMedia('(min-width: 900px)')

const subscribe = (cb: () => void) => {
  desktop.addEventListener('change', cb)
  return () => desktop.removeEventListener('change', cb)
}

/**
 * The song map re-renders on every audio frame, so a phone must not mount it at
 * all rather than hide it with CSS.
 */
export const useIsDesktop = () => useSyncExternalStore(subscribe, () => desktop.matches)

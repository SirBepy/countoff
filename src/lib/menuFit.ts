import { useLayoutEffect, useRef, useState } from 'react'

/** Keeps a floating card off the screen edge it was opened against. */
const EDGE = 8

/**
 * Measured rather than guessed: a menu's height changes with its item list, and a
 * card opened near the bottom would otherwise hide its last items below the fold.
 */
export function useMenuFit<T extends HTMLElement>(open: unknown) {
  const ref = useRef<T>(null)
  const [offset, setOffset] = useState({ dx: 0, dy: 0 })

  useLayoutEffect(() => {
    setOffset({ dx: 0, dy: 0 })
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setOffset({
      dx: Math.min(0, window.innerWidth - EDGE - rect.right),
      dy: Math.min(0, window.innerHeight - EDGE - rect.bottom),
    })
  }, [open])

  return { ref, offset }
}

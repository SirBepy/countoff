import { useEffect, useState } from 'react'
import { loadClip } from './db'

// Object URLs are cached per move so scrolling the library does not thrash them.
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

async function resolve(moveId: string): Promise<string | null> {
  if (cache.has(moveId)) return cache.get(moveId)!
  if (!pending.has(moveId)) {
    pending.set(
      moveId,
      loadClip(moveId).then((blob) => {
        const url = blob ? URL.createObjectURL(blob) : null
        cache.set(moveId, url)
        pending.delete(moveId)
        return url
      }),
    )
  }
  return pending.get(moveId)!
}

export function invalidateClip(moveId: string) {
  const url = cache.get(moveId)
  if (url) URL.revokeObjectURL(url)
  cache.delete(moveId)
}

export function useClip(moveId: string | null, hasClip: boolean | undefined) {
  const [url, setUrl] = useState<string | null>(() => (moveId ? cache.get(moveId) ?? null : null))

  useEffect(() => {
    let live = true
    if (!moveId || !hasClip) {
      setUrl(null)
      return
    }
    void resolve(moveId).then((next) => live && setUrl(next))
    return () => {
      live = false
    }
  }, [moveId, hasClip])

  return url
}

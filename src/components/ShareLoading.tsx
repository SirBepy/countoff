/** The share boot downloads the whole song before anything can render, which is a
 *  long time to stare at nothing on a phone. */
export default function ShareLoading({ progress }: { progress: { done: number; total: number } | null }) {
  const counting = progress !== null && progress.total > 0
  const pct = counting ? (progress.done / progress.total) * 100 : 0
  return (
    <div className="share-loading">
      <div className="brand">
        <span className="dot" /> countoff
      </div>
      <div className="share-loading-label">
        {counting ? `Loading the song, ${progress.done} of ${progress.total}` : 'Opening the link...'}
      </div>
      <div className="share-loading-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

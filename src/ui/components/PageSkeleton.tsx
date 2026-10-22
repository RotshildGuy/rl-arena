/**
 * The shape of a screen that is still loading, in place of a line of text.
 * Same shimmer as the first-load skeleton (`.skel` in styles.css), laid out
 * roughly like what is coming so the page does not jump when it arrives.
 */
export function PageSkeleton({ variant }: { variant: 'table' | 'cards' | 'list' | 'race' }) {
  return (
    <div className="grid" aria-busy aria-label="טוען">
      {variant === 'race' && (
        <div className="skel-card" style={{ minHeight: 300 }}>
          <span className="skel" style={{ width: '40%', height: 12 }} />
          <span className="skel" style={{ width: '65%', height: 34 }} />
          <span className="skel" style={{ width: '45%', height: 56 }} />
          <span className="skel" style={{ width: '100%', height: 80 }} />
          <span className="skel pill" style={{ width: 160, height: 38 }} />
        </div>
      )}
      {variant === 'table' && (
        <div className="skel-card">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="row" key={i} style={{ gap: 12 }}>
              <span className="skel" style={{ width: 30, height: 28 }} />
              <span className="skel" style={{ flex: 1, height: 28 }} />
              <span className="skel" style={{ width: 52, height: 28 }} />
            </div>
          ))}
        </div>
      )}
      {(variant === 'cards' || variant === 'race') && (
        <div className="skel-cols">
          {[0, 1].map((i) => (
            <div className="skel-card" key={i} style={{ minHeight: 180 }}>
              <span className="skel" style={{ width: '35%', height: 12 }} />
              <span className="skel" style={{ width: '100%', height: 40 }} />
              <span className="skel" style={{ width: '100%', height: 40 }} />
              <span className="skel" style={{ width: '70%', height: 40 }} />
            </div>
          ))}
        </div>
      )}
      {variant === 'list' && (
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <div className="skel-card" key={i}>
              <div className="row" style={{ gap: 12 }}>
                <span className="skel" style={{ width: 8, height: 40 }} />
                <span className="skel" style={{ flex: 1, height: 40 }} />
                <span className="skel pill" style={{ width: 90, height: 32 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A few shimmering lines, for a list inside a card that is still loading. */
export function LineSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-busy aria-label="טוען">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel" style={{ width: `${90 - i * 15}%`, height: 16 }} />
      ))}
    </div>
  );
}

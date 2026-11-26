import { useEffect, useRef, useState } from 'react';
import { drawCarPreview, type CarLook } from '../../core/games/racing/render';
import { useT } from '../../i18n';
import { hasWebGL } from './Stage3D';
import type { CarStudio } from './carStudio';

export type CarView = '3d' | 'top';

/**
 * The car being dressed, in the shop and on the design screen. In 3D by
 * default, the same model the broadcast races, turning slowly and turned by
 * a drag. From above for what only shows on the move - a trail, a flame,
 * drift smoke - which the 2D drawing paints and the 3D model does not; the
 * screen asks for that view when one of those is tried, and the switch lets
 * anybody flip between the two.
 *
 * three.js loads here only, on demand. Until it has, or if it cannot (no
 * WebGL, a failed download), the view from above stands in.
 */
export function CarViewer({ color, look, prefer = '3d' }: { color: string; look: CarLook; prefer?: CarView }) {
  const s = useT().shop;
  const gl = hasWebGL();
  const [view, setView] = useState<CarView>(prefer);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setView(prefer), [prefer]);
  const show3d = gl && !failed && view === '3d';
  // Leaving the 3D view drops its canvas; coming back waits for a new one.
  useEffect(() => {
    if (!show3d) setReady(false);
  }, [show3d]);

  return (
    <div className="car-viewer">
      {show3d && <Studio color={color} look={look} onReady={() => setReady(true)} onFail={() => setFailed(true)} />}
      {/* While three.js is on its way, the car from above covers the empty 3D canvas. */}
      {(!show3d || !ready) && (
        <div className={show3d ? 'car-viewer-cover' : undefined}>
          <TopCar color={color} look={look} />
        </div>
      )}
      {gl && (
        <div className="car-viewer-bar">
          <div className="segmented" role="group">
            <button
              className={show3d ? 'on' : ''}
              aria-pressed={show3d}
              onClick={() => {
                // Tapping 3D again after a failure tries once more.
                setFailed(false);
                setView('3d');
              }}
            >
              {s.view3d}
            </button>
            <button className={show3d ? '' : 'on'} aria-pressed={!show3d} onClick={() => setView('top')}>
              {s.viewTop}
            </button>
          </div>
          {show3d && ready && <span className="tiny dim car-viewer-hint">{s.viewHint}</span>}
        </div>
      )}
    </div>
  );
}

function Studio({ color, look, onReady, onFail }: { color: string; look: CarLook; onReady(): void; onFail(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const studio = useRef<CarStudio | null>(null);
  // The latest paint, for the moment the module arrives.
  const paint = useRef({ color, look });
  paint.current = { color, look };

  useEffect(() => {
    let gone = false;
    const canvas = ref.current;
    // The GPU can take the context back (a driver reset, too many pages with 3D):
    // the view from above takes over rather than leaving a blank box.
    const lost = (e: Event) => {
      e.preventDefault();
      if (!gone) onFail();
    };
    canvas?.addEventListener('webglcontextlost', lost);
    import('./carStudio')
      .then((m) => {
        if (gone || !ref.current) return;
        studio.current = m.createCarStudio(ref.current);
        studio.current.setPaint(paint.current);
        onReady();
      })
      .catch((e) => {
        console.warn('3D car preview unavailable, showing it from above', e);
        if (!gone) onFail();
      });
    return () => {
      gone = true;
      canvas?.removeEventListener('webglcontextlost', lost);
      studio.current?.dispose();
      studio.current = null;
    };
    // Built once per mount; the paint follows in the effect below.
  }, []);

  // The screens build a new look object on every render; rebuild the model
  // only when what it wears has actually changed.
  const key = JSON.stringify([color, look]);
  useEffect(() => {
    studio.current?.setPaint({ color, look });
  }, [key]);

  return <canvas ref={ref} className="shop-canvas car-viewer-3d" />;
}

/** The car from above, on asphalt, with trail and flame. */
function TopCar({ color, look }: { color: string; look: CarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look);
  }, [JSON.stringify([color, look])]);
  return <canvas ref={ref} className="shop-canvas" />;
}

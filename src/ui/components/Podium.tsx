import { useEffect, useRef } from 'react';
import { drawCarPreview, type CarLook } from '../../core/games/racing/render';

export interface PodiumPlace {
  position: number;
  driver: string;
  team: string;
  color: string;
  look?: CarLook;
  /** A line under the name: a race time, a gap, points. */
  detail?: string;
}

/**
 * The top three, on the steps, with the cars themselves.
 *
 * Each car is drawn by the same code that draws it on track, in its team's
 * colour and pattern and with whatever its team bought in the shop - the
 * podium is where a livery is seen the longest, so it is where it should be
 * seen best. Laid out the way a podium stands: second, first, third.
 */
export function Podium({ places, compact }: { places: PodiumPlace[]; compact?: boolean }) {
  const byPos = new Map(places.map((p) => [p.position, p]));
  const order = [2, 1, 3].map((n) => byPos.get(n)).filter((p): p is PodiumPlace => !!p);
  if (order.length === 0) return null;
  return (
    <div className={`podium ${compact ? 'compact' : ''}`}>
      {order.map((p) => (
        <div className={`podium-spot p${p.position}`} key={p.position}>
          <PodiumCar color={p.color} look={p.look} />
          <div className="podium-name">{p.driver}</div>
          <div className="podium-team">{p.team}</div>
          {p.detail && <div className="podium-detail mono">{p.detail}</div>}
          <div className="podium-step">
            <span>{p.position}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PodiumCar({ color, look }: { color: string; look?: CarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look, null);
  }, [color, look]);
  return <canvas ref={ref} className="podium-car" />;
}

import { useEffect, useRef, useState } from 'react';
import type { RacingSnapshot } from '../../core/games/racing/env';
import type { CameraSpec } from './director';
import type { CarPaint, RaceScene } from './scene3d';

interface Props {
  /** Called once per frame: move the race on and return what to show, or null for nothing yet. */
  advance(): RacingSnapshot | null;
  /** Where the camera is for this frame's snapshot. */
  camera(snap: RacingSnapshot): CameraSpec;
  paints: CarPaint[];
  /** Name tags over the cars, by grid slot, in the car's colour. */
  labels: string[];
  /** What to say while `advance` has nothing to show. */
  placeholder: string[];
  /** The 2D view, for a browser without WebGL or where three.js fails to load. */
  fallback: React.ReactNode;
  aspect?: number;
  fillHeight?: boolean;
}

/** Whether this browser can draw WebGL at all; asked once. */
let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * The broadcast in 3D. three.js is loaded only here, on demand, so training
 * and every other screen never download it. Anything that goes wrong on the
 * way - no WebGL, the module failing to load, a lost context - falls back to
 * the 2D view, which draws the same race.
 */
export function Stage3D(props: Props) {
  const [failed, setFailed] = useState(() => !hasWebGL());
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const { aspect = 16 / 10, fillHeight } = props;

  useEffect(() => {
    if (failed) return;
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    let scene: RaceScene | null = null;
    let raf = 0;
    let last = performance.now();
    let alive = true;

    const resize = () => {
      const w = host.clientWidth;
      let h: number;
      if (fillHeight) {
        host.style.height = '';
        h = host.clientHeight;
      } else {
        h = Math.round(w / aspect);
        host.style.height = `${h}px`;
      }
      scene?.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const frame = () => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = propsRef.current;
      const snap = p.advance();
      if (holdRef.current) holdRef.current.style.display = snap ? 'none' : '';
      if (!snap || !scene) return;
      const spec = p.camera(snap);
      scene.render(snap, p.paints, spec, dt);
      // On a car shot only the subject and its rival are named, as on television.
      const named = (i: number) => spec.shot === 'overview' || i === spec.car || i === spec.rival;
      // Name tags: HTML over the canvas, placed where the cars land on screen.
      const tags = tagsRef.current;
      if (tags) {
        const w = host.clientWidth;
        const h = host.clientHeight;
        for (let i = 0; i < tags.children.length; i++) {
          const el = tags.children[i] as HTMLElement;
          const at = snap.cars[i] && !snap.cars[i].done && named(i) ? scene.project(snap, i, w, h) : null;
          if (!at) {
            el.style.display = 'none';
            continue;
          }
          el.style.display = '';
          el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
        }
      }
    };

    void import('./scene3d')
      .then((m) => {
        if (!alive) return;
        try {
          scene = new m.RaceScene(canvas);
          resize();
        } catch {
          setFailed(true);
        }
      })
      .catch(() => alive && setFailed(true));
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      scene?.dispose();
    };
  }, [failed, aspect, fillHeight]);

  if (failed) return <>{props.fallback}</>;

  return (
    <div ref={hostRef} className="canvas-host stage3d">
      <canvas ref={canvasRef} />
      <div ref={tagsRef} className="tags3d" aria-hidden>
        {props.labels.map((label, i) => (
          <span key={i} style={{ color: props.paints[i]?.color }}>
            {label}
          </span>
        ))}
      </div>
      <div ref={holdRef} className="hold3d">
        {props.placeholder.map((line, i) => (
          <div key={i} className={i === 0 ? 'big' : 'muted small'}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

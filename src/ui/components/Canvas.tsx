import { useEffect, useRef } from 'react';

interface Props {
  /** Called on every animation frame with a correctly sized, DPR-scaled context. */
  draw: (ctx: CanvasRenderingContext2D) => void;
  aspect?: number;
  className?: string;
  /**
   * Cap the height at this fraction of the viewport. Without it a landscape phone
   * gets a canvas taller than the screen and the controls fall below the fold.
   */
  maxViewportFraction?: number;
  /**
   * Take the height the layout gives the host instead of deriving it from the
   * width. Used by the full-screen match layout, where the canvas must flex into
   * whatever is left after the header and the controls.
   */
  fillHeight?: boolean;
}

/**
 * Canvas that keeps its backing store in sync with its CSS size and the device
 * pixel ratio, and drives a requestAnimationFrame loop.
 */
export function Canvas({ draw, aspect = 16 / 10, className, maxViewportFraction, fillHeight }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = host.clientWidth;
      let h: number;
      if (fillHeight) {
        // Drop a height left behind by the aspect branch: the same host survives
        // a rotation from portrait to landscape, and a stale inline height makes
        // it overflow the layout and paint over whatever sits below it.
        host.style.height = '';
        h = host.clientHeight;
      } else {
        const cap = maxViewportFraction ? window.innerHeight * maxViewportFraction : Infinity;
        h = Math.round(Math.min(w / aspect, cap));
        host.style.height = `${h}px`;
      }
      if (w === 0 || h === 0) return;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) drawRef.current(ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
    };
  }, [aspect, maxViewportFraction, fillHeight]);

  return (
    <div ref={hostRef} className={`canvas-host ${className ?? ''}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}

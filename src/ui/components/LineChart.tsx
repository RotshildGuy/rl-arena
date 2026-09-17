import { useEffect, useRef } from 'react';

export interface Series {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  series: Series[];
  height?: number;
  /** Pin the y-axis instead of auto-scaling (used for epsilon, which is 0..1). */
  fixedRange?: [number, number];
  /** Draw the y axis on a log scale — loss spans orders of magnitude. */
  log?: boolean;
}

/**
 * Small canvas chart. Hand-drawn rather than pulled from a charting library:
 * three of these redraw on every stats tick and the whole thing is 60 lines.
 */
export function LineChart({ series, height = 120, fixedRange, log }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    // The page is RTL; without this the axis labels render "43-" instead of "-43".
    ctx.direction = 'ltr';

    const pad = { top: 8, right: 8, bottom: 16, left: 40 };
    const plotW = w - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const tx = (v: number) => (log ? Math.log10(Math.max(1e-6, v)) : v);

    let lo = Infinity;
    let hi = -Infinity;
    if (fixedRange) {
      [lo, hi] = [tx(fixedRange[0]), tx(fixedRange[1])];
    } else {
      for (const s of series) for (const v of s.values) {
        if (!isFinite(v)) continue;
        const t = tx(v);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (hi - lo < 1e-9) {
      hi = lo + 1;
      lo -= 1;
    }
    const pad2 = (hi - lo) * 0.08;
    lo -= pad2;
    hi += pad2;

    const maxLen = Math.max(2, ...series.map((s) => s.values.length));
    const X = (i: number) => pad.left + (i / (maxLen - 1)) * plotW;
    const Y = (v: number) => pad.top + plotH - ((tx(v) - lo) / (hi - lo)) * plotH;

    // Gridlines and axis labels.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const val = lo + ((hi - lo) * g) / 3;
      const y = pad.top + plotH - (g / 3) * plotH;
      ctx.strokeStyle = 'rgba(139, 151, 173, 0.13)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      const shown = log ? Math.pow(10, val) : val;
      ctx.fillStyle = '#8b97ad';
      ctx.fillText(formatTick(shown), pad.left - 6, y);
    }

    for (const s of series) {
      if (s.values.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.values.length; i++) {
        const v = s.values[i];
        if (!isFinite(v)) continue;
        const x = X(i);
        const y = Y(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }, [series, height, fixedRange, log]);

  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />;
}

function formatTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a >= 0.01) return v.toFixed(2);
  return v.toExponential(0);
}

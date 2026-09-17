import { useEffect, useRef } from 'react';

export interface PositionLine {
  label: string;
  color: string;
  /** Position at the end of each lap, 1-based. */
  positions: number[];
  /** Where the car started, drawn as lap 0. */
  gridPos: number;
  highlight?: boolean;
}

/**
 * The lap chart: one line per car, position on the vertical axis with first at
 * the top. It is the one graphic that shows a race as a story rather than a
 * table — every overtake is a crossing, and a retirement is a line that stops.
 */
export function PositionChart({
  lines,
  laps,
  height = 240,
}: {
  lines: PositionLine[];
  laps: number;
  height?: number;
}) {
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
    ctx.direction = 'ltr';

    const n = lines.length;
    if (!n || laps < 1) return;

    const pad = { top: 14, right: 96, bottom: 22, left: 30 };
    const plotW = Math.max(10, w - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;
    const X = (lap: number) => pad.left + (lap / laps) * plotW;
    const Y = (pos: number) => pad.top + ((pos - 1) / Math.max(1, n - 1)) * plotH;

    // Position gridlines.
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let p = 1; p <= n; p++) {
      const y = Y(p);
      ctx.strokeStyle = 'rgba(50, 58, 82, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#5b657d';
      ctx.textAlign = 'right';
      ctx.fillText(String(p), pad.left - 6, y);
    }

    // Lap ticks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stride = laps > 12 ? Math.ceil(laps / 10) : 1;
    for (let lap = 0; lap <= laps; lap += stride) {
      ctx.fillStyle = '#5b657d';
      ctx.fillText(lap === 0 ? 'זינוק' : String(lap), X(lap), pad.top + plotH + 6);
    }

    for (const line of lines) {
      const pts: Array<[number, number]> = [[X(0), Y(line.gridPos)]];
      line.positions.forEach((p, i) => pts.push([X(i + 1), Y(p)]));
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.highlight ? 3 : 1.8;
      ctx.globalAlpha = line.highlight ? 1 : 0.85;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();

      const [lx, ly] = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(lx, ly, line.highlight ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = line.color;
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${line.highlight ? '700 ' : ''}11px 'Heebo', system-ui, sans-serif`;
      ctx.fillStyle = line.color;
      ctx.fillText(line.label.slice(0, 14), lx + 7, ly);
    }
  }, [lines, laps, height]);

  return (
    <div className="chart-host">
      <canvas ref={ref} style={{ height }} />
    </div>
  );
}

import { getTrack, type Track } from './tracks';
import { CAR_RADIUS, type RacingSnapshot } from './env';
import { SENSOR_COUNT, SENSOR_SPREAD } from './rewards';

export const CAR_COLORS = ['#38bdf8', '#f472b6', '#4ade80', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316'];

export interface FollowCamera {
  /** Index of the car to centre on. */
  car: number;
  /**
   * How much of the world fits vertically, in world units. Keeping this constant
   * means the zoom feels identical on a phone and on a desktop, instead of the
   * view widening with the window.
   */
  viewHeight: number;
  /** Turn the world so the car's heading points up the screen. */
  rotate: boolean;
}

export interface RenderOpts {
  showSensors?: boolean;
  /** Index of the human-driven car, drawn with a ring. */
  playerCar?: number;
  labels?: string[];
  /** Dim cars that already finished or gave up. */
  dimDone?: boolean;
  /** Chase camera. Omit for the whole-track overview used while training. */
  follow?: FollowCamera;
  /**
   * Corner overview, which a chase camera otherwise takes away. The corner is
   * the caller's to pick, because what else is on the canvas differs: a
   * broadcast puts its lap counter top-left, while a player's race puts the
   * throttle over the bottom corners.
   */
  minimap?: 'top' | 'bottom';
  /**
   * Livery per car, indexed by grid slot. During a championship race these are
   * the team colours, so a viewer picks their car out of the pack the same way
   * they do on the timing tower.
   */
  colors?: string[];
  /** Draw a checkered band across the start/finish line. */
  checkeredLine?: boolean;
}

function colorOf(opts: RenderOpts, i: number): string {
  return opts.colors?.[i] ?? CAR_COLORS[i % CAR_COLORS.length];
}

/** World-to-screen transform plus a point projector for un-rotated overlays. */
interface View {
  matrix: DOMMatrix;
  scale: number;
  project(x: number, y: number): { x: number; y: number };
}

function makeView(matrix: DOMMatrix, scale: number): View {
  return {
    matrix,
    scale,
    project(x, y) {
      const p = matrix.transformPoint(new DOMPoint(x, y));
      return { x: p.x, y: p.y };
    },
  };
}

function fitView(w: number, h: number, track: Track, pad = 0): View {
  const b = track.bounds;
  const scale = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
  const ox = (w - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
  const oy = (h - (b.maxY - b.minY) * scale) / 2 - b.minY * scale;
  return makeView(new DOMMatrix().translate(ox, oy).scale(scale), scale);
}

function followView(w: number, h: number, cam: FollowCamera, snap: RacingSnapshot): View {
  const car = snap.cars[Math.min(cam.car, snap.cars.length - 1)];
  const scale = h / cam.viewHeight;
  // Sit the car low in the frame so most of the screen shows the road ahead.
  const cx = w / 2;
  const cy = h * 0.68;
  // A world vector at angle t lands on screen at t + r. Pointing the heading
  // straight up (screen -Y) means r = -90deg - heading.
  const rotDeg = cam.rotate ? -90 - (car.angle * 180) / Math.PI : 0;
  const m = new DOMMatrix().translate(cx, cy).rotate(rotDeg).scale(scale).translate(-car.x, -car.y);
  return makeView(m, scale);
}

function poly(ctx: CanvasRenderingContext2D, pts: Float32Array): void {
  const n = pts.length / 2;
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.closePath();
}

/**
 * Chequered start/finish band, drawn in world space across the first gate.
 *
 * It is not decoration: with a chase camera and ten identical-looking corners,
 * the line is the only landmark that tells a viewer a lap just ended.
 */
function drawStartLine(ctx: CanvasRenderingContext2D, track: Track): void {
  const [ax, ay, bx, by] = [
    track.checkpoints[0],
    track.checkpoints[1],
    track.checkpoints[2],
    track.checkpoints[3],
  ];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // Along the gate, then along the track, to give the band depth.
  const ux = dx / len;
  const uy = dy / len;
  const tx = -uy;
  const ty = ux;
  const cols = 10;
  const cell = len / cols;
  const depth = cell;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (c + r) % 2 === 0 ? '#e9edf7' : '#12151d';
      const x0 = ax + ux * (c * cell) + tx * (r * depth - depth);
      const y0 = ay + uy * (c * cell) + ty * (r * depth - depth);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + ux * cell, y0 + uy * cell);
      ctx.lineTo(x0 + ux * cell + tx * depth, y0 + uy * cell + ty * depth);
      ctx.lineTo(x0 + tx * depth, y0 + ty * depth);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Draws the track and the cars in world coordinates under the given transform. */
function drawWorld(
  ctx: CanvasRenderingContext2D,
  snap: RacingSnapshot,
  track: Track,
  view: View,
  opts: RenderOpts,
): void {
  // Line widths are specified in device pixels, so undo the world scale.
  const px = 1 / view.scale;

  ctx.save();
  ctx.setTransform(view.matrix);

  // Asphalt: the ring between the two walls, via even-odd fill.
  ctx.beginPath();
  poly(ctx, track.outer);
  poly(ctx, track.inner);
  ctx.fillStyle = '#2b303d';
  ctx.fill('evenodd');

  // Checkpoint gates, faint.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let c = 0; c < track.nCheckpoints; c++) {
    const o = c * 4;
    ctx.moveTo(track.checkpoints[o], track.checkpoints[o + 1]);
    ctx.lineTo(track.checkpoints[o + 2], track.checkpoints[o + 3]);
  }
  ctx.stroke();

  drawStartLine(ctx, track);

  ctx.strokeStyle = '#8a97b3';
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  poly(ctx, track.outer);
  ctx.stroke();
  ctx.beginPath();
  poly(ctx, track.inner);
  ctx.stroke();

  // Sensor rays of the focus car.
  const focus = snap.cars[snap.focus];
  if (opts.showSensors && focus && !focus.done) {
    const dA = SENSOR_SPREAD / (SENSOR_COUNT - 1);
    const a0 = focus.angle - SENSOR_SPREAD / 2;
    ctx.lineWidth = 1.2 * px;
    for (let k = 0; k < SENSOR_COUNT; k++) {
      const a = a0 + k * dA;
      const d = snap.sensors[k];
      // Red when the wall is close, green when the way is clear.
      const t = Math.min(1, d / 220);
      ctx.strokeStyle = `rgba(${Math.round(248 - t * 130)}, ${Math.round(113 + t * 110)}, ${Math.round(113 + t * 40)}, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(focus.x, focus.y);
      ctx.lineTo(focus.x + Math.cos(a) * d, focus.y + Math.sin(a) * d);
      ctx.stroke();
    }
  }

  // Cars are the subject, and on a whole-track overview a true-to-scale car is
  // eight pixels of nothing. Below a readable size they are drawn larger than
  // life — the geometry stays exact, only the marker grows.
  const minPx = 13;
  const bump = Math.max(1, minPx / (CAR_RADIUS * view.scale));
  const len = CAR_RADIUS * 1.7 * bump;
  const wid = CAR_RADIUS * 1.0 * bump;
  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.globalAlpha = opts.dimDone && c.done ? 0.3 : 1;

    ctx.fillStyle = colorOf(opts, i);
    ctx.beginPath();
    ctx.roundRect(-len / 2, -wid / 2, len, wid, Math.min(len, wid) * 0.3);
    ctx.fill();

    // Nose marker, so heading is readable at a glance.
    ctx.fillStyle = 'rgba(5, 6, 10, 0.8)';
    ctx.fillRect(len * 0.18, -wid / 2, len * 0.2, wid);

    if (c.touchingWall) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -wid / 2, len, wid, Math.min(len, wid) * 0.3);
      ctx.stroke();
    }
    ctx.restore();

    if (opts.playerCar === i) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(c.x, c.y, len * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/** Car name tags. Drawn unrotated so they stay readable under a rotating camera. */
function drawLabels(ctx: CanvasRenderingContext2D, snap: RacingSnapshot, view: View, opts: RenderOpts): void {
  if (!opts.labels) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  for (let i = 0; i < snap.cars.length; i++) {
    const label = opts.labels[i];
    if (!label) continue;
    const c = snap.cars[i];
    const p = view.project(c.x, c.y);
    if (p.x < -80 || p.y < -40 || p.x > ctx.canvas.width + 80 || p.y > ctx.canvas.height + 40) continue;
    const offset = CAR_RADIUS * 1.4 * view.scale + 14;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.7)';
    ctx.fillRect(p.x - tw / 2 - 4, p.y - offset - 11, tw + 8, 15);
    ctx.fillStyle = colorOf(opts, i);
    ctx.fillText(label, p.x, p.y - offset);
  }
  ctx.restore();
}

/**
 * Corner overview. A chase camera removes any sense of where you are on the
 * circuit, and this puts it back without giving up the zoom.
 */
function drawMinimap(ctx: CanvasRenderingContext2D, snap: RacingSnapshot, track: Track, opts: RenderOpts): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const size = Math.round(Math.min(w, h) * 0.24);
  const pad = Math.round(size * 0.12);
  // Canvas coordinates are always left-to-right, so this is the left edge either
  // way; only the vertical end is in question.
  const x0 = pad;
  const y0 = opts.minimap === 'top' ? pad : h - size - pad;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(7, 8, 13, 0.8)';
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0, y0, size, size, 8);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, y0, size, size, 8);
  ctx.clip();

  const mini = fitView(size, size, track, size * 0.08);
  ctx.setTransform(new DOMMatrix().translate(x0, y0).multiply(mini.matrix));
  const px = 1 / mini.scale;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.lineWidth = 1.5 * px;
  ctx.beginPath();
  poly(ctx, track.outer);
  ctx.stroke();
  ctx.beginPath();
  poly(ctx, track.inner);
  ctx.stroke();

  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    const isPlayer = opts.playerCar === i;
    ctx.fillStyle = colorOf(opts, i);
    ctx.globalAlpha = c.done ? 0.4 : 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, (isPlayer ? 5 : 3.5) * px * 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();
}

export function renderRacing(ctx: CanvasRenderingContext2D, snap: RacingSnapshot, opts: RenderOpts = {}): void {
  const canvas = ctx.canvas;
  const track = getTrack(snap.trackId);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const view =
    opts.follow && snap.cars.length > 0
      ? followView(canvas.width, canvas.height, opts.follow, snap)
      : fitView(canvas.width, canvas.height, track);

  drawWorld(ctx, snap, track, view, opts);
  drawLabels(ctx, snap, view, opts);
  if (opts.minimap) drawMinimap(ctx, snap, track, opts);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

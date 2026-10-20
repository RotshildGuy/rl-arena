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
  /**
   * How each car is painted beyond its colour: a second colour, a pattern and
   * a number. Indexed like `colors`; a car without one is solid with darker wings.
   */
  looks?: Array<CarLook | undefined>;
}

/** A car's paint. Drawing only: the car's size for the physics never changes. */
export interface CarLook {
  secondary?: string;
  pattern?: 'solid' | 'stripe' | 'twotone';
  number?: number;
  helmet?: string;
  /** Drift smoke colour. */
  smoke?: string;
}

function colorOf(opts: RenderOpts, i: number): string {
  return opts.colors?.[i] ?? CAR_COLORS[i % CAR_COLORS.length];
}

/** A colour a step darker, for wings and shading. Accepts #rgb, #rrggbb and hsl(). */
export function darker(color: string, amount = 0.35): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    const k = 1 - amount;
    const r = Math.round(((n >> 16) & 255) * k);
    const g = Math.round(((n >> 8) & 255) * k);
    const b = Math.round((n & 255) * k);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const hsl = /^hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%\s*\)$/i.exec(color);
  if (hsl) return `hsl(${hsl[1]}, ${hsl[2]}%, ${Math.max(0, Number(hsl[3]) * (1 - amount))}%)`;
  return 'rgba(5, 6, 10, 0.85)';
}

// ------------------------------------------------------------- scenery
/**
 * Everything about a circuit that never moves, built once per track as paths
 * and reused every frame: the gravel traps, the kerbs on the corners, the
 * grid boxes and the rubbered-in racing line. A phone draws while it trains,
 * so nothing here is recomputed per frame - each frame is a handful of fills.
 */
interface Scenery {
  kerbRed: Path2D;
  kerbWhite: Path2D;
  gridBoxes: Path2D;
  centre: Path2D;
  outer: Path2D;
  inner: Path2D;
}

const sceneryCache = new Map<string, Scenery>();

function closedPath(pts: Float32Array): Path2D {
  const p = new Path2D();
  const n = pts.length / 2;
  p.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n; i++) p.lineTo(pts[i * 2], pts[i * 2 + 1]);
  p.closePath();
  return p;
}

function sceneryFor(track: Track): Scenery {
  const hit = sceneryCache.get(track.def.id);
  if (hit) return hit;
  const n = track.def.samples;
  const kerbRed = new Path2D();
  const kerbWhite = new Path2D();
  const KERB = 7;

  // A corner is where the centreline turns: compare the tangents either side.
  const turn = (i: number) => {
    const a = ((i - 2) % n + n) % n;
    const b = (i + 2) % n;
    const cross = track.tangent[a * 2] * track.tangent[b * 2 + 1] - track.tangent[a * 2 + 1] * track.tangent[b * 2];
    return Math.abs(cross);
  };
  for (const wall of [track.inner, track.outer]) {
    for (let i = 0; i < n; i++) {
      if (turn(i) < 0.05) continue;
      const j = (i + 1) % n;
      const quad = (k: number) => {
        // From the wall towards the centreline by the kerb's width.
        const wx = wall[k * 2];
        const wy = wall[k * 2 + 1];
        const dx = track.center[k * 2] - wx;
        const dy = track.center[k * 2 + 1] - wy;
        const d = Math.hypot(dx, dy) || 1;
        return [wx, wy, wx + (dx / d) * KERB, wy + (dy / d) * KERB];
      };
      const [ax, ay, aix, aiy] = quad(i);
      const [bx, by, bix, biy] = quad(j);
      const path = i % 2 === 0 ? kerbRed : kerbWhite;
      path.moveTo(ax, ay);
      path.lineTo(bx, by);
      path.lineTo(bix, biy);
      path.lineTo(aix, aiy);
      path.closePath();
    }
  }

  // Grid boxes where the cars line up: three abreast, rows behind the line,
  // matching the slots `RacingEnv.reset` uses.
  const gridBoxes = new Path2D();
  const cpStride = track.cpIndex.length > 1 ? track.cpIndex[1] - track.cpIndex[0] : 8;
  for (let row = 0; row < 4; row++) {
    const idx = (n - (row + 1) * cpStride * 0.75 + n) % n | 0;
    const cx = track.center[idx * 2];
    const cy = track.center[idx * 2 + 1];
    const tx = track.tangent[idx * 2];
    const ty = track.tangent[idx * 2 + 1];
    for (let lane = 0; lane < 3; lane++) {
      const off = (lane - 1) * track.def.width * 0.33;
      const x = cx - ty * off;
      const y = cy + tx * off;
      const front = CAR_RADIUS * 1.2;
      const side = CAR_RADIUS * 0.8;
      // An open box: a bar across the front and two short sides back from it.
      gridBoxes.moveTo(x + tx * front - ty * side, y + ty * front + tx * side);
      gridBoxes.lineTo(x + tx * front + ty * side, y + ty * front - tx * side);
      gridBoxes.moveTo(x + tx * front - ty * side, y + ty * front + tx * side);
      gridBoxes.lineTo(x - tx * front * 0.4 - ty * side, y - ty * front * 0.4 + tx * side);
      gridBoxes.moveTo(x + tx * front + ty * side, y + ty * front - tx * side);
      gridBoxes.lineTo(x - tx * front * 0.4 + ty * side, y - ty * front * 0.4 - tx * side);
    }
  }

  const scenery: Scenery = {
    kerbRed,
    kerbWhite,
    gridBoxes,
    centre: closedPath(track.center),
    outer: closedPath(track.outer),
    inner: closedPath(track.inner),
  };
  sceneryCache.set(track.def.id, scenery);
  return scenery;
}

/** A small deterministic hash, so sparks flicker the same way in every replay. */
function jitter(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
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

  const scenery = sceneryFor(track);

  // Gravel traps along both walls: a wide stroke whose track-side half the
  // asphalt then paints over, leaving a band of gravel outside each wall.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2a2822';
  ctx.lineWidth = 34;
  ctx.stroke(scenery.outer);
  ctx.stroke(scenery.inner);

  // Asphalt: the ring between the two walls, via even-odd fill.
  ctx.beginPath();
  poly(ctx, track.outer);
  poly(ctx, track.inner);
  ctx.fillStyle = '#2b303d';
  ctx.fill('evenodd');

  // Rubber laid down on the racing line.
  ctx.strokeStyle = 'rgba(8, 9, 14, 0.22)';
  ctx.lineWidth = track.def.width * 0.3;
  ctx.stroke(scenery.centre);

  // Kerbs, red and white, wherever the road turns.
  ctx.fillStyle = '#c8243b';
  ctx.fill(scenery.kerbRed);
  ctx.fillStyle = '#e4e8f0';
  ctx.fill(scenery.kerbWhite);

  ctx.strokeStyle = 'rgba(233, 237, 247, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke(scenery.gridBoxes);

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
  // The line flashes as a car takes the flag or starts a new lap.
  if (snap.cars.some((c) => c.lap > 0 && !c.done && c.currentLapMs < 260)) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = 'lighter';
    drawStartLine(ctx, track);
    ctx.restore();
  }

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
  // life - the geometry stays exact, only the marker grows.
  const minPx = 13;
  const bump = Math.max(1, minPx / (CAR_RADIUS * view.scale));
  const len = CAR_RADIUS * 1.7 * bump;
  const wid = CAR_RADIUS * 1.0 * bump;
  // Drifts, under the cars. A sliding car's nose and its path part company, so
  // the tyre streaks are drawn back from the rear wheels along the way it is
  // actually travelling, longer the further it is out of line, with smoke where
  // the rubber is. Drawn from the snapshot alone, with no trail kept between
  // frames, because a replay can jump to any moment and has no frames before it.
  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    if (!c.sliding || c.done) continue;
    const fwd = Math.sqrt(Math.max(0, c.speed * c.speed - c.slip * c.slip));
    const heading = c.angle + Math.atan2(c.slip, fwd);
    const back = Math.min(4, Math.abs(c.slip)) * len * 0.9;
    const bx = -Math.cos(heading) * back;
    const by = -Math.sin(heading) * back;
    const cos = Math.cos(c.angle);
    const sin = Math.sin(c.angle);
    for (const side of [-1, 1]) {
      // Rear wheel, car frame to world.
      const wx = c.x - cos * len * 0.4 - sin * side * wid * 0.38;
      const wy = c.y - sin * len * 0.4 + cos * side * wid * 0.38;
      // A gradient throws on a non-finite point, where a plain fill only draws
      // nothing; a bad number must not take the whole frame down with it.
      if (!Number.isFinite(wx + wy + bx + by)) continue;
      const streak = ctx.createLinearGradient(wx, wy, wx + bx, wy + by);
      streak.addColorStop(0, 'rgba(12, 13, 18, 0.75)');
      streak.addColorStop(1, 'rgba(12, 13, 18, 0)');
      ctx.strokeStyle = streak;
      ctx.lineWidth = wid * 0.28;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + bx, wy + by);
      ctx.stroke();

      ctx.fillStyle = opts.looks?.[i]?.smoke ?? 'rgba(210, 216, 230, 0.16)';
      ctx.beginPath();
      ctx.arc(wx + bx * 0.35, wy + by * 0.35, wid * 0.55, 0, Math.PI * 2);
      ctx.arc(wx + bx * 0.7, wy + by * 0.7, wid * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.globalAlpha = opts.dimDone && c.done ? 0.3 : 1;

    drawCar(ctx, len, wid, colorOf(opts, i), opts.looks?.[i], view.scale * bump);
    ctx.restore();

    // Sparks off the wall. Seeded by car and time, so a replay throws the same ones.
    if (c.touchingWall && !c.done) {
      const t = Math.floor(snap.raceMs / 50);
      ctx.lineWidth = Math.max(px, wid * 0.08);
      ctx.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        const a = c.angle + Math.PI + (jitter(i * 7 + k, t) - 0.5) * 2.2;
        const r0 = len * 0.45;
        const r1 = r0 + len * (0.25 + jitter(k, t + i) * 0.5);
        ctx.strokeStyle = k % 2 ? 'rgba(255, 216, 77, 0.9)' : 'rgba(255, 140, 60, 0.85)';
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
        ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    }

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

/**
 * One car, in its own frame: nose along +x, centred on the origin. Shadow,
 * tyres, wings, chassis, livery, cockpit and helmet, back to front. The size
 * on screen is a marker; the car's size in the physics is `CAR_RADIUS`.
 */
function drawCar(
  ctx: CanvasRenderingContext2D,
  len: number,
  wid: number,
  primary: string,
  look: CarLook | undefined,
  pxPerUnit: number,
): void {
  const secondary = look?.secondary ?? darker(primary);

  // Shadow, offset as if lit from above and a little to one side.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.ellipse(-len * 0.04, wid * 0.14, len * 0.54, wid * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tyres.
  ctx.fillStyle = '#0d0f14';
  const tw = len * 0.2;
  const th = wid * 0.26;
  for (const x of [len * 0.28, -len * 0.3]) {
    for (const y of [-wid * 0.5, wid * 0.5 - th]) {
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y, tw, th, th * 0.35);
      ctx.fill();
    }
  }

  // Wings.
  ctx.fillStyle = secondary;
  ctx.fillRect(len * 0.4, -wid * 0.47, len * 0.1, wid * 0.94);
  ctx.fillRect(-len * 0.5, -wid * 0.4, len * 0.11, wid * 0.8);

  // Chassis: narrow nose, wide sidepods, tapering to the gearbox.
  const body = new Path2D();
  body.moveTo(len * 0.44, -wid * 0.09);
  body.lineTo(len * 0.12, -wid * 0.16);
  body.lineTo(len * 0.02, -wid * 0.36);
  body.lineTo(-len * 0.28, -wid * 0.36);
  body.lineTo(-len * 0.42, -wid * 0.18);
  body.lineTo(-len * 0.42, wid * 0.18);
  body.lineTo(-len * 0.28, wid * 0.36);
  body.lineTo(len * 0.02, wid * 0.36);
  body.lineTo(len * 0.12, wid * 0.16);
  body.lineTo(len * 0.44, wid * 0.09);
  body.closePath();
  ctx.fillStyle = primary;
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  if (look?.pattern === 'stripe') {
    ctx.fillStyle = secondary;
    ctx.fillRect(-len * 0.5, -wid * 0.07, len, wid * 0.14);
  } else if (look?.pattern === 'twotone') {
    ctx.fillStyle = secondary;
    ctx.fillRect(-len * 0.5, -wid * 0.5, len * 0.42, wid);
  }
  // A highlight along one flank, so the body reads as a shape and not a sticker.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(-len * 0.5, -wid * 0.5, len, wid * 0.22);
  ctx.restore();

  // Cockpit and helmet.
  ctx.fillStyle = 'rgba(5, 6, 10, 0.85)';
  ctx.beginPath();
  ctx.ellipse(-len * 0.06, 0, len * 0.11, wid * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look?.helmet ?? '#f4f6fb';
  ctx.beginPath();
  ctx.arc(-len * 0.08, 0, wid * 0.11, 0, Math.PI * 2);
  ctx.fill();

  // The number, on the engine cover, once the car is big enough to read it.
  if (look?.number !== undefined && wid * pxPerUnit >= 16) {
    ctx.save();
    ctx.translate(-len * 0.3, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${wid * 0.34}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(look.number), 0, 0);
    ctx.restore();
  }
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
  // Grass, at night: what is outside the circuit and inside its infield.
  ctx.fillStyle = '#0a130e';
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

/**
 * One car, large, for the shop's preview: the same drawing the track uses, so
 * what is bought is exactly what races.
 */
export function drawCarPreview(ctx: CanvasRenderingContext2D, color: string, look: CarLook | undefined): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2b303d';
  ctx.fillRect(0, 0, w, h);
  const len = Math.min(h * 0.85, w * 1.3);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 2);
  drawCar(ctx, len, len * 0.59, color, look, 99);
  ctx.restore();
}

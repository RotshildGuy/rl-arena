import { getTrack, type Track } from './tracks';
import { CAR_RADIUS, type RacingSnapshot } from './env';
import { SENSOR_COUNT, SENSOR_SPREAD } from './rewards';
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS, type Emblem } from '../../champ/emblem';
import { trailStrip, type TrailHistory } from './trail';
import { settle } from './settle';

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
  /**
   * Where the cars have just been, for the trail prize. Kept by the caller
   * across frames; without it no trail is drawn.
   */
  trails?: TrailHistory;
  /**
   * Draw the scenery by day: light grass, light gravel, light overlays. The
   * road itself is dark asphalt either way, so the cars read the same.
   */
  daylight?: boolean;
}

/** The colours that change between day and night. Everything on the road stays. */
function palette(opts: RenderOpts) {
  return opts.daylight
    ? {
        grass: '#cfe0c0',
        gravel: '#d9cfb6',
        wall: '#6b768d',
        gate: 'rgba(148, 163, 184, 0.14)',
        miniBg: 'rgba(255, 255, 255, 0.85)',
        miniEdge: 'rgba(22, 30, 58, 0.18)',
        miniTrack: 'rgba(43, 48, 61, 0.7)',
      }
    : {
        grass: '#0a130e',
        gravel: '#2a2822',
        wall: '#8a97b3',
        gate: 'rgba(148, 163, 184, 0.1)',
        miniBg: 'rgba(7, 8, 13, 0.8)',
        miniEdge: 'rgba(100, 116, 139, 0.5)',
        miniTrack: 'rgba(148, 163, 184, 0.55)',
      };
}

/** A car's paint. Drawing only: the car's size for the physics never changes. */
/** A podium celebration bought in the shop (`ui/components/Celebration.tsx`). */
export type CelebrationKind = 'sparkles' | 'confetti' | 'bubbles' | 'balloons' | 'champagne' | 'fireworks';

export interface CarLook {
  secondary?: string;
  pattern?: 'solid' | 'stripe' | 'twotone' | 'chevron' | 'centerline' | 'fade';
  number?: number;
  helmet?: string;
  /** Drift smoke colour. */
  smoke?: string;
  /** The body outline; every shape is the same `CAR_RADIUS` to the physics. */
  shape?: CarShape;
  /** Wings in their own colour, instead of the second colour. */
  wing?: string;
  /** Wheel rims and the band round each tyre wall. */
  rim?: string;
  /** Played over the car on the podium; never drawn on track. */
  celebration?: CelebrationKind;
  /** The team emblem, on the nose once the car is big enough to show it. */
  emblem?: Emblem;

  // Pack prizes (season 6, `shop.ts`).
  /** A streak behind the car at speed: a colour, or 'rainbow'. */
  trail?: string;
  /** Exhaust flame on the throttle, "core|outer" colours. */
  flame?: string;
  /** A design on the helmet, in the second colour. */
  visor?: 'stripe' | 'checker' | 'star' | 'flames' | 'crown';
  /** A sticker on both sidepods. */
  decal?: DecalKind;
  /** How the engine sounds (`raceAudio.ts`). */
  engine?: 'v8' | 'v10' | 'turbo' | 'electric';
  /** Played where the winner crosses the line. */
  finish?: 'shockwave' | 'sparks' | 'stars';
  /** Off track: the trophy on the podium, the frame of the driver's place, the podium backdrop. */
  trophy?: 'cup' | 'laurel' | 'star' | 'wheel' | 'crown' | 'diamond';
  frame?: 'bronze' | 'silver' | 'gold' | 'week' | 'copper' | 'steel' | 'carbon' | 'ruby' | 'sapphire' | 'ice' | 'platinum' | 'fire';
  banner?:
    | 'carbon' | 'checker' | 'sunset' | 'aurora'
    | 'ocean' | 'midnight' | 'stripes' | 'desert' | 'lava' | 'sakura' | 'storm' | 'chrome' | 'neon' | 'galaxy';
  /** Item ids: the line under the team's name and the radio call after a win. */
  title?: string;
  quote?: string;
}

export type DecalKind = 'star' | 'bolt' | 'checker' | 'flame' | 'sun' | 'crown' | 'chevron' | 'arrow' | 'heart' | 'drop' | 'mountain' | 'wheel';

export type CarShape = 'classic' | 'wedge' | 'arrow' | 'bulldog';

/**
 * Each body as points on one side of the car, nose first, in fractions of the
 * car's length and width; the other side is the mirror image.
 */
export const BODY_SHAPES: Record<CarShape, Array<[number, number]>> = {
  // Narrow nose, wide sidepods, tapering to the gearbox.
  classic: [[0.44, 0.09], [0.12, 0.16], [0.02, 0.36], [-0.28, 0.36], [-0.42, 0.18]],
  // A long sharp nose, the sidepods swept back.
  wedge: [[0.48, 0.05], [0.1, 0.2], [-0.05, 0.38], [-0.36, 0.32], [-0.44, 0.14]],
  // Slim, the sidepods pushed forward behind a short nose.
  arrow: [[0.46, 0.07], [0.22, 0.12], [0.14, 0.34], [-0.1, 0.34], [-0.4, 0.14]],
  // Blunt and boxy, wide from nose to tail.
  bulldog: [[0.44, 0.14], [0.2, 0.2], [0.1, 0.4], [-0.32, 0.4], [-0.44, 0.24]],
};

function bodyPath(shape: CarShape | undefined, len: number, wid: number): Path2D {
  const side = BODY_SHAPES[shape ?? 'classic'] ?? BODY_SHAPES.classic;
  const body = new Path2D();
  side.forEach(([x, y], i) => (i ? body.lineTo(x * len, -y * wid) : body.moveTo(x * len, -y * wid)));
  for (let i = side.length - 1; i >= 0; i--) body.lineTo(side[i][0] * len, side[i][1] * wid);
  body.closePath();
  return body;
}

/** Emblem paths, parsed once each: the same few strings are drawn every frame. */
const emblemPaths = new Map<string, Path2D>();
function emblemPath(d: string): Path2D {
  let p = emblemPaths.get(d);
  if (!p) {
    p = new Path2D(d);
    emblemPaths.set(d, p);
  }
  return p;
}

/**
 * An emblem centred on the origin, `size` across, upright in the current frame.
 * Shared by the car and anything else that paints an emblem on a canvas.
 */
export function drawEmblem(ctx: CanvasRenderingContext2D, emblem: Emblem, size: number): void {
  const shape = EMBLEM_SHAPES[emblem.shape];
  const symbol = EMBLEM_SYMBOLS[emblem.symbol];
  if (!shape || !symbol) return;
  ctx.save();
  ctx.scale(size / 24, size / 24);
  ctx.translate(-12, -12);
  ctx.fillStyle = emblem.bg;
  ctx.fill(emblemPath(shape));
  ctx.strokeStyle = 'rgba(5, 6, 10, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke(emblemPath(shape));
  ctx.fillStyle = emblem.fg;
  ctx.fill(emblemPath(symbol), 'evenodd');
  ctx.restore();
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

/**
 * Whether centreline sample `i` is in a corner, and so gets a kerb: where the
 * tangents either side of it turn apart. The 3D broadcast uses the same test,
 * so its kerbs sit where the 2D ones do.
 */
export function hasKerb(track: Track, i: number): boolean {
  const n = track.def.samples;
  const a = ((i - 2) % n + n) % n;
  const b = (i + 2) % n;
  const cross = track.tangent[a * 2] * track.tangent[b * 2 + 1] - track.tangent[a * 2 + 1] * track.tangent[b * 2];
  return Math.abs(cross) >= 0.05;
}

function sceneryFor(track: Track): Scenery {
  const hit = sceneryCache.get(track.def.id);
  if (hit) return hit;
  const n = track.def.samples;
  const kerbRed = new Path2D();
  const kerbWhite = new Path2D();
  const KERB = 7;

  for (const wall of [track.inner, track.outer]) {
    for (let i = 0; i < n; i++) {
      if (!hasKerb(track, i)) continue;
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
  const pal = palette(opts);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pal.gravel;
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
  ctx.strokeStyle = pal.gate;
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

  ctx.strokeStyle = pal.wall;
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

  // Pack prizes behind the cars: trails along the way the car came, flames on the throttle.
  if (opts.trails) opts.trails.update(snap, CAR_RADIUS * 0.8);
  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    const look = opts.looks?.[i];
    if (!look || c.done) continue;
    if (look.trail && opts.trails) drawTrailPath(ctx, trailStrip(opts.trails.of(i), snap.raceMs, wid * 0.22), look.trail);
    // Eased with the throttle (`TrailHistory.gas`), so it grows and fades instead of strobing.
    const gas = opts.trails ? opts.trails.gas(i, c) : c.onGas ? 1 : 0;
    if (look.flame && gas > 0.05) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(opts.trails ? opts.trails.heading(i, c) : c.angle);
      ctx.translate(-len * 0.5, 0);
      ctx.scale(gas, 0.6 + 0.4 * gas);
      ctx.translate(len * 0.5, 0);
      drawFlame(ctx, len, wid, look.flame, jitter(i * 13, Math.floor(snap.raceMs / 60)));
      ctx.restore();
    }
  }

  for (let i = 0; i < snap.cars.length; i++) {
    const c = snap.cars[i];
    ctx.save();
    ctx.translate(c.x, c.y);
    // Eased when there is a history to ease with (`trail.ts`): a model flicks the steering every few steps.
    ctx.rotate(opts.trails ? opts.trails.heading(i, c) : c.angle);
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

    // The winner's finish-line prize, for two seconds from the flag.
    const fx = opts.looks?.[i]?.finish;
    if (fx && c.finished && c.totalMs !== null && snap.order[0] === i) {
      const t = (snap.raceMs - c.totalMs) / FINISH_FX_MS;
      if (t >= 0 && t < 1) {
        ctx.save();
        ctx.translate(c.x, c.y);
        drawFinishFx(ctx, fx, t, len, colorOf(opts, i), opts.looks?.[i]?.secondary);
        ctx.restore();
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
  /** How dark the shadow under the car is; softer where there is no asphalt behind it. */
  shadow = 0.38,
): void {
  const secondary = look?.secondary ?? darker(primary);
  const wingColor = look?.wing ?? secondary;

  // Shadow, offset as if lit from above and a little to one side.
  ctx.fillStyle = `rgba(0, 0, 0, ${shadow})`;
  ctx.beginPath();
  ctx.ellipse(-len * 0.04, wid * 0.14 * (shadow / 0.38), len * 0.52, wid * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tyres, with a light rim so they stand out against dark asphalt.
  ctx.strokeStyle = look?.rim ?? 'rgba(200, 208, 222, 0.75)';
  ctx.lineWidth = Math.max(wid * 0.035, 1.2 / pxPerUnit);
  const tw = len * 0.2;
  const th = wid * 0.26;
  for (const x of [len * 0.28, -len * 0.3]) {
    for (const y of [-wid * 0.5, wid * 0.5 - th]) {
      ctx.fillStyle = '#0d0f14';
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y, tw, th, th * 0.35);
      ctx.fill();
      ctx.stroke();
      if (look?.rim) {
        // The rim itself, showing between the tyre walls.
        ctx.fillStyle = look.rim;
        ctx.fillRect(x - tw * 0.22, y + th * 0.3, tw * 0.44, th * 0.4);
      }
    }
  }

  // Wings.
  ctx.fillStyle = wingColor;
  ctx.fillRect(len * 0.4, -wid * 0.47, len * 0.1, wid * 0.94);
  ctx.fillRect(-len * 0.5, -wid * 0.4, len * 0.11, wid * 0.8);

  // Chassis.
  const body = bodyPath(look?.shape, len, wid);
  if (look?.pattern === 'fade') {
    // Body colour at the nose, the second colour by the gearbox.
    const g = ctx.createLinearGradient(len * 0.3, 0, -len * 0.45, 0);
    g.addColorStop(0, primary);
    g.addColorStop(1, secondary);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = primary;
  }
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  if (look?.pattern === 'stripe') {
    ctx.fillStyle = secondary;
    ctx.fillRect(-len * 0.5, -wid * 0.07, len, wid * 0.14);
  } else if (look?.pattern === 'twotone') {
    ctx.fillStyle = secondary;
    ctx.fillRect(-len * 0.5, -wid * 0.5, len * 0.42, wid);
  } else if (look?.pattern === 'chevron') {
    // Two arrowheads pointing the way the car goes.
    ctx.fillStyle = secondary;
    for (const at of [0.3, -0.02]) {
      ctx.beginPath();
      ctx.moveTo(len * at, 0);
      ctx.lineTo(len * (at - 0.24), -wid * 0.5);
      ctx.lineTo(len * (at - 0.36), -wid * 0.5);
      ctx.lineTo(len * (at - 0.12), 0);
      ctx.lineTo(len * (at - 0.36), wid * 0.5);
      ctx.lineTo(len * (at - 0.24), wid * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  } else if (look?.pattern === 'centerline') {
    // A pair of pinstripes either side of the centre, nose to tail.
    ctx.fillStyle = secondary;
    ctx.fillRect(-len * 0.5, -wid * 0.13, len, wid * 0.045);
    ctx.fillRect(-len * 0.5, wid * 0.085, len, wid * 0.045);
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
  if (look?.visor) drawVisor(ctx, -len * 0.08, wid * 0.11, look.visor, secondary);

  // Stickers on both sidepods, once the car is big enough to make them out.
  if (look?.decal && wid * pxPerUnit >= 18) {
    const d = emblemPath(EMBLEM_SYMBOLS[DECAL_SYMBOL[look.decal]] ?? '');
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(-len * 0.12, side * wid * 0.27);
      ctx.rotate(Math.PI / 2);
      const k = (wid * 0.2) / 24;
      ctx.scale(k, k);
      ctx.translate(-12, -12);
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(5, 6, 10, 0.85)';
      ctx.stroke(d);
      ctx.fillStyle = '#ffffff';
      ctx.fill(d, 'evenodd');
      ctx.restore();
    }
  }

  // The emblem, on the nose, once the car is big enough to make it out.
  if (look?.emblem && wid * pxPerUnit >= 22) {
    ctx.save();
    ctx.translate(len * 0.25, 0);
    ctx.rotate(Math.PI / 2);
    drawEmblem(ctx, look.emblem, wid * 0.3);
    ctx.restore();
  }

  // The number, on the engine cover, once the car is big enough to read it.
  if (look?.number !== undefined && wid * pxPerUnit >= 16) {
    ctx.save();
    ctx.translate(-len * 0.31, 0);
    ctx.rotate(Math.PI / 2);
    // Two digits get a smaller face, or they run into the helmet.
    const size = wid * (look.number > 9 ? 0.27 : 0.34);
    ctx.font = `800 ${size}px Heebo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A dark outline first: white on a white or pale body would vanish.
    ctx.strokeStyle = 'rgba(5, 6, 10, 0.9)';
    ctx.lineWidth = size * 0.2;
    ctx.lineJoin = 'round';
    ctx.strokeText(String(look.number), 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(look.number), 0, 0);
    ctx.restore();
  }
}

/** Car name tags. Drawn unrotated so they stay readable under a rotating camera. */
function drawLabels(ctx: CanvasRenderingContext2D, snap: RacingSnapshot, view: View, opts: RenderOpts): void {
  if (!opts.labels) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '600 11px Heebo, system-ui, sans-serif';
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
    // Dark in daylight too: a tag sits over the road, in the car's own colour.
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
  const pal = palette(opts);
  ctx.fillStyle = pal.miniBg;
  ctx.strokeStyle = pal.miniEdge;
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
  ctx.strokeStyle = pal.miniTrack;
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

export function renderRacing(ctx: CanvasRenderingContext2D, raw: RacingSnapshot, opts: RenderOpts = {}): void {
  const canvas = ctx.canvas;
  const track = getTrack(raw.trackId);
  // Drawn where `settle` puts them, so a car never shows inside another or a wall.
  const at = settle(raw, track);
  const snap: RacingSnapshot = { ...raw, cars: raw.cars.map((c, i) => ({ ...c, x: at[i * 2], y: at[i * 2 + 1] })) };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Grass: what is outside the circuit and inside its infield.
  ctx.fillStyle = palette(opts).grass;
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
export function drawCarPreview(
  ctx: CanvasRenderingContext2D,
  color: string,
  look: CarLook | undefined,
  /** The asphalt behind the car, or null for none (a podium step shows through). */
  background: string | null = '#2b303d',
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  // The shop shows the trail and the flame too, as if the car were flat out:
  // a smaller car, nose up, with room behind it for them.
  const behind = !!background && !!(look?.trail || look?.flame);
  const len = Math.min(h * (behind ? 0.5 : 0.85), w * 1.3);
  ctx.save();
  ctx.translate(w / 2, behind ? h * 0.34 : h / 2);
  ctx.rotate(-Math.PI / 2);
  if (behind && look?.trail) drawTrail(ctx, len, len * 0.59, look.trail, 1, 0.45);
  if (behind && look?.flame) drawFlame(ctx, len, len * 0.59, look.flame, 0.6);
  drawCar(ctx, len, len * 0.59, color, look, 99, background ? 0.38 : 0.14);
  ctx.restore();
}

/** How long the winner's finish-line prize plays. */
export const FINISH_FX_MS = 2200;

/** Which emblem symbol each sticker is: the same drawings, so they look like the emblem's. */
export const DECAL_SYMBOL: Record<DecalKind, string> = {
  star: 'star',
  bolt: 'bolt',
  checker: 'chequer',
  flame: 'flame',
  sun: 'sun',
  crown: 'crown',
  chevron: 'chevron',
  arrow: 'arrow',
  heart: 'heart',
  drop: 'drop',
  mountain: 'mountain',
  wheel: 'wheel',
};

export const RAINBOW = ['#ff2e4d', '#ff7a1a', '#ffd84d', '#38f08a', '#38bdf8', '#a855f7'];

/**
 * A trail behind the car, in its frame (nose along +x): a band that fades out
 * behind the gearbox, longer the faster it goes. `amount` 0 draws nothing.
 */
function drawTrail(ctx: CanvasRenderingContext2D, len: number, wid: number, trail: string, amount: number, reach = 1): void {
  if (amount <= 0.01) return;
  const x0 = -len * 0.48;
  const x1 = x0 - len * (0.8 + 2.4 * amount) * reach;
  const half = wid * 0.2;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, amount * 1.4);
  if (trail === 'rainbow') {
    // Six thin bands, one per colour, side by side.
    const band = (half * 2) / RAINBOW.length;
    RAINBOW.forEach((col, k) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x1, -half + k * band, x0 - x1, band);
    });
  } else {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, trail);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, -half);
    ctx.lineTo(x1, -half * 0.3);
    ctx.lineTo(x1, half * 0.3);
    ctx.lineTo(x0, half);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A trail along the path a car drove, in world space: each piece of the strip
 * fades with its age. A rainbow is six bands side by side.
 */
function drawTrailPath(ctx: CanvasRenderingContext2D, strip: ReturnType<typeof trailStrip>, trail: string): void {
  if (strip.length < 2) return;
  const bands = trail === 'rainbow' ? RAINBOW : [trail];
  const base = ctx.globalAlpha;
  for (let i = 0; i < strip.length - 1; i++) {
    const a = strip[i];
    const b = strip[i + 1];
    ctx.globalAlpha = base * (1 - b.age) * 0.9;
    bands.forEach((color, k) => {
      const t0 = k / bands.length;
      const t1 = (k + 1) / bands.length;
      const lerp = (p: typeof a, t: number) => [p.lx + (p.rx - p.lx) * t, p.ly + (p.ry - p.ly) * t] as const;
      const [a0x, a0y] = lerp(a, t0);
      const [a1x, a1y] = lerp(a, t1);
      const [b0x, b0y] = lerp(b, t0);
      const [b1x, b1y] = lerp(b, t1);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a0x, a0y);
      ctx.lineTo(a1x, a1y);
      ctx.lineTo(b1x, b1y);
      ctx.lineTo(b0x, b0y);
      ctx.closePath();
      ctx.fill();
    });
  }
  ctx.globalAlpha = base;
}

/** The exhaust flame, out of the back of the car; `flicker` 0..1 sets its length this frame. */
function drawFlame(ctx: CanvasRenderingContext2D, len: number, wid: number, flame: string, flicker: number): void {
  const [core, outer] = flame.split('|');
  const x0 = -len * 0.5;
  const reach = len * (0.22 + 0.16 * flicker);
  for (const [color, scale] of [
    [outer, 1],
    [core, 0.55],
  ] as const) {
    ctx.fillStyle = color ?? '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(x0, -wid * 0.1 * scale);
    ctx.quadraticCurveTo(x0 - reach * scale * 0.6, -wid * 0.12 * scale, x0 - reach * scale, 0);
    ctx.quadraticCurveTo(x0 - reach * scale * 0.6, wid * 0.12 * scale, x0, wid * 0.1 * scale);
    ctx.closePath();
    ctx.fill();
  }
}

/** A design over the helmet (centre x, radius r), in the second colour. */
export function drawVisor(ctx: CanvasRenderingContext2D, x: number, r: number, visor: NonNullable<CarLook['visor']>, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, 0, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = color;
  if (visor === 'stripe') {
    ctx.fillRect(x - r, -r * 0.28, r * 2, r * 0.56);
  } else if (visor === 'checker') {
    const s = r / 2;
    for (let i = -2; i < 2; i++) for (let j = -2; j < 2; j++) if ((i + j) & 1) ctx.fillRect(x + i * s, j * s, s, s);
  } else if (visor === 'flames') {
    // Three tongues licking forward from the back of the helmet.
    ctx.beginPath();
    ctx.moveTo(x - r, -r);
    for (const y of [-0.6, 0, 0.6]) {
      ctx.quadraticCurveTo(x, (y - 0.3) * r, x + r * 0.7, y * r);
      ctx.quadraticCurveTo(x - r * 0.1, (y + 0.15) * r, x - r * 0.3, (y + 0.3) * r);
    }
    ctx.lineTo(x - r, r);
    ctx.closePath();
    ctx.fill();
  } else {
    const d = emblemPath(EMBLEM_SYMBOLS[visor === 'crown' ? 'crown' : 'star']);
    ctx.translate(x, 0);
    ctx.rotate(Math.PI / 2);
    const k = (r * 2.1) / 24;
    ctx.scale(k, k);
    ctx.translate(-12, -12);
    ctx.fill(d, 'evenodd');
  }
  ctx.restore();
}

/**
 * The winner's finish-line prize, centred on the car, `t` from 0 to 1 over its
 * run. Drawn from the time alone, so a replay and a seek show the same frame.
 */
export function drawFinishFx(
  ctx: CanvasRenderingContext2D,
  fx: NonNullable<CarLook['finish']>,
  t: number,
  size: number,
  color: string,
  second?: string,
): void {
  const fade = 1 - t;
  ctx.save();
  ctx.lineCap = 'round';
  if (fx === 'shockwave') {
    for (let k = 0; k < 3; k++) {
      const tt = t - k * 0.14;
      if (tt <= 0) continue;
      ctx.globalAlpha = Math.max(0, 1 - tt) * 0.9;
      ctx.strokeStyle = k % 2 ? second ?? '#ffffff' : color;
      ctx.lineWidth = size * 0.16 * (1 - tt);
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.6 + tt * 4), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (fx === 'sparks') {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + jitter(k, 3) * 0.3;
      const r0 = size * (0.5 + t * 3.2 * (0.6 + jitter(k, 9) * 0.6));
      const r1 = r0 + size * 0.5 * fade;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = k % 3 === 0 ? '#ffffff' : k % 3 === 1 ? '#ffd84d' : color;
      ctx.lineWidth = size * 0.07;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
  } else {
    const d = emblemPath(EMBLEM_SYMBOLS.star);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = size * (0.4 + t * 3.4 * (0.7 + jitter(k, 5) * 0.5));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
      ctx.rotate(t * 4 + k);
      const s = (size * (0.5 + 0.3 * fade)) / 24;
      ctx.scale(s, s);
      ctx.translate(-12, -12);
      ctx.fillStyle = k % 2 ? '#ffd84d' : second ?? '#ffffff';
      ctx.fill(d);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * A car's livery seen from straight above, nose along +x and centred on the
 * origin, with no shadow: the paint the 3D broadcast wraps over its car body.
 */
export function drawCarLivery(
  ctx: CanvasRenderingContext2D,
  len: number,
  wid: number,
  color: string,
  look: CarLook | undefined,
): void {
  drawCar(ctx, len, wid, color, look, 99, 0);
}

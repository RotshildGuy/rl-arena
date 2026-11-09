import { SegmentGrid } from '../../geometry';

export interface TrackDef {
  id: string;
  name: string;
  /** Full track width in world units. */
  width: number;
  /** Centreline sample count. */
  samples: number;
  /** Centreline points per t in [0, 2PI). Must trace a simple (non-self-crossing) loop. */
  shape: (t: number) => [number, number];
}

export interface Track {
  def: TrackDef;
  /** Closed centreline, flat x,y pairs. */
  center: Float32Array;
  /** Unit tangent per centreline point, flat x,y pairs. */
  tangent: Float32Array;
  inner: Float32Array;
  outer: Float32Array;
  /** Both walls as segments: [x1,y1,x2,y2, ...]. */
  wallSegs: Float32Array;
  grid: SegmentGrid;
  /** Gate segments [innerX, innerY, outerX, outerY] per checkpoint. */
  checkpoints: Float32Array;
  /** Centreline index of each checkpoint. */
  cpIndex: Int32Array;
  /** Midpoint of each checkpoint, flat x,y pairs. */
  cpMid: Float32Array;
  nCheckpoints: number;
  /** Centreline length, used to normalise distances into the observation. */
  length: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const WORLD_CX = 500;
const WORLD_CY = 350;

function radial(base: number, harmonics: Array<[number, number, number]>, squash = 0.78) {
  return (t: number): [number, number] => {
    let r = 1;
    for (const [amp, freq, phase] of harmonics) r += amp * Math.cos(freq * t + phase);
    const rr = base * r;
    return [WORLD_CX + rr * Math.cos(t), WORLD_CY + rr * Math.sin(t) * squash];
  };
}

/** A rounded rectangle, |x/a|^p + |y/b|^p = 1: straights joined by corners that tighten as p grows. */
function superellipse(a: number, b: number, p: number) {
  return (t: number): [number, number] => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [WORLD_CX + a * Math.sign(c) * Math.abs(c) ** (2 / p), WORLD_CY + b * Math.sign(s) * Math.abs(s) ** (2 / p)];
  };
}

/** A shape moved across the world, to centre one that is lopsided. */
function shifted(shape: (t: number) => [number, number], dx: number, dy: number) {
  return (t: number): [number, number] => {
    const [x, y] = shape(t);
    return [x + dx, y + dy];
  };
}

/**
 * A closed curve through hand-placed points, for a circuit no formula draws: a
 * centripetal Catmull-Rom spline (it never loops back on itself between two
 * points), walked at an even speed so the samples sit evenly along the road
 * and the start gate falls on the first point.
 */
function spline(points: ReadonlyArray<readonly [number, number]>) {
  const n = points.length;
  const STEPS = 48;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const knot = (a: readonly [number, number], b: readonly [number, number]) =>
      Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 0; s < STEPS; s++) {
      const t = t1 + ((t2 - t1) * s) / STEPS;
      const out: number[] = [];
      for (const k of [0, 1]) {
        const a1 = ((t1 - t) * p0[k] + t * p1[k]) / t1;
        const a2 = ((t2 - t) * p1[k] + (t - t1) * p2[k]) / (t2 - t1);
        const a3 = ((t3 - t) * p2[k] + (t - t2) * p3[k]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2;
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        out.push(((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1));
      }
      xs.push(out[0]);
      ys.push(out[1]);
    }
  }
  const m = xs.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i] + Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
  }
  const total = cum[m];
  return (t: number): [number, number] => {
    const d = ((t / (Math.PI * 2)) % 1) * total;
    let lo = 0;
    let hi = m;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const f = (d - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
    const j = (lo + 1) % m;
    return [xs[lo] + (xs[j] - xs[lo]) * f, ys[lo] + (ys[j] - ys[lo]) * f];
  };
}

/** "הנמל" (season 3), in driving order. Tune only before a season has raced it. */
export const HARBOR_POINTS: ReadonlyArray<readonly [number, number]> = [
  // The long straight and the start gate.
  [600, 620], [700, 612],
  // A fast left onto the climb, then a gentle sweep right and left.
  [780, 585], [818, 520], [822, 450],
  [805, 390], [815, 325], [795, 260],
  [760, 195], [695, 152],
  // Across the top, with a quick chicane.
  [645, 140], [592, 150], [540, 140], [480, 136],
  // Down into the infield, and round the hairpin.
  [415, 152], [372, 200], [372, 262], [392, 303], [428, 327],
  [476, 332], [510, 341], [535, 366], [544, 400], [535, 434], [510, 459], [476, 468],
  // Back out, and two slow lefts onto the straight.
  [410, 468], [335, 468], [303, 477], [280, 500], [271, 532],
  [273, 563], [281, 594], [304, 617], [335, 625], [420, 626], [510, 623],
];

/**
 * Every circuit there has ever been. A track is never removed from this list,
 * nor its shape changed: a race card names its track by id, and a replay of a
 * race from any season has to find exactly the circuit it was run on. Which of
 * them a season races on is the calendar's business (`trackForRound`), drawn
 * from `TRACK_POOLS` in `core/champ/rotation.ts`.
 *
 * The first four are the original rotation. The rest were added for season 2,
 * each checked by `scripts/driverCheck.ts` (flat out must lose to braking, and
 * the braking driver must stay off the walls) and kept wide enough that the
 * house cars see the flag in most races.
 */
export const TRACK_DEFS: TrackDef[] = [
  {
    id: 'oval',
    name: 'אליפסה',
    width: 120,
    samples: 240,
    shape: (t) => [WORLD_CX + 380 * Math.cos(t), WORLD_CY + 250 * Math.sin(t)],
  },
  {
    id: 'kidney',
    name: 'כליה',
    width: 105,
    samples: 260,
    shape: radial(330, [
      [0.17, 2, 0],
      [0.09, 3, 1.1],
    ]),
  },
  {
    id: 'technical',
    name: 'טכני',
    width: 88,
    samples: 300,
    shape: radial(300, [
      [0.17, 3, 0.4],
      [0.1, 5, 2.0],
      [0.07, 2, 1.0],
    ]),
  },
  {
    id: 'speedway',
    name: 'מהיר',
    width: 140,
    samples: 240,
    shape: radial(370, [
      [0.1, 2, 0.6],
      [0.045, 6, 0],
    ]),
  },
  // Mixed: four straights and four square corners, where braking is everything.
  {
    id: 'stadium',
    name: 'אצטדיון',
    width: 125,
    samples: 280,
    shape: superellipse(390, 240, 3.4),
  },
  // Fast: three long sweepers.
  {
    id: 'triangle',
    name: 'משולש',
    width: 140,
    samples: 260,
    shape: shifted(radial(340, [[0.11, 3, Math.PI / 2]]), 0, -25),
  },
  // Technical: a narrow road that never stops turning.
  {
    id: 'serpent',
    name: 'נחש',
    width: 100,
    samples: 320,
    shape: radial(310, [
      [0.06, 7, 0],
      [0.08, 2, 0.5],
    ]),
  },
  // Technical: four lobes, four pairs of corners.
  {
    id: 'clover',
    name: 'תלתן',
    width: 110,
    samples: 300,
    shape: radial(320, [[0.14, 4, Math.PI / 4]]),
  },
  // Mixed: a long open side and a tight, twisting one.
  {
    id: 'coast',
    name: 'חוף',
    width: 120,
    samples: 280,
    shape: shifted(
      radial(320, [
        [0.2, 1, 0],
        [0.08, 3, 0.8],
        [0.04, 5, 2.4],
      ]),
      -70,
      0,
    ),
  },
  // Fast: wide, nearly round, flat out almost everywhere - almost.
  {
    id: 'ring',
    name: 'טבעת',
    width: 150,
    samples: 260,
    shape: radial(
      370,
      [
        [0.04, 5, 0.3],
        [0.06, 2, 1.7],
      ],
      0.74,
    ),
  },
  // Season 3: a street circuit, narrow and slow, round a very tight hairpin.
  // Hand-placed points, since no formula draws a hairpin; the start gate sits
  // on the first point, far enough down the long straight for a full grid.
  {
    id: 'harbor',
    name: 'הנמל',
    width: 85,
    samples: 340,
    shape: spline(HARBOR_POINTS),
  },
];

/** Checkpoint gate every N centreline samples. */
const CP_STRIDE = 8;

export function buildTrack(def: TrackDef): Track {
  const n = def.samples;
  const center = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = def.shape((i / n) * Math.PI * 2);
    center[i * 2] = x;
    center[i * 2 + 1] = y;
  }

  const tangent = new Float32Array(n * 2);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const p = ((i - 1) + n) % n;
    const q = (i + 1) % n;
    let tx = center[q * 2] - center[p * 2];
    let ty = center[q * 2 + 1] - center[p * 2 + 1];
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;
    tangent[i * 2] = tx;
    tangent[i * 2 + 1] = ty;
    const nx = center[q * 2] - center[i * 2];
    const ny = center[q * 2 + 1] - center[i * 2 + 1];
    length += Math.hypot(nx, ny);
  }

  const half = def.width / 2;
  const inner = new Float32Array(n * 2);
  const outer = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    // Left normal of the tangent.
    const nx = -tangent[i * 2 + 1];
    const ny = tangent[i * 2];
    inner[i * 2] = center[i * 2] + nx * half;
    inner[i * 2 + 1] = center[i * 2 + 1] + ny * half;
    outer[i * 2] = center[i * 2] - nx * half;
    outer[i * 2 + 1] = center[i * 2 + 1] - ny * half;
  }

  const wallSegs = new Float32Array(n * 2 * 4);
  let w = 0;
  for (const wall of [inner, outer]) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      wallSegs[w++] = wall[i * 2];
      wallSegs[w++] = wall[i * 2 + 1];
      wallSegs[w++] = wall[j * 2];
      wallSegs[w++] = wall[j * 2 + 1];
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < wallSegs.length; i += 2) {
    minX = Math.min(minX, wallSegs[i]);
    maxX = Math.max(maxX, wallSegs[i]);
    minY = Math.min(minY, wallSegs[i + 1]);
    maxY = Math.max(maxY, wallSegs[i + 1]);
  }
  const pad = 20;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const grid = new SegmentGrid(wallSegs, minX, minY, maxX, maxY, Math.max(30, def.width * 0.6));

  const nCp = Math.floor(n / CP_STRIDE);
  const checkpoints = new Float32Array(nCp * 4);
  const cpIndex = new Int32Array(nCp);
  const cpMid = new Float32Array(nCp * 2);
  for (let c = 0; c < nCp; c++) {
    const i = c * CP_STRIDE;
    cpIndex[c] = i;
    checkpoints[c * 4] = inner[i * 2];
    checkpoints[c * 4 + 1] = inner[i * 2 + 1];
    checkpoints[c * 4 + 2] = outer[i * 2];
    checkpoints[c * 4 + 3] = outer[i * 2 + 1];
    cpMid[c * 2] = center[i * 2];
    cpMid[c * 2 + 1] = center[i * 2 + 1];
  }

  return {
    def,
    center,
    tangent,
    inner,
    outer,
    wallSegs,
    grid,
    checkpoints,
    cpIndex,
    cpMid,
    nCheckpoints: nCp,
    length,
    bounds: { minX, minY, maxX, maxY },
  };
}

/** Whether this build knows a circuit - a race card from newer code may not be. */
export function hasTrack(id: string): boolean {
  return TRACK_DEFS.some((d) => d.id === id);
}

const cache = new Map<string, Track>();

export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    const def = TRACK_DEFS.find((d) => d.id === id) ?? TRACK_DEFS[0];
    t = buildTrack(def);
    cache.set(def.id, t);
  }
  return t;
}

/** Do segments p1->p2 and p3->p4 properly intersect? Used for checkpoint gates. */
export function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d1x = x2 - x1;
  const d1y = y2 - y1;
  const d2x = x4 - x3;
  const d2y = y4 - y3;
  const denom = d1x * d2y - d1y * d2x;
  if (denom > -1e-12 && denom < 1e-12) return false;
  const qx = x3 - x1;
  const qy = y3 - y1;
  const t = (qx * d2y - qy * d2x) / denom;
  const u = (qx * d1y - qy * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

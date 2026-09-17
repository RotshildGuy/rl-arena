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

function radial(base: number, harmonics: Array<[number, number, number]>) {
  return (t: number): [number, number] => {
    let r = 1;
    for (const [amp, freq, phase] of harmonics) r += amp * Math.cos(freq * t + phase);
    const rr = base * r;
    return [WORLD_CX + rr * Math.cos(t), WORLD_CY + rr * Math.sin(t) * 0.78];
  };
}

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

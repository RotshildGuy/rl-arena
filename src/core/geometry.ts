/**
 * Uniform-grid spatial index over line segments.
 *
 * Casting nine sensor rays per car against ~250 wall segments brute force is the
 * hottest loop in turbo training; bucketing the segments and marching the ray
 * cell by cell (DDA) cuts it to a handful of tests per ray.
 *
 * Segments are stored flat: [x1, y1, x2, y2, x1, y1, ...].
 */
export class SegmentGrid {
  readonly segs: Float32Array;
  readonly nSegs: number;

  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;

  /** CSR buckets: items[start[c] .. start[c + 1]) are the segments touching cell c. */
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  /** Per-segment stamp so a segment spanning several cells is tested once per query. */
  private readonly stamp: Int32Array;
  private stampCounter = 0;

  constructor(segs: Float32Array, minX: number, minY: number, maxX: number, maxY: number, cell: number) {
    this.segs = segs;
    this.nSegs = segs.length >> 2;
    this.minX = minX;
    this.minY = minY;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cell));

    const nCells = this.cols * this.rows;
    const counts = new Int32Array(nCells);

    // Pass 1: count segments per cell (AABB rasterisation — slightly over-inclusive,
    // which only costs a few extra intersection tests).
    for (let s = 0; s < this.nSegs; s++) {
      const o = s << 2;
      const c0 = this.col(Math.min(segs[o], segs[o + 2]));
      const c1 = this.col(Math.max(segs[o], segs[o + 2]));
      const r0 = this.row(Math.min(segs[o + 1], segs[o + 3]));
      const r1 = this.row(Math.max(segs[o + 1], segs[o + 3]));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * this.cols + c]++;
    }

    this.start = new Int32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) this.start[c + 1] = this.start[c] + counts[c];
    this.items = new Int32Array(this.start[nCells]);

    // Pass 2: fill.
    const cursor = Int32Array.from(this.start.subarray(0, nCells));
    for (let s = 0; s < this.nSegs; s++) {
      const o = s << 2;
      const c0 = this.col(Math.min(segs[o], segs[o + 2]));
      const c1 = this.col(Math.max(segs[o], segs[o + 2]));
      const r0 = this.row(Math.min(segs[o + 1], segs[o + 3]));
      const r1 = this.row(Math.max(segs[o + 1], segs[o + 3]));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.items[cursor[r * this.cols + c]++] = s;
    }

    this.stamp = new Int32Array(this.nSegs).fill(-1);
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cell)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / this.cell)));
  }

  /**
   * Distance from (ox, oy) along the unit vector (dx, dy) to the nearest segment,
   * or `maxDist` if nothing is hit within range.
   */
  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number): number {
    const mark = ++this.stampCounter;
    let best = maxDist;

    let cx = this.col(ox);
    let cy = this.row(oy);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    // Distance along the ray to the next cell boundary, and per-cell increments.
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(this.cell / dx);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(this.cell / dy);
    const cellMinX = this.minX + cx * this.cell;
    const cellMinY = this.minY + cy * this.cell;
    let tMaxX =
      stepX === 0 ? Infinity : stepX > 0 ? (cellMinX + this.cell - ox) / dx : (cellMinX - ox) / dx;
    let tMaxY =
      stepY === 0 ? Infinity : stepY > 0 ? (cellMinY + this.cell - oy) / dy : (cellMinY - oy) / dy;

    let tEnter = 0;
    while (tEnter <= best) {
      const base = (cy * this.cols + cx) | 0;
      const end = this.start[base + 1];
      for (let k = this.start[base]; k < end; k++) {
        const s = this.items[k];
        if (this.stamp[s] === mark) continue;
        this.stamp[s] = mark;
        const t = raySegment(ox, oy, dx, dy, this.segs, s << 2);
        if (t >= 0 && t < best) best = t;
      }

      if (tMaxX < tMaxY) {
        cx += stepX;
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        if (cx < 0 || cx >= this.cols) break;
      } else {
        cy += stepY;
        tEnter = tMaxY;
        tMaxY += tDeltaY;
        if (cy < 0 || cy >= this.rows) break;
      }
      if (!isFinite(tEnter)) break;
    }
    return best;
  }

  /**
   * Deepest overlap of a circle at (x, y) with any segment.
   * Returns penetration depth (0 if clear) and writes the outward push direction
   * into `outNormal`.
   */
  circleOverlap(x: number, y: number, radius: number, outNormal: Float32Array): number {
    const c0 = this.col(x - radius);
    const c1 = this.col(x + radius);
    const r0 = this.row(y - radius);
    const r1 = this.row(y + radius);
    const mark = ++this.stampCounter;
    let deepest = 0;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const base = r * this.cols + c;
        const end = this.start[base + 1];
        for (let k = this.start[base]; k < end; k++) {
          const s = this.items[k];
          if (this.stamp[s] === mark) continue;
          this.stamp[s] = mark;
          const o = s << 2;
          const ax = this.segs[o];
          const ay = this.segs[o + 1];
          const ex = this.segs[o + 2] - ax;
          const ey = this.segs[o + 3] - ay;
          const len2 = ex * ex + ey * ey;
          let u = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const px = x - (ax + u * ex);
          const py = y - (ay + u * ey);
          const d2 = px * px + py * py;
          if (d2 >= radius * radius) continue;
          const d = Math.sqrt(d2);
          const depth = radius - d;
          if (depth > deepest) {
            deepest = depth;
            if (d > 1e-6) {
              outNormal[0] = px / d;
              outNormal[1] = py / d;
            } else {
              outNormal[0] = -ey;
              outNormal[1] = ex;
              const n = Math.hypot(outNormal[0], outNormal[1]) || 1;
              outNormal[0] /= n;
              outNormal[1] /= n;
            }
          }
        }
      }
    }
    return deepest;
  }
}

/** Ray/segment intersection. Returns the ray parameter t >= 0, or -1 if no hit. */
function raySegment(ox: number, oy: number, dx: number, dy: number, segs: Float32Array, o: number): number {
  const ax = segs[o];
  const ay = segs[o + 1];
  const sx = segs[o + 2] - ax;
  const sy = segs[o + 3] - ay;
  const denom = dx * sy - dy * sx;
  if (denom > -1e-9 && denom < 1e-9) return -1;
  const qx = ax - ox;
  const qy = ay - oy;
  const t = (qx * sy - qy * sx) / denom;
  if (t < 0) return -1;
  const u = (qx * dy - qy * dx) / denom;
  if (u < 0 || u > 1) return -1;
  return t;
}

/** Signed cross product of (b - a) and (c - a); >0 means c is left of a->b. */
export function cross2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

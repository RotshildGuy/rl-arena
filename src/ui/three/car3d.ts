import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_RADIUS } from '../../core/games/racing/env';
import { DECAL_SYMBOL, darker, drawEmblem, drawVisor, type CarLook, type CarShape } from '../../core/games/racing/render';
import { EMBLEM_SYMBOLS } from '../../core/champ/emblem';

/**
 * The 3D car, version 2: an open-wheel racing car instead of the 2D outline
 * pulled up into a slab.
 *
 * Same footprint as before (`LEN` x `WID`, matched to `CAR_RADIUS`), same axes:
 * x is the nose, y is up, z is the car's right. Everything is built in code,
 * so every part of a team's look still lands on it: the body colour and
 * pattern, the second colour, the wings, the rims and the band on the tyre
 * wall, the helmet and its design, the number and the emblem, and the body
 * shape, which changes the nose and the sidepods.
 *
 * Built for a phone: the parts that share a material are merged into one mesh,
 * so a car is about ten draw calls, and the wheels stay separate so they can
 * spin and steer.
 */

export const LEN = CAR_RADIUS * 1.95;
export const WID = CAR_RADIUS * 1.15;

export interface CarPaint {
  color: string;
  look?: CarLook;
}

export interface Car3D {
  group: THREE.Group;
  /** Front left, front right, rear left, rear right. Spin on z; the front pair steers on y. */
  wheels: THREE.Group[];
  dispose(): void;
}

// ------------------------------------------------------------- proportions

/** Front and rear axle, along the car. */
const AXLE_F = LEN * 0.26;
const AXLE_R = -LEN * 0.29;
const TYRE_F = { r: WID * 0.2, w: WID * 0.19 };
const TYRE_R = { r: WID * 0.215, w: WID * 0.24 };
/** Ride height of the floor. */
const FLOOR_Y = WID * 0.05;

/** Per body shape: how long and how low the nose runs, and how big and how far forward the sidepods are. */
const SHAPE: Record<CarShape, { nose: number; noseW: number; podX: number; podW: number; podH: number }> = {
  classic: { nose: 1, noseW: 1, podX: 0, podW: 1, podH: 1 },
  wedge: { nose: 1, noseW: 0.8, podX: -0.03, podW: 1.05, podH: 0.9 },
  arrow: { nose: 0.97, noseW: 0.9, podX: 0.05, podW: 0.85, podH: 1 },
  bulldog: { nose: 0.95, noseW: 1.3, podX: 0, podW: 1.15, podH: 1.12 },
};

// ------------------------------------------------------------- geometry helpers

interface Section {
  /** Along the car. */
  x: number;
  /** Full width and height of the cross-section. */
  w: number;
  h: number;
  /** Bottom of the section. */
  y: number;
  /** Centre across the car (sidepods sit off the middle). */
  z?: number;
}

/**
 * A smooth body through a row of cross-sections, each a rounded rectangle
 * (a superellipse). Three material groups: the skin, the front cap, the back
 * cap - so a sidepod can have a dark inlet. UVs are a top-down projection in
 * car units, which is how the livery canvas is laid out.
 */
function loft(sections: Section[], segs = 20, round = 3): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring = segs + 1;
  const e = 2 / round;
  const point = (s: Section, a: number): [number, number, number] => {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const z = (s.z ?? 0) + (s.w / 2) * Math.sign(c) * Math.abs(c) ** e;
    const y = s.y + s.h / 2 + (s.h / 2) * Math.sign(sn) * Math.abs(sn) ** e;
    return [s.x, y, z];
  };
  // The seam at the bottom, where nobody looks.
  for (const s of sections) {
    for (let k = 0; k <= segs; k++) {
      const p = point(s, -Math.PI / 2 + (k / segs) * Math.PI * 2);
      pos.push(...p);
      uv.push(...liveryUV(p[0], p[2]));
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * ring + k;
      const b = a + ring;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const skin = idx.length;
  // Caps, with their own vertices so the edge stays crisp.
  const cap = (s: Section, flip: boolean) => {
    const base = pos.length / 3;
    pos.push(s.x, s.y + s.h / 2, s.z ?? 0);
    uv.push(...liveryUV(s.x, s.z ?? 0));
    for (let k = 0; k <= segs; k++) {
      const p = point(s, -Math.PI / 2 + (k / segs) * Math.PI * 2);
      pos.push(...p);
      uv.push(...liveryUV(p[0], p[2]));
    }
    for (let k = 0; k < segs; k++) {
      if (flip) idx.push(base, base + 2 + k, base + 1 + k);
      else idx.push(base, base + 1 + k, base + 2 + k);
    }
  };
  // The first section is the front of the car, so its cap faces +x.
  cap(sections[0], false);
  const front = idx.length;
  cap(sections[sections.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, skin, 0);
  g.addGroup(skin, front - skin, 1);
  g.addGroup(front, idx.length - front, 2);
  g.computeVertexNormals();
  return g;
}

/** The livery canvas covers this much of the car, centred. */
const SPAN_X = LEN * 1.1;
const SPAN_Z = WID * 1.1;
function liveryUV(x: number, z: number): [number, number] {
  return [x / SPAN_X + 0.5, z / SPAN_Z + 0.5];
}

/** A wing element: a cambered airfoil across the car, `chord` long, tilted by `aoa`. */
function airfoil(chord: number, thick: number, span: number, aoa: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // Leading edge at +x, trailing edge at -x; the camber pushes the middle down (a wing pulls the car down).
  s.moveTo(chord / 2, 0);
  s.bezierCurveTo(chord * 0.45, thick, chord * 0.1, thick * 0.9, -chord / 2, thick * 0.15);
  s.lineTo(-chord / 2, -thick * 0.05);
  s.bezierCurveTo(chord * 0.1, -thick * 0.6, chord * 0.45, -thick * 0.7, chord / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -span / 2);
  g.rotateZ(aoa);
  return g;
}

/**
 * A wing curved back towards its tips, as one smooth surface: the airfoil is
 * swept along the span, `x` at the middle and `sweep` further back at each
 * end, its chord tapering to `tipChord`.
 */
function sweptWing(chord: number, tipChord: number, thick: number, span: number, aoa: number, x: number, y: number, sweep: number, stations = 17): THREE.BufferGeometry[] {
  // The same profile as `airfoil`, for a unit chord, as a closed outline.
  const s = new THREE.Shape();
  s.moveTo(0.5, 0);
  s.bezierCurveTo(0.45, thick / chord, 0.1, (thick * 0.9) / chord, -0.5, (thick * 0.15) / chord);
  s.lineTo(-0.5, (-thick * 0.05) / chord);
  s.bezierCurveTo(0.1, (-thick * 0.6) / chord, 0.45, (-thick * 0.7) / chord, 0.5, 0);
  const outline = s.getPoints(6);
  if (outline[outline.length - 1].distanceTo(outline[0]) < 1e-6) outline.pop();
  const n = outline.length;
  const cos = Math.cos(aoa);
  const sin = Math.sin(aoa);
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (k: number): [number, number, number] => {
    const z = -span / 2 + (span * k) / (stations - 1);
    const t = Math.abs(z) / (span / 2);
    return [x - sweep * t * t, z, chord + (tipChord - chord) * t];
  };
  for (let k = 0; k < stations; k++) {
    const [cx, z, c] = at(k);
    for (const p of outline) {
      const px = p.x * c;
      const py = p.y * c;
      pos.push(cx + px * cos - py * sin, y + px * sin + py * cos, z);
    }
  }
  for (let k = 0; k < stations - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      idx.push(a, a + n, b, b, a + n, b + n);
    }
  }
  // End caps, as fans.
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i + 1, i);
    const e = (stations - 1) * n;
    idx.push(e, e + i, e + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return [g];
}

function box(x: number, y: number, z: number, w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A round bar from `a` to `b`: suspension arms, the halo's strut, mirror stalks. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Merge parts that share a material; drops UVs where some parts have none. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    return g;
  });
  const out = mergeGeometries(clean, false)!;
  for (const p of [...parts, ...clean]) if (p !== out) p.dispose();
  return out;
}

// ------------------------------------------------------------- materials and textures

/**
 * The dark parts. Every car gets its own, because a car out of the race fades
 * by changing its materials' opacity, and the scene disposes a car's materials
 * with it.
 */
function darkMats() {
  return {
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.42, metalness: 0.25, map: carbonTexture() }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.92, metalness: 0 }),
    black: new THREE.MeshBasicMaterial({ color: 0x050608 }),
  };
}

function paintMat(map: THREE.Texture | null, color?: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map,
    color: color ?? 0xffffff,
    roughness: 0.38,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
}

function carbonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 32; y += 4) {
    for (let x = 0; x < 32; x += 4) {
      const v = ((x + y) / 4) % 2 ? 40 : 30;
      ctx.fillStyle = `rgb(${v}, ${v + 2}, ${v + 6})`;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The body paint, top-down, in the same layout as the 2D car: pattern, emblem on the nose, number on the engine cover. */
function liveryTexture(color: string, secondary: string, look: CarLook | undefined): THREE.CanvasTexture {
  const W = 512;
  const H = Math.round((W * SPAN_Z) / SPAN_X);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(W / 2, H / 2);
  ctx.scale(W / SPAN_X, H / SPAN_Z);
  const len = LEN;
  const wid = WID;

  if (look?.pattern === 'fade') {
    const g = ctx.createLinearGradient(len * 0.3, 0, -len * 0.45, 0);
    g.addColorStop(0, color);
    g.addColorStop(1, secondary);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fillRect(-SPAN_X / 2, -SPAN_Z / 2, SPAN_X, SPAN_Z);

  ctx.fillStyle = secondary;
  if (look?.pattern === 'stripe') {
    ctx.fillRect(-len * 0.6, -wid * 0.045, len * 1.2, wid * 0.09);
  } else if (look?.pattern === 'twotone') {
    ctx.fillRect(-len * 0.6, -wid * 0.6, len * 0.52, wid * 1.2);
  } else if (look?.pattern === 'chevron') {
    for (const at of [0.34, 0.02]) {
      ctx.beginPath();
      ctx.moveTo(len * at, 0);
      ctx.lineTo(len * (at - 0.2), -wid * 0.5);
      ctx.lineTo(len * (at - 0.28), -wid * 0.5);
      ctx.lineTo(len * (at - 0.08), 0);
      ctx.lineTo(len * (at - 0.28), wid * 0.5);
      ctx.lineTo(len * (at - 0.2), wid * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  } else if (look?.pattern === 'centerline') {
    ctx.fillRect(-len * 0.6, -wid * 0.08, len * 1.2, wid * 0.03);
    ctx.fillRect(-len * 0.6, wid * 0.05, len * 1.2, wid * 0.03);
  }

  if (look?.emblem) {
    ctx.save();
    ctx.translate(len * 0.22, 0);
    ctx.rotate(Math.PI / 2);
    drawEmblem(ctx, look.emblem, wid * 0.13);
    ctx.restore();
  }
  // A sticker on the top of each sidepod (a pack prize).
  const decal = look?.decal ? EMBLEM_SYMBOLS[DECAL_SYMBOL[look.decal]] : undefined;
  if (decal) {
    const d = new Path2D(decal);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(-len * 0.04, side * wid * 0.22);
      ctx.rotate(Math.PI / 2);
      const k = (wid * 0.11) / 24;
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
  if (look?.number !== undefined) {
    ctx.save();
    ctx.translate(-len * 0.3, 0);
    ctx.rotate(Math.PI / 2);
    const size = wid * (look.number > 9 ? 0.1 : 0.12);
    ctx.font = `800 ${size}px Heebo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(5, 6, 10, 0.9)';
    ctx.lineWidth = size * 0.18;
    ctx.lineJoin = 'round';
    ctx.strokeText(String(look.number), 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(look.number), 0, 0);
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

/** The outside face of a wheel: the rim with its spokes, the tyre wall, the coloured band. */
function wheelFaceTexture(rim: string | undefined, band: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const m = S / 2;
  ctx.translate(m, m);
  // Tyre wall.
  ctx.fillStyle = '#1b1c20';
  ctx.beginPath();
  ctx.arc(0, 0, m, 0, Math.PI * 2);
  ctx.fill();
  // The band round the wall, like a compound marking.
  ctx.strokeStyle = band;
  ctx.lineWidth = m * 0.07;
  ctx.beginPath();
  ctx.arc(0, 0, m * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  // Rim.
  const rimR = m * 0.62;
  ctx.fillStyle = rim ?? '#2a2d34';
  ctx.beginPath();
  ctx.arc(0, 0, rimR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, rimR * 0.88, 0, Math.PI * 2);
  ctx.fill();
  // Spokes: these are what show the wheel turning.
  ctx.fillStyle = rim ?? '#3a3e47';
  for (let k = 0; k < 10; k++) {
    ctx.save();
    ctx.rotate((k / 10) * Math.PI * 2);
    ctx.fillRect(-rimR * 0.05, rimR * 0.2, rimR * 0.1, rimR * 0.7);
    ctx.restore();
  }
  // Wheel nut.
  ctx.fillStyle = '#c9ced8';
  ctx.beginPath();
  ctx.arc(0, 0, rimR * 0.18, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function helmetTexture(base: string, visor: NonNullable<CarLook['visor']> | undefined, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 128);
  if (visor) {
    // The 2D design, seen from above, wrapped round the top of the sphere.
    ctx.save();
    ctx.translate(128, 64);
    ctx.scale(1, 0.5);
    drawVisor(ctx, 0, 60, visor, color);
    ctx.restore();
  }
  // The visor itself: a dark band round the front.
  ctx.fillStyle = 'rgba(12, 14, 20, 0.95)';
  ctx.fillRect(160, 50, 64, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------- the car

export function buildCar(paint: CarPaint): Car3D {
  const { color, look } = paint;
  const secondary = look?.secondary ?? darker(color);
  const wingColor = look?.wing ?? secondary;
  const shape = SHAPE[look?.shape ?? 'classic'] ?? SHAPE.classic;
  const mats = darkMats();
  const own: Array<{ dispose(): void }> = [mats.carbon.map!, mats.carbon, mats.rubber, mats.black];

  const livery = liveryTexture(color, secondary, look);
  const body = paintMat(livery);
  const wing = paintMat(null, wingColor);
  own.push(livery, body, wing);

  const group = new THREE.Group();
  const L = LEN;
  const W = WID;
  const nw = shape.noseW;

  // --- the chassis: nose, cockpit, airbox and engine cover in one smooth body.
  const tip = 0.5 * shape.nose;
  const chassis = loft([
    { x: L * tip, w: W * 0.05 * nw, h: W * 0.04, y: W * 0.1 },
    { x: L * (tip - 0.04), w: W * 0.09 * nw, h: W * 0.08, y: W * 0.095 },
    { x: L * 0.36, w: W * 0.12 * nw, h: W * 0.12, y: W * 0.1 },
    { x: L * 0.26, w: W * 0.15 * nw, h: W * 0.17, y: W * 0.09 },
    { x: L * 0.15, w: W * 0.19, h: W * 0.22, y: W * 0.075 },
    { x: L * 0.06, w: W * 0.22, h: W * 0.25, y: W * 0.07 },
    { x: -L * 0.04, w: W * 0.22, h: W * 0.26, y: W * 0.07 },
    // The airbox rises over the driver's head.
    { x: -L * 0.09, w: W * 0.18, h: W * 0.42, y: W * 0.07 },
    { x: -L * 0.15, w: W * 0.17, h: W * 0.42, y: W * 0.07 },
    { x: -L * 0.24, w: W * 0.15, h: W * 0.32, y: W * 0.07 },
    { x: -L * 0.34, w: W * 0.12, h: W * 0.2, y: W * 0.07 },
    { x: -L * 0.43, w: W * 0.08, h: W * 0.12, y: W * 0.08 },
    { x: -L * 0.47, w: W * 0.05, h: W * 0.07, y: W * 0.1 },
  ]);
  group.add(new THREE.Mesh(chassis, [body, body, mats.carbon]));

  // --- sidepods, each with a dark inlet at the front.
  const px = shape.podX;
  const pw = shape.podW;
  const ph = shape.podH;
  for (const side of [-1, 1]) {
    const pod = loft([
      { x: L * (0.12 + px), w: W * 0.12 * pw, h: W * 0.15 * ph, y: W * 0.08, z: side * W * 0.215 },
      { x: L * (0.09 + px), w: W * 0.15 * pw, h: W * 0.17 * ph, y: W * 0.075, z: side * W * 0.22 },
      { x: L * (-0.04 + px), w: W * 0.15 * pw, h: W * 0.17 * ph, y: W * 0.07, z: side * W * 0.215 },
      { x: L * -0.16, w: W * 0.11 * pw, h: W * 0.13 * ph, y: W * 0.07, z: side * W * 0.17 },
      { x: L * -0.27, w: W * 0.06, h: W * 0.08, y: W * 0.07, z: side * W * 0.12 },
      { x: L * -0.33, w: W * 0.03, h: W * 0.04, y: W * 0.08, z: side * W * 0.08 },
    ], 16);
    group.add(new THREE.Mesh(pod, [body, mats.black, body]));
  }

  // --- the carbon parts, merged: floor, wing mains, endplates, halo, suspension, mirrors.
  const carbon: THREE.BufferGeometry[] = [];

  // Floor: wide between the axles, a lip at the edges.
  const floor = new THREE.Shape();
  floor.moveTo(L * 0.2, -W * 0.12);
  floor.lineTo(L * 0.12, -W * 0.29);
  floor.lineTo(-L * 0.12, -W * 0.34);
  floor.lineTo(-L * 0.2, -W * 0.24);
  floor.lineTo(-L * 0.44, -W * 0.16);
  floor.lineTo(-L * 0.44, W * 0.16);
  floor.lineTo(-L * 0.2, W * 0.24);
  floor.lineTo(-L * 0.12, W * 0.34);
  floor.lineTo(L * 0.12, W * 0.29);
  floor.lineTo(L * 0.2, W * 0.12);
  const floorGeo = new THREE.ExtrudeGeometry(floor, { depth: W * 0.025, bevelEnabled: false });
  floorGeo.rotateX(Math.PI / 2);
  floorGeo.translate(0, FLOOR_Y + W * 0.025, 0);
  carbon.push(floorGeo);

  // Front wing: the main plane in carbon, the flaps in the wing colour, endplates
  // just ahead of the front tyres. The wing curves back towards its tips, so the
  // whole car stays inside the circle the physics sees (`CAR_RADIUS`): a car can
  // never be drawn into a wall or a rival it has not touched.
  const fwX = L * 0.465;
  const fwSpan = W * 0.9;
  const fwSweep = L * 0.075;
  carbon.push(...sweptWing(L * 0.09, L * 0.06, W * 0.025, fwSpan, 0.05, fwX, W * 0.06, fwSweep));
  for (const s of [-1, 1]) carbon.push(box(fwX - fwSweep - L * 0.005, W * 0.085, s * fwSpan / 2, L * 0.06, W * 0.09, W * 0.012));
  const wingParts: THREE.BufferGeometry[] = [
    ...sweptWing(L * 0.055, L * 0.04, W * 0.02, fwSpan * 0.97, 0.32, fwX - L * 0.05, W * 0.095, fwSweep),
    ...sweptWing(L * 0.04, L * 0.03, W * 0.016, fwSpan * 0.94, 0.55, fwX - L * 0.085, W * 0.135, fwSweep),
  ];

  // Rear wing: a swan-neck pylon, the main plane, the flap above it, endplates
  // that clear the rear tyres.
  const rwX = -L * 0.415;
  const rwSpan = W * 0.7;
  const rwY = W * 0.44;
  carbon.push(translate(airfoil(L * 0.07, W * 0.03, rwSpan, -0.12), rwX, rwY, 0));
  wingParts.push(translate(airfoil(L * 0.05, W * 0.022, rwSpan, -0.45), rwX - L * 0.012, rwY + W * 0.06, 0));
  for (const s of [-1, 1]) carbon.push(box(rwX - L * 0.02, rwY, s * rwSpan / 2, L * 0.07, W * 0.16, W * 0.014));
  carbon.push(box(rwX + L * 0.03, W * 0.3, 0, L * 0.04, W * 0.2, W * 0.025));
  // Beam wing low down, over the diffuser.
  carbon.push(translate(airfoil(L * 0.045, W * 0.018, W * 0.46, -0.2), rwX + L * 0.01, W * 0.19, 0));

  // Halo: a loop round the driver's head on a strut from the front.
  const halo = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-L * 0.1, W * 0.3, -W * 0.095),
    new THREE.Vector3(-L * 0.02, W * 0.37, -W * 0.1),
    new THREE.Vector3(L * 0.05, W * 0.38, -W * 0.05),
    new THREE.Vector3(L * 0.065, W * 0.38, 0),
    new THREE.Vector3(L * 0.05, W * 0.38, W * 0.05),
    new THREE.Vector3(-L * 0.02, W * 0.37, W * 0.1),
    new THREE.Vector3(-L * 0.1, W * 0.3, W * 0.095),
  ]);
  carbon.push(new THREE.TubeGeometry(halo, 24, W * 0.016, 6, false));
  carbon.push(rod(new THREE.Vector3(L * 0.065, W * 0.38, 0), new THREE.Vector3(L * 0.1, W * 0.31, 0), W * 0.016));

  // Suspension: two wishbones and a push rod to each wheel.
  for (const [ax, tyre] of [[AXLE_F, TYRE_F], [AXLE_R, TYRE_R]] as const) {
    const hubZ = W / 2 - tyre.w / 2;
    for (const s of [-1, 1]) {
      const hub = (dy: number) => new THREE.Vector3(ax, tyre.r + dy, s * (hubZ - tyre.w * 0.45));
      const inner = (dx: number, y: number) => new THREE.Vector3(ax + dx, y, s * W * 0.09);
      const r = W * 0.012;
      carbon.push(rod(inner(L * 0.05, W * 0.2), hub(W * 0.06), r), rod(inner(-L * 0.05, W * 0.2), hub(W * 0.06), r));
      carbon.push(rod(inner(L * 0.05, W * 0.11), hub(-W * 0.05), r), rod(inner(-L * 0.05, W * 0.11), hub(-W * 0.05), r));
    }
  }

  // Mirrors on stalks either side of the cockpit.
  for (const s of [-1, 1]) {
    carbon.push(rod(new THREE.Vector3(L * 0.07, W * 0.3, s * W * 0.1), new THREE.Vector3(L * 0.07, W * 0.35, s * W * 0.19), W * 0.01));
    carbon.push(box(L * 0.07, W * 0.36, s * W * 0.2, L * 0.02, W * 0.035, W * 0.07));
  }

  // T-cam on top of the airbox, and the shark fin down the engine cover.
  carbon.push(box(-L * 0.11, W * 0.5, 0, L * 0.03, W * 0.02, W * 0.08));
  const fin = new THREE.Shape();
  fin.moveTo(-L * 0.15, 0);
  fin.lineTo(-L * 0.42, 0);
  fin.lineTo(-L * 0.42, W * 0.16);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: W * 0.008, bevelEnabled: false });
  finGeo.translate(0, W * 0.32, -W * 0.004);
  group.add(new THREE.Mesh(finGeo, body));
  own.push(finGeo);

  const carbonGeo = merge(carbon);
  const wingGeo = merge(wingParts);
  group.add(new THREE.Mesh(carbonGeo, mats.carbon), new THREE.Mesh(wingGeo, wing));
  own.push(chassis, carbonGeo, wingGeo);

  // Cockpit opening and the airbox intake: dark, slightly sunk into the body.
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mats.black);
  cockpit.scale.set(L * 0.1, W * 0.04, W * 0.085);
  cockpit.position.set(-L * 0.01, W * 0.32, 0);
  const intake = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mats.black);
  intake.scale.set(L * 0.01, W * 0.055, W * 0.055);
  intake.position.set(-L * 0.085, W * 0.41, 0);
  group.add(cockpit, intake);
  own.push(cockpit.geometry, intake.geometry);

  // Helmet, sitting in the cockpit under the halo.
  const helmetTex = helmetTexture(look?.helmet ?? '#f4f6fb', look?.visor, secondary);
  const helmetMat = paintMat(helmetTex);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(W * 0.075, 20, 14), helmetMat);
  helmet.position.set(-L * 0.035, W * 0.36, 0);
  group.add(helmet);
  own.push(helmetTex, helmetMat, helmet.geometry);

  // --- wheels: separate groups so they can spin and the fronts can steer.
  const rimMat = new THREE.MeshStandardMaterial({ map: wheelFaceTexture(look?.rim, look?.rim ?? '#e8eaee'), roughness: 0.5, metalness: 0.4 });
  own.push(rimMat.map!, rimMat);
  const wheels: THREE.Group[] = [];
  for (const [ax, tyre] of [[AXLE_F, TYRE_F], [AXLE_R, TYRE_R]] as const) {
    const tyreGeo = tyreGeometry(tyre.r, tyre.w);
    const faceGeo = new THREE.CircleGeometry(tyre.r * 0.93, 32);
    own.push(tyreGeo, faceGeo);
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(ax, tyre.r, s * (W / 2 - tyre.w / 2));
      w.userData.r = tyre.r;
      w.add(new THREE.Mesh(tyreGeo, mats.rubber));
      for (const f of [-1, 1]) {
        const face = new THREE.Mesh(faceGeo, rimMat);
        face.position.z = f * (tyre.w / 2 + 0.01);
        if (f < 0) face.rotation.y = Math.PI;
        w.add(face);
      }
      group.add(w);
      wheels.push(w);
    }
  }

  return {
    group,
    wheels,
    dispose() {
      for (const d of own) d.dispose();
    },
  };
}

/** A tyre: rounded shoulders, a flat tread, turned round the axle (z). */
function tyreGeometry(r: number, w: number): THREE.BufferGeometry {
  const hw = w / 2;
  const inner = r * 0.6;
  const sh = r * 0.14;
  const pts = [
    new THREE.Vector2(inner, -hw),
    new THREE.Vector2(r - sh, -hw),
    new THREE.Vector2(r - sh * 0.3, -hw * 0.92),
    new THREE.Vector2(r, -hw * 0.6),
    new THREE.Vector2(r, hw * 0.6),
    new THREE.Vector2(r - sh * 0.3, hw * 0.92),
    new THREE.Vector2(r - sh, hw),
    new THREE.Vector2(inner, hw),
  ];
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateX(Math.PI / 2);
  return g;
}

function translate(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

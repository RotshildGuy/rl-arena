import * as THREE from 'three';
import { getTrack, type Track } from '../../core/games/racing/tracks';
import { CAR_RADIUS, type RacingSnapshot } from '../../core/games/racing/env';
import { BODY_SHAPES, darker, drawCarLivery, hasKerb, type CarLook } from '../../core/games/racing/render';
import { mulberry32 } from '../../core/rng';
import type { CameraSpec } from './director';

/**
 * The race in 3D, for the broadcast.
 *
 * World coordinates are the simulation's own: x stays x, the 2D y becomes z,
 * and y points up. Nothing here feeds back into the race - it is a picture of
 * the snapshot the same deterministic simulation produces for the 2D view.
 *
 * Built for a phone first: no shadow maps (a soft blob under each car), one
 * merged mesh per kind of scenery, instanced trees, and the pixel ratio capped.
 */

/**
 * One size for the car on every shot, matched to the physics: two cars touch
 * when their centres are 2 x `CAR_RADIUS` apart, so a car about that long meets
 * the car ahead nose to tail exactly when the physics says they touch, and
 * never looks as if it drove into it. (A car drawn larger on the wide shots
 * seemed to sink into its neighbours, and changed size with every cut.)
 */
const LEN = CAR_RADIUS * 1.95;
const WID = CAR_RADIUS * 1.15;
/** How see-through a car that is out of the race is, as on the 2D view. */
const GHOST_OPACITY = 0.3;
const BODY_H = WID * 0.28;
const WHEEL_R = WID * 0.17;

const SKY = 0x9cc7f0;
const GRASS = 0x4c8a3f;
const ASPHALT = 0x3b404c;
const GRAVEL = 0xcdbb8f;

export interface CarPaint {
  color: string;
  look?: CarLook;
}

interface CarRig {
  group: THREE.Group;
  smoke: THREE.Sprite[];
  sparks: THREE.Sprite;
  key: string;
  ghost: boolean;
}

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 4, 6000);
  private trackId = '';
  private trackGroup: THREE.Group | null = null;
  private track: Track | null = null;
  private cars: CarRig[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  // Camera state, smoothed between frames.
  /** Where the camera looks, as an offset from the car it is on, and how fast that offset is moving. */
  private lookOff = new THREE.Vector3();
  private lookVel = new THREE.Vector3();
  private fov = 48;
  private heading = 0;
  private lastSpec: CameraSpec | null = null;
  /** The fixed spot a trackside shot films from. */
  private anchor: THREE.Vector3 | null = null;

  private readonly smokeTex: THREE.Texture;
  private readonly sparkTex: THREE.Texture;
  private readonly shadowTex: THREE.Texture;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 1100, 3200);

    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a5a30, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(400, 700, 250);
    this.scene.add(sun);

    this.smokeTex = radialTexture('rgba(235,238,245,0.9)', 'rgba(235,238,245,0)');
    this.sparkTex = radialTexture('rgba(255,220,120,1)', 'rgba(255,120,40,0)');
    this.shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
    this.disposables.push(this.smokeTex, this.sparkTex, this.shadowTex);
  }

  setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** The circuit, built once per track. */
  private ensureTrack(id: string): void {
    if (this.trackId === id && this.trackGroup) return;
    if (this.trackGroup) {
      this.scene.remove(this.trackGroup);
      disposeTree(this.trackGroup);
    }
    this.track = getTrack(id);
    this.trackGroup = buildTrack(this.track);
    this.scene.add(this.trackGroup);
    this.trackId = id;
    this.lastSpec = null;
  }

  /** Cars, rebuilt only when a car's paint changes. */
  private dropCar(rig: CarRig): void {
    this.scene.remove(rig.group, rig.sparks, ...rig.smoke);
    disposeTree(rig.group);
    for (const s of [...rig.smoke, rig.sparks]) s.material.dispose();
  }

  private ensureCars(paints: CarPaint[]): void {
    while (this.cars.length > paints.length) this.dropCar(this.cars.pop()!);
    for (let i = 0; i < paints.length; i++) {
      const p = paints[i];
      const rig = this.cars[i];
      const key = JSON.stringify(p);
      if (rig && rig.key === key) continue;
      if (rig) this.dropCar(rig);
      const group = buildCar(p, this.shadowTex);
      this.scene.add(group);
      const smoke = [0, 1, 2, 3].map(() => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: smokeColor(p.look), transparent: true, depthWrite: false }));
        s.visible = false;
        this.scene.add(s);
        return s;
      });
      const sparks = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sparks.visible = false;
      this.scene.add(sparks);
      this.cars[i] = { group, smoke, sparks, key, ghost: false };
    }
  }

  /**
   * One frame: place the cars from the snapshot, move the camera, draw.
   * `dt` is the wall-clock time since the last frame, in seconds.
   */
  render(snap: RacingSnapshot, paints: CarPaint[], spec: CameraSpec, dt: number): void {
    this.ensureTrack(snap.trackId);
    this.ensureCars(paints);
    const scale = 1;

    for (let i = 0; i < this.cars.length; i++) {
      const rig = this.cars[i];
      const c = snap.cars[i];
      if (!c) {
        rig.group.visible = false;
        continue;
      }
      rig.group.visible = true;
      rig.group.position.set(c.x, 0, c.y);
      rig.group.rotation.y = -c.angle;
      rig.group.scale.setScalar(scale);
      if (rig.ghost !== c.done) setGhost(rig, c.done);

      // Smoke off the rear wheels while sliding, along the way the car is travelling.
      const slip = c.sliding && !c.done ? Math.min(4, Math.abs(c.slip)) : 0;
      const fwd = Math.sqrt(Math.max(0, c.speed * c.speed - c.slip * c.slip));
      const travel = c.angle + Math.atan2(c.slip, fwd);
      rig.smoke.forEach((s, k) => {
        s.visible = slip > 0.3;
        if (!s.visible) return;
        const side = k % 2 ? 1 : -1;
        const back = LEN * scale * (0.45 + (k >> 1) * 0.5 * slip * 0.4);
        const sx = c.x - Math.cos(travel) * back - Math.sin(c.angle) * side * WID * 0.38 * scale;
        const sz = c.y - Math.sin(travel) * back + Math.cos(c.angle) * side * WID * 0.38 * scale;
        s.position.set(sx, 3 * scale + (k >> 1) * 2, sz);
        const size = (8 + slip * 4 + (k >> 1) * 6) * scale;
        s.scale.set(size, size, 1);
        (s.material as THREE.SpriteMaterial).opacity = Math.min(0.55, slip * 0.18);
      });

      // Sparks off the wall, flickering with the race clock so a replay throws the same ones.
      rig.sparks.visible = c.touchingWall && !c.done && Math.floor(snap.raceMs / 50) % 3 !== 0;
      if (rig.sparks.visible) {
        rig.sparks.position.set(c.x - Math.cos(c.angle) * LEN * 0.4 * scale, 3 * scale, c.y - Math.sin(c.angle) * LEN * 0.4 * scale);
        const s = (7 + (Math.floor(snap.raceMs / 50) % 4)) * scale;
        rig.sparks.scale.set(s, s, 1);
      }
    }

    this.aim(snap, spec, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position of a point a little above a car, in CSS pixels; null when behind the camera or off screen. */
  project(snap: RacingSnapshot, car: number, cssW: number, cssH: number): { x: number; y: number } | null {
    const c = snap.cars[car];
    if (!c) return null;
    const scale = this.cars[car]?.group.scale.x ?? 1;
    const v = new THREE.Vector3(c.x, (BODY_H + 9) * scale, c.y).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const x = (v.x * 0.5 + 0.5) * cssW;
    const y = (-v.y * 0.5 + 0.5) * cssH;
    if (x < -40 || y < -40 || x > cssW + 40 || y > cssH + 40) return null;
    return { x, y };
  }

  private aim(snap: RacingSnapshot, spec: CameraSpec, dt: number): void {
    const track = this.track!;
    const prev = this.lastSpec;
    const cut = !prev || spec.cut || prev.shot !== spec.shot || prev.car !== spec.car;
    this.lastSpec = { ...spec, cut: false };
    const car = snap.cars[spec.car] ?? snap.cars[0];
    const rival = spec.rival !== undefined && spec.rival !== null ? snap.cars[spec.rival] : undefined;

    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 48;

    if (spec.shot === 'overview' || !car) {
      const b = track.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minY + b.maxY) / 2;
      // Fill the screen with the circuit: as close as the width and the
      // (tilted, so foreshortened) depth both allow, with a small margin.
      const tilt = THREE.MathUtils.degToRad(58);
      const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const tanH = tanV * this.camera.aspect;
      const width = b.maxX - b.minX;
      const depth = (b.maxY - b.minY) * Math.sin(tilt);
      let dist = Math.max(width / 2 / tanH, depth / 2 / tanV);
      look.set(cx, 0, cz);
      // Under perspective the near side looks bigger than the far one, so
      // measure the circuit's corners on screen and move the camera until the
      // furthest one sits just inside the edge.
      const probe = this.camera.clone();
      probe.fov = fov;
      probe.updateProjectionMatrix();
      const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
      for (let k = 0; k < 4; k++) {
        probe.position.set(cx, Math.sin(tilt) * dist, cz + Math.cos(tilt) * dist);
        probe.lookAt(look);
        probe.updateMatrixWorld();
        let edge = 0;
        for (const [x, z] of corners) {
          const v = new THREE.Vector3(x, 0, z).project(probe);
          edge = Math.max(edge, Math.abs(v.x), Math.abs(v.y));
        }
        dist *= edge / 0.96;
      }
      pos.set(cx, Math.sin(tilt) * dist, cz + Math.cos(tilt) * dist);
      this.place(pos, look, new THREE.Vector3(), fov, cut, dt, 3);
      return;
    }

    // The heading the camera hangs off is smoothed (0.35 s; the helicopter is
    // lazier), so a twitch of the steering does not whip the picture round.
    const tau = spec.shot === 'heli' ? 0.9 : 0.35;
    if (cut) this.heading = car.angle;
    else this.heading += wrapAngle(car.angle - this.heading) * (1 - Math.exp(-dt / tau));
    const hx = Math.cos(this.heading);
    const hz = Math.sin(this.heading);
    // The car itself: the snapshot is the frame being drawn, so there is no lag to lead.
    const at = new THREE.Vector3(car.x, 0, car.y);
    const side = spec.side ?? 1;
    /** A point relative to the car: `back` behind it, `across` to its side, `up` above. */
    const off = (back: number, across: number, up: number) =>
      new THREE.Vector3(at.x - hx * back - hz * across, up, at.z - hz * back + hx * across);

    const rivalAt = rival ? new THREE.Vector3(rival.x, 0, rival.y) : null;
    const gap = rivalAt ? rivalAt.distanceTo(at) : 0;
    // A two-shot from behind only works while the pair is close; further apart, from above.
    const shot = spec.shot === 'chase' && gap > 200 ? 'heli' : spec.shot;

    if (shot === 'chase') {
      if (rivalAt) {
        // Two-shot from behind the chaser: back and up with the gap, looking most of the way to the car ahead.
        pos.copy(off(40 + 0.35 * gap, 0, 14 + 0.12 * gap));
        look.copy(at).lerp(rivalAt, 0.6).setY(3);
        fov = fitBoth(pos, look, at, rivalAt, 42, 60);
      } else {
        // The car about a quarter of the frame wide on any screen shape, on the lower third.
        const halfH = Math.tan(THREE.MathUtils.degToRad(42 / 2)) * Math.max(0.6, this.camera.aspect);
        const back = THREE.MathUtils.clamp(WID / (0.24 * 2 * halfH), 32, 70);
        pos.copy(off(back, 0, back * 0.33));
        look.copy(off(-back * 0.6, 0, 3));
        fov = 42;
      }
    } else if (shot === 'low') {
      // Cam-cat: alongside, low, on the story's side of the road, the car a little behind centre.
      pos.copy(off(-4, 30 * side, 11));
      look.copy(off(-3, 0, 3));
      fov = 40;
    } else if (shot === 'heli') {
      if (rivalAt) {
        pos.copy(off(90 + 0.5 * gap, 0, 150 + 0.4 * gap));
        look.copy(at).lerp(rivalAt, 0.5);
        fov = fitBoth(pos, look, at, rivalAt, 38, 60);
      } else {
        pos.copy(off(90, 0, 150));
        look.copy(off(-8, 0, 0));
        fov = 38;
      }
    } else {
      // Trackside and the finish line: one fixed camera for the whole take,
      // with a long lens that keeps the car about the same size as it nears.
      if (cut || !this.anchor) {
        this.anchor = spec.shot === 'finish' ? finishCamera(track, side) : trackside(track, car.x, car.y, car.speed, side, spec.lead ?? 2.4);
      }
      pos.copy(this.anchor);
      const vx = Math.cos(car.angle) * car.speed * 60 * 0.15;
      const vz = Math.sin(car.angle) * car.speed * 60 * 0.15;
      look.set(car.x + vx, 3, car.y + vz);
      const d = pos.distanceTo(look);
      fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(30 / Math.max(1, d))), 10, 50);
      // The camera itself does not move; only the lens follows, briskly.
      this.place(pos, look, at, fov, cut, dt, 14);
      return;
    }
    this.place(pos, look, at, fov, cut, dt, 10);
  }

  /**
   * Put the camera at `pos` (no lag: it is worked out from the car, or fixed),
   * and aim it at `look`. The aim is smoothed on a critically damped spring of
   * stiffness `omega` - but as an offset from `anchor`, the car, so the spring
   * only softens changes in framing and never trails a car doing 400 units a
   * second (it did, by 50 units, and the camera ended up looking at the wall).
   */
  private place(
    pos: THREE.Vector3,
    look: THREE.Vector3,
    anchor: THREE.Vector3,
    fov: number,
    cut: boolean,
    dt: number,
    omega: number,
  ): void {
    const want = look.clone().sub(anchor);
    if (cut) {
      this.lookOff.copy(want);
      this.lookVel.set(0, 0, 0);
      this.fov = fov;
    } else {
      const h = Math.min(dt, 0.05);
      // x'' = -2 w x' - w^2 (x - target)
      const acc = this.lookOff.clone().sub(want).multiplyScalar(-omega * omega).addScaledVector(this.lookVel, -2 * omega);
      this.lookVel.addScaledVector(acc, h);
      this.lookOff.addScaledVector(this.lookVel, h);
      this.fov += (fov - this.fov) * (1 - Math.exp(-h * 6));
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(anchor.clone().add(this.lookOff));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    if (this.trackGroup) disposeTree(this.trackGroup);
    for (const rig of this.cars) disposeTree(rig.group);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}

// ------------------------------------------------------------- the circuit

/** A ribbon between two closed polylines (flat x,y pairs), lying at height `y`. */
function ribbon(a: Float32Array, b: Float32Array, y: number, uvScale = 0): THREE.BufferGeometry {
  const n = a.length / 2;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    pos.set([a[i * 2], y, a[i * 2 + 1], b[i * 2], y, b[i * 2 + 1]], i * 6);
    if (uvScale) uv.set([a[i * 2] * uvScale, a[i * 2 + 1] * uvScale, b[i * 2] * uvScale, b[i * 2 + 1] * uvScale], i * 4);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uvScale) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A wall offset `by` units away from the centreline, past the wall itself. */
function beyond(track: Track, wall: Float32Array, by: number): Float32Array {
  const out = new Float32Array(wall.length);
  for (let i = 0; i < wall.length; i += 2) {
    const dx = wall[i] - track.center[i];
    const dy = wall[i + 1] - track.center[i + 1];
    const d = Math.hypot(dx, dy) || 1;
    out[i] = wall[i] + (dx / d) * by;
    out[i + 1] = wall[i + 1] + (dy / d) * by;
  }
  return out;
}

/** Triangles with a colour per vertex, as one mesh. */
class Painter {
  pos: number[] = [];
  col: number[] = [];
  quad(p: number[][], color: THREE.Color): void {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(...p[k]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  mesh(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

function buildTrack(track: Track): THREE.Group {
  const group = new THREE.Group();
  const n = track.def.samples;
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const twoSided = (color: number) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.MeshLambertMaterial({ color: GRASS }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -1.5, cz);
  group.add(ground);

  for (const wall of [track.inner, track.outer]) {
    group.add(new THREE.Mesh(ribbon(wall, beyond(track, wall, 17), -0.6), twoSided(GRAVEL)));
  }

  const asphaltTex = noiseTexture();
  const road = new THREE.Mesh(
    ribbon(track.inner, track.outer, 0, 1 / 40),
    new THREE.MeshLambertMaterial({ color: ASPHALT, map: asphaltTex, side: THREE.DoubleSide }),
  );
  group.add(road);

  const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const red = new THREE.Color(0xc8243b);
  const white = new THREE.Color(0xe8ecf3);
  const dark = new THREE.Color(0x12151d);

  // Kerbs where the road turns, the same samples the 2D view paints.
  const kerbs = new Painter();
  for (const wall of [track.inner, track.outer]) {
    for (let i = 0; i < n; i++) {
      if (!hasKerb(track, i)) continue;
      const j = (i + 1) % n;
      const edge = (k: number) => {
        const wx = wall[k * 2];
        const wz = wall[k * 2 + 1];
        const dx = track.center[k * 2] - wx;
        const dz = track.center[k * 2 + 1] - wz;
        const d = Math.hypot(dx, dz) || 1;
        return [
          [wx, 0.5, wz],
          [wx + (dx / d) * 7, 0.5, wz + (dz / d) * 7],
        ];
      };
      const [a, ai] = edge(i);
      const [bb, bi] = edge(j);
      kerbs.quad([a, bb, bi, ai], i % 2 ? white : red);
    }
  }
  group.add(kerbs.mesh(flat));

  // The chequered band across the first gate.
  const line = new Painter();
  const [ax, az, bx, bz] = [track.checkpoints[0], track.checkpoints[1], track.checkpoints[2], track.checkpoints[3]];
  const glen = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / glen;
  const uz = (bz - az) / glen;
  const cols = 10;
  const cell = glen / cols;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      const x0 = ax + ux * c * cell - uz * (r * cell - cell);
      const z0 = az + uz * c * cell + ux * (r * cell - cell);
      line.quad(
        [
          [x0, 0.6, z0],
          [x0 + ux * cell, 0.6, z0 + uz * cell],
          [x0 + ux * cell - uz * cell, 0.6, z0 + uz * cell + ux * cell],
          [x0 - uz * cell, 0.6, z0 + ux * cell],
        ],
        (c + r) % 2 ? dark : white,
      );
    }
  }
  group.add(line.mesh(flat));

  // Barriers along both walls: white and red panels, like a street circuit's.
  const barrier = new Painter();
  const H = 6;
  for (const wall of [track.inner, track.outer]) {
    const out = beyond(track, wall, 1.5);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p = [out[i * 2], out[i * 2 + 1]];
      const q = [out[j * 2], out[j * 2 + 1]];
      barrier.quad([[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], H, q[1]], [p[0], H, p[1]]], Math.floor(i / 3) % 2 ? red : white);
    }
  }
  group.add(barrier.mesh(flat));

  // Outside: which wall is the outer one, so the stands are not in the infield.
  const mid = (wall: Float32Array) => Math.hypot(wall[0] - cx, wall[1] - cz);
  const outside = mid(track.outer) > mid(track.inner) ? track.outer : track.inner;
  addStands(group, track, outside);
  addTrees(group, track);
  return group;
}

/** Is a point clear of the road by at least `margin`? */
function clearOfRoad(track: Track, x: number, z: number, margin: number): boolean {
  const lim = (track.def.width / 2 + margin) ** 2;
  for (let i = 0; i < track.def.samples; i++) {
    if ((track.center[i * 2] - x) ** 2 + (track.center[i * 2 + 1] - z) ** 2 < lim) return false;
  }
  return true;
}

/** Grandstands along the outside of the start straight. */
function addStands(group: THREE.Group, track: Track, outside: Float32Array): void {
  const n = track.def.samples;
  const crowd = crowdTexture();
  const seat = new THREE.MeshLambertMaterial({ map: crowd });
  const roof = new THREE.MeshLambertMaterial({ color: 0xd9dee8 });
  for (let k = -30; k <= 12; k += 7) {
    const i = (k + n) % n;
    const ox = outside[i * 2];
    const oz = outside[i * 2 + 1];
    const dx = ox - track.center[i * 2];
    const dz = oz - track.center[i * 2 + 1];
    const d = Math.hypot(dx, dz) || 1;
    const x = ox + (dx / d) * 34;
    const z = oz + (dz / d) * 34;
    if (!clearOfRoad(track, x, z, 30)) continue;
    const seg = Math.hypot(track.center[((i + 7) % n) * 2] - track.center[i * 2], track.center[((i + 7) % n) * 2 + 1] - track.center[i * 2 + 1]);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.95, 16, 24), seat);
    stand.position.set(x, 8, z);
    stand.rotation.y = -Math.atan2(track.tangent[i * 2 + 1], track.tangent[i * 2]);
    group.add(stand);
    const top = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.95, 1.5, 28), roof);
    top.position.set(x + (dx / d) * 2, 18, z + (dz / d) * 2);
    top.rotation.y = stand.rotation.y;
    group.add(top);
  }
}

/** Trees in the grass, the same ones on every visit: seeded by the circuit's id. */
function addTrees(group: THREE.Group, track: Track): void {
  let seed = 7;
  for (const ch of track.def.id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const rng = mulberry32(seed >>> 0);
  const b = track.bounds;
  const spots: Array<[number, number, number]> = [];
  for (let tries = 0; tries < 900 && spots.length < 140; tries++) {
    const x = b.minX - 220 + rng() * (b.maxX - b.minX + 440);
    const z = b.minY - 220 + rng() * (b.maxY - b.minY + 440);
    if (!clearOfRoad(track, x, z, 50)) continue;
    spots.push([x, z, 0.8 + rng() * 0.7]);
  }
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(9, 26, 7), new THREE.MeshLambertMaterial({ color: 0x2f6b34 }), spots.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 2, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, s], i) => {
    m.makeScale(s, s, s).setPosition(x, 4 * s, z);
    trunk.setMatrixAt(i, m);
    m.makeScale(s, s, s).setPosition(x, 20 * s, z);
    crown.setMatrixAt(i, m);
  });
  group.add(trunk, crown);
}

/** The centreline sample nearest a point. */
function nearestSample(track: Track, x: number, z: number): number {
  let near = 0;
  let best = Infinity;
  for (let i = 0; i < track.def.samples; i++) {
    const d = (track.center[i * 2] - x) ** 2 + (track.center[i * 2 + 1] - z) ** 2;
    if (d < best) {
      best = d;
      near = i;
    }
  }
  return near;
}

/** A camera position `off` units to one side of centreline sample `i`, `up` high. */
function besideRoad(track: Track, i: number, side: number, up: number, margin = 30): THREE.Vector3 {
  const off = track.def.width / 2 + margin;
  return new THREE.Vector3(
    track.center[i * 2] - track.tangent[i * 2 + 1] * off * side,
    up,
    track.center[i * 2 + 1] + track.tangent[i * 2] * off * side,
  );
}

/**
 * A spot beside the road where the car will be in about 1.8 s, for a fixed
 * trackside camera that watches it come and go by. Always on the story's own
 * side of the road (the 180-degree rule), and never moved during the take.
 */
function trackside(track: Track, x: number, z: number, speed: number, side: number, leadS: number): THREE.Vector3 {
  const n = track.def.samples;
  const spacing = track.length / n;
  const ahead = Math.round(Math.max(40, speed * 60 * leadS) / spacing);
  // Set well back from the road, so the pan as the car goes by is not a whip.
  // High enough to see over the grandstands (their roofs are at 19).
  return besideRoad(track, (nearestSample(track, x, z) + ahead) % n, side, 32, 50);
}

/** The camera on the finish line, a few samples past it, looking back down the straight. */
function finishCamera(track: Track, side: number): THREE.Vector3 {
  return besideRoad(track, 4 % track.def.samples, side, 18);
}

/** The field of view that keeps two points in the middle 70% of the frame, between `min` and `max` degrees. */
function fitBoth(pos: THREE.Vector3, look: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, min: number, max: number): number {
  const dir = look.clone().sub(pos).normalize();
  let widest = 0;
  for (const p of [a, b]) {
    const to = p.clone().sub(pos).normalize();
    widest = Math.max(widest, Math.acos(THREE.MathUtils.clamp(dir.dot(to), -1, 1)));
  }
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg((2 * widest) / 0.7), min, max);
}

// ------------------------------------------------------------- the cars

function buildCar(paint: CarPaint, shadowTex: THREE.Texture): THREE.Group {
  const { color, look } = paint;
  const secondary = look?.secondary ?? darker(color);
  const wingColor = look?.wing ?? secondary;
  const group = new THREE.Group();

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN * 1.25, WID * 1.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.3;
  group.add(shadow);

  // The body: the same outline the 2D car has, extruded, with the 2D livery as its top.
  const side = BODY_SHAPES[look?.shape ?? 'classic'] ?? BODY_SHAPES.classic;
  const shape = new THREE.Shape();
  side.forEach(([x, y], i) => (i ? shape.lineTo(x * LEN, -y * WID) : shape.moveTo(x * LEN, -y * WID)));
  for (let i = side.length - 1; i >= 0; i--) shape.lineTo(side[i][0] * LEN, side[i][1] * WID);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: BODY_H, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.5, bevelSegments: 2 });
  // Shape space to world: x stays, the outline's y becomes z, the extrusion goes up.
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, BODY_H + WHEEL_R * 0.55, 0);

  const livery = liveryTexture(color, look);
  const bodyTop = new THREE.MeshLambertMaterial({ map: livery });
  const bodySide = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.85) });
  group.add(new THREE.Mesh(bodyGeo, [bodyTop, bodySide]));

  // Wheels, at the corners the 2D car draws its tyres. A rim only for a team that bought one.
  const tyre = new THREE.MeshLambertMaterial({ color: 0x15171d });
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WID * 0.24, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const rimMat = look?.rim ? new THREE.MeshLambertMaterial({ color: look.rim }) : null;
  const rimGeo = rimMat ? new THREE.CylinderGeometry(WHEEL_R * 0.58, WHEEL_R * 0.58, WID * 0.25, 12).rotateX(Math.PI / 2) : null;
  for (const x of [LEN * 0.28, -LEN * 0.3]) {
    for (const z of [-WID * 0.39, WID * 0.39]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(x, WHEEL_R, z);
      group.add(w);
      if (rimGeo && rimMat) {
        const r = new THREE.Mesh(rimGeo, rimMat);
        r.position.set(x, WHEEL_R, z);
        group.add(r);
      }
    }
  }

  const wingMat = new THREE.MeshLambertMaterial({ color: wingColor });
  const front = new THREE.Mesh(new THREE.BoxGeometry(LEN * 0.1, 0.7, WID * 0.94), wingMat);
  front.position.set(LEN * 0.45, WHEEL_R * 0.6, 0);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(LEN * 0.12, 0.8, WID * 0.82), wingMat);
  rear.position.set(-LEN * 0.45, BODY_H + WHEEL_R * 1.6, 0);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(LEN * 0.06, WHEEL_R * 1.4, WID * 0.08), wingMat);
  pylon.position.set(-LEN * 0.43, BODY_H + WHEEL_R * 0.9, 0);
  group.add(front, rear, pylon);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(WID * 0.13, 14, 10),
    new THREE.MeshLambertMaterial({ color: look?.helmet ?? '#f4f6fb' }),
  );
  helmet.position.set(-LEN * 0.08, BODY_H * 2 + WHEEL_R * 0.4, 0);
  group.add(helmet);
  return group;
}

/** The livery canvas covers this much of the car's length, centred. */
const LIVERY_SPAN = LEN * 1.1;

function liveryTexture(color: string, look: CarLook | undefined): THREE.CanvasTexture {
  const W = 256;
  const H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const px = W / LIVERY_SPAN;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  drawCarLivery(ctx, LEN * px, WID * px, color, look);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Extrude caps take their UVs from the outline in world units: map those
  // onto the canvas, its y running the same way as the outline's.
  tex.flipY = false;
  tex.repeat.set(1 / LIVERY_SPAN, 1 / ((LIVERY_SPAN * H) / W));
  tex.offset.set(0.5, 0.5);
  tex.anisotropy = 4;
  return tex;
}

/** A car out of the race, see-through like the 2D view's; or back to solid after a rewind. */
function setGhost(rig: CarRig, ghost: boolean): void {
  rig.ghost = ghost;
  rig.group.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      // The shadow blob is see-through already; it only fades.
      const base = (m.userData.baseOpacity ??= m.opacity) as number;
      const blob = m.userData.blob ?? (m.userData.blob = m.transparent);
      m.opacity = ghost ? base * GHOST_OPACITY : base;
      if (!blob) {
        m.transparent = ghost;
        m.depthWrite = !ghost;
      }
      m.needsUpdate = true;
    }
  });
}

function smokeColor(look: CarLook | undefined): THREE.Color {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(look?.smoke ?? '');
  return m ? new THREE.Color(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255) : new THREE.Color(0xe6e9f0);
}

// ------------------------------------------------------------- textures

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function noiseTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 128);
  const rng = mulberry32(42);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.floor(rng() * 55);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Rows of spectators: dots of colour on a dark stand. */
function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a2f3b';
  ctx.fillRect(0, 0, 128, 64);
  const rng = mulberry32(9);
  const shirts = ['#ff2e4d', '#f4f6fb', '#38bdf8', '#ffb020', '#14b8a6', '#ff5fa2', '#2346c8'];
  for (let y = 3; y < 64; y += 6) {
    for (let x = 2; x < 128; x += 4) {
      if (rng() < 0.2) continue;
      ctx.fillStyle = shirts[Math.floor(rng() * shirts.length)];
      ctx.fillRect(x, y + (rng() < 0.5 ? 0 : 1), 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (m as THREE.MeshLambertMaterial).map?.dispose();
      m.dispose();
    }
  });
}

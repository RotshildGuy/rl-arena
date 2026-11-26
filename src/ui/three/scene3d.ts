import * as THREE from 'three';
import { getTrack, type Track } from '../../core/games/racing/tracks';
import type { RacingSnapshot } from '../../core/games/racing/env';
import { settle } from '../../core/games/racing/settle';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FINISH_FX_MS, RAINBOW, drawFinishFx, hasKerb, type CarLook } from '../../core/games/racing/render';
import { buildCar, LEN, WID, type Car3D, type CarPaint } from './car3d';
import { mulberry32 } from '../../core/rng';
import { TrailHistory, trailStrip } from '../../core/games/racing/trail';
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

// The car's size on every shot lives in `car3d.ts` (`LEN` x `WID`, matched to the physics).
/** How see-through a car that is out of the race is, as on the 2D view. */
const GHOST_OPACITY = 0.3;
const BODY_H = WID * 0.28;
const WHEEL_R = WID * 0.17;

const SKY = 0x9cc7f0;
const ASPHALT = 0x3b404c;
const GRAVEL = 0xcdbb8f;

export type { CarPaint };

interface CarRig {
  group: THREE.Group;
  car: Car3D;
  /** For the wheels: the heading and race step last frame, and how far each wheel has turned. */
  lastStep: number;
  /** Distance covered, which is what turns the wheels. */
  roll: number;
  smoke: THREE.Sprite[];
  sparks: THREE.Sprite;
  key: string;
  ghost: boolean;
  /** Pack prizes on the car, when it has them. The trail lives in world space, not on the car. */
  trail: THREE.Mesh | null;
  flame: THREE.Group | null;
}

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 4, 6000);
  private trackId = '';
  private trackGroup: THREE.Group | null = null;
  private readonly sky: THREE.Mesh;
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
  /** The winner's finish-line prize: the 2D drawing, redrawn on a sprite while it plays. */
  private readonly fxCanvas = document.createElement('canvas');
  private readonly fxTex: THREE.CanvasTexture;
  private readonly fx: THREE.Sprite;
  /** Where each car is drawn this frame (`settle`), reused between frames. */
  private settled: Float32Array = new Float32Array(0);
  /** Where every car has just been, for trails. */
  private readonly trails = new TrailHistory();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(SKY);
    // A sky that is paler at the horizon than overhead, instead of one flat colour. It follows the camera.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.disposables.push(this.sky.geometry, this.sky.material as THREE.Material, (this.sky.material as THREE.MeshBasicMaterial).map!);
    this.scene.fog = new THREE.Fog(SKY, 1100, 3200);

    // Reflections for the paint and the carbon. Only the car materials read it;
    // the scenery is matte (Lambert) and looks the same as before.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.6;
    this.disposables.push(env);
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a5a30, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(400, 700, 250);
    this.scene.add(sun);

    this.smokeTex = radialTexture('rgba(235,238,245,0.9)', 'rgba(235,238,245,0)');
    this.sparkTex = radialTexture('rgba(255,220,120,1)', 'rgba(255,120,40,0)');
    this.shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
    this.fxCanvas.width = this.fxCanvas.height = 256;
    this.fxTex = new THREE.CanvasTexture(this.fxCanvas);
    this.fxTex.colorSpace = THREE.SRGBColorSpace;
    this.fx = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fxTex, transparent: true, depthWrite: false, depthTest: false }));
    this.fx.visible = false;
    this.scene.add(this.fx);
    this.disposables.push(this.smokeTex, this.sparkTex, this.shadowTex, this.fxTex, this.fx.material);
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
    rig.car.dispose();
    if (rig.trail) {
      this.scene.remove(rig.trail);
      disposeTree(rig.trail);
    }
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
      const car = buildCar(p);
      const group = car.group;
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(LEN * 1.25, WID * 1.6),
        new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.3;
      group.add(shadow);
      this.scene.add(group);
      const trail = p.look?.trail ? trailMesh(p.look.trail) : null;
      if (trail) this.scene.add(trail);
      const flame = p.look?.flame ? flameMesh(p.look.flame) : null;
      if (flame) group.add(flame);
      const smoke = [0, 1, 2, 3].map(() => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: smokeColor(p.look), transparent: true, depthWrite: false }));
        s.visible = false;
        this.scene.add(s);
        return s;
      });
      const sparks = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sparks.visible = false;
      this.scene.add(sparks);
      this.cars[i] = { group, car, lastStep: -1, roll: 0, smoke, sparks, key, ghost: false, trail, flame };
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
    this.trails.update(snap, LEN * 0.45);
    const at = this.track ? (this.settled = settle(snap, this.track, this.settled)) : null;

    for (let i = 0; i < this.cars.length; i++) {
      const rig = this.cars[i];
      const c = snap.cars[i];
      if (!c) {
        rig.group.visible = false;
        continue;
      }
      rig.group.visible = true;
      rig.group.position.set(at ? at[i * 2] : c.x, 0, at ? at[i * 2 + 1] : c.y);
      // Eased: a model flicks between full lock and straight every few steps (`trail.ts`).
      rig.group.rotation.y = -this.trails.heading(i, c);
      rig.group.scale.setScalar(scale);
      if (rig.ghost !== c.done) setGhost(rig, c.done);
      turnWheels(rig, c, snap.step, this.trails.steer(i));

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

      // Pack prizes: the trail grows with the speed, the flame flickers on the throttle.
      if (rig.trail) fillTrail(rig.trail, c.done ? [] : trailStrip(this.trails.of(i), snap.raceMs, WID * 0.24));
      if (rig.flame) {
        // Grows and fades with the eased throttle instead of strobing on and off.
        const gas = this.trails.gas(i, c);
        rig.flame.visible = !c.done && gas > 0.05;
        const flick = 0.85 + 0.3 * (((Math.floor(snap.raceMs / 60) * 2654435761 + i * 97) >>> 0) % 1000) / 1000;
        rig.flame.scale.set(flick * gas, 0.6 + 0.4 * gas, 0.6 + 0.4 * gas);
      }

      // Sparks off the wall, flickering with the race clock so a replay throws the same ones.
      rig.sparks.visible = c.touchingWall && !c.done && Math.floor(snap.raceMs / 50) % 3 !== 0;
      if (rig.sparks.visible) {
        rig.sparks.position.set(c.x - Math.cos(c.angle) * LEN * 0.4 * scale, 3 * scale, c.y - Math.sin(c.angle) * LEN * 0.4 * scale);
        const s = (7 + (Math.floor(snap.raceMs / 50) % 4)) * scale;
        rig.sparks.scale.set(s, s, 1);
      }
    }

    this.finishFx(snap, paints);
    this.aim(snap, spec, dt);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** The winner's finish-line prize, over the car, for its run after the flag. */
  private finishFx(snap: RacingSnapshot, paints: CarPaint[]): void {
    const win = snap.order[0];
    const c = snap.cars[win];
    const look = paints[win]?.look;
    const t = c && c.finished && c.totalMs !== null ? (snap.raceMs - c.totalMs) / FINISH_FX_MS : -1;
    this.fx.visible = !!look?.finish && t >= 0 && t < 1;
    if (!this.fx.visible || !look?.finish) return;
    const ctx = this.fxCanvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 256, 256);
    ctx.translate(128, 128);
    drawFinishFx(ctx, look.finish, t, 26, paints[win].color, look.secondary);
    this.fxTex.needsUpdate = true;
    this.fx.position.set(c.x, 6, c.y);
    const size = LEN * 9;
    this.fx.scale.set(size, size, 1);
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

  // Mown grass: light and dark stripes, as a circuit's verges are cut.
  const grassTex = grassTexture();
  grassTex.repeat.set((span * 8) / 160, (span * 8) / 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.MeshLambertMaterial({ map: grassTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -1.5, cz);
  group.add(ground);

  for (const wall of [track.inner, track.outer]) {
    const gravel = gravelTexture();
    group.add(new THREE.Mesh(ribbon(wall, beyond(track, wall, 17), -0.6, 1 / 30), new THREE.MeshLambertMaterial({ color: GRAVEL, map: gravel, side: THREE.DoubleSide })));
  }

  const asphaltTex = asphaltTexture();
  const road = new THREE.Mesh(
    ribbon(track.inner, track.outer, 0, 1 / 60),
    new THREE.MeshLambertMaterial({ color: ASPHALT, map: asphaltTex, side: THREE.DoubleSide }),
  );
  group.add(road);

  // Rubber laid down where the cars run: a darker band down the middle of the road.
  const rubber = new THREE.Mesh(
    ribbon(beyond(track, track.inner, -track.def.width * 0.22), beyond(track, track.outer, -track.def.width * 0.22), 0.15),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  group.add(rubber);

  // The white track-limit line just inside each edge.
  const lineMat = new THREE.MeshLambertMaterial({ color: 0xe9edf3, side: THREE.DoubleSide });
  for (const wall of [track.inner, track.outer]) {
    group.add(new THREE.Mesh(ribbon(beyond(track, wall, -1.2), beyond(track, wall, -2.6), 0.3), lineMat));
  }

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

/**
 * Grandstands along the outside of the start straight: rows of seats stepping
 * up away from the track, full of people, under a roof held up on posts at the
 * back, with advertising boards along the front and concrete at the ends.
 */
function addStands(group: THREE.Group, track: Track, outside: Float32Array): void {
  const n = track.def.samples;
  const { seatMat, concrete, roofMat, steel, boardMat } = standMaterials();
  const up = new THREE.Vector3(0, 1, 0);
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
    const stand = buildStand(seg * 0.95, { seatMat, concrete, roofMat, steel, boardMat });
    // Local +z runs away from the track, so the seats face it.
    const away = new THREE.Vector3(dx / d, 0, dz / d);
    const along = new THREE.Vector3().crossVectors(up, away);
    stand.matrix.makeBasis(along, up, away).setPosition(ox + (dx / d) * 20, 0, oz + (dz / d) * 20);
    stand.matrixAutoUpdate = false;
    group.add(stand);
  }
}

function standMaterials() {
  return {
    seatMat: new THREE.MeshLambertMaterial({ map: crowdTexture() }),
    concrete: new THREE.MeshLambertMaterial({ color: 0xb9bec8 }),
    roofMat: new THREE.MeshLambertMaterial({ color: 0xeef1f6, side: THREE.DoubleSide }),
    steel: new THREE.MeshLambertMaterial({ color: 0x59606e }),
    boardMat: new THREE.MeshLambertMaterial({ map: boardsTexture() }),
  };
}

/** One grandstand on its own, for the dev car lab. */
export function standPreview(len: number): THREE.Group {
  return buildStand(len, standMaterials());
}

/** Rows of seats this deep and this high, front to back. */
const STAND_ROWS = 8;
const ROW_DEPTH = 3;
const ROW_RISE = 2;

/** One grandstand, `len` long, its front edge on local z = 0 and its seats rising towards +z. */
function buildStand(
  len: number,
  m: { seatMat: THREE.Material; concrete: THREE.Material; roofMat: THREE.Material; steel: THREE.Material; boardMat: THREE.Material },
): THREE.Group {
  const g = new THREE.Group();
  const front = 3;
  const depth = front + STAND_ROWS * ROW_DEPTH;
  const top = 2 + STAND_ROWS * ROW_RISE;

  // The seats: one step per row, the crowd on the riser and the tread. The texture repeats along the row.
  const rows: THREE.BufferGeometry[] = [];
  for (let r = 0; r < STAND_ROWS; r++) {
    const y = 2 + r * ROW_RISE;
    const row = new THREE.BoxGeometry(len, ROW_RISE, ROW_DEPTH);
    row.translate(0, y + ROW_RISE / 2, front + r * ROW_DEPTH + ROW_DEPTH / 2);
    const uv = row.attributes.uv;
    // About half a metre a person, at the car's scale (a car is about 21 units for 5.6 m).
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / 60));
    rows.push(row);
  }
  g.add(new THREE.Mesh(mergeGeometries(rows)!, m.seatMat));

  // Concrete: the base under the rows, the wall at the back, the stepped ends.
  const solid: THREE.BufferGeometry[] = [];
  solid.push(new THREE.BoxGeometry(len, 2, depth).translate(0, 1, depth / 2));
  solid.push(new THREE.BoxGeometry(len, top + 1, 1).translate(0, (top + 1) / 2, depth + 0.5));
  const side = new THREE.Shape();
  side.moveTo(0, 0);
  side.lineTo(0, 2.6);
  for (let r = 0; r < STAND_ROWS; r++) {
    side.lineTo(front + r * ROW_DEPTH, 2.6 + r * ROW_RISE);
    side.lineTo(front + r * ROW_DEPTH, 2.6 + (r + 1) * ROW_RISE);
  }
  side.lineTo(depth + 1, top + 1);
  side.lineTo(depth + 1, 0);
  side.closePath();
  for (const sx of [-1, 1]) {
    const end = new THREE.ExtrudeGeometry(side, { depth: 0.8, bevelEnabled: false });
    // Shape (u, v) -> (x = thickness, y = v, z = u).
    end.rotateY(-Math.PI / 2);
    end.translate(sx * (len / 2) + (sx > 0 ? 0.8 : 0), 0, 0);
    solid.push(end);
  }
  g.add(new THREE.Mesh(mergeGeometries(solid.map((x) => x.toNonIndexed()))!, m.concrete));

  // Advertising boards along the front, coloured panels with no names on them.
  const board = new THREE.BoxGeometry(len, 2.4, 0.4).translate(0, 1.2, -0.6);
  const buv = board.attributes.uv;
  for (let k = 0; k < buv.count; k++) buv.setX(k, buv.getX(k) * (len / 40));
  g.add(new THREE.Mesh(board, m.boardMat));

  // The roof, cantilevered out over the seats from posts at the back, tilted up at the front.
  const roof = new THREE.BoxGeometry(len + 2, 0.6, depth + 2);
  roof.rotateX(-0.08);
  roof.translate(0, top + 7, depth / 2 + 0.5);
  g.add(new THREE.Mesh(roof, m.roofMat));
  const posts: THREE.BufferGeometry[] = [];
  const count = Math.max(2, Math.round(len / 18));
  for (let p = 0; p <= count; p++) {
    const px = -len / 2 + (len * p) / count;
    posts.push(new THREE.CylinderGeometry(0.5, 0.5, top + 7, 6).translate(px, (top + 7) / 2, depth + 1.2));
    // A brace from the post up to the roof's leading edge.
    const brace = new THREE.CylinderGeometry(0.3, 0.3, depth * 0.75, 5);
    brace.rotateX(Math.PI / 2 - 0.3);
    brace.translate(px, top + 4.5, depth * 0.62);
    posts.push(brace);
  }
  g.add(new THREE.Mesh(mergeGeometries(posts)!, m.steel));
  return g;
}

/** Trees in the grass, the same ones on every visit: seeded by the circuit's id. */
function addTrees(group: THREE.Group, track: Track): void {
  let seed = 7;
  for (const ch of track.def.id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const rng = mulberry32(seed >>> 0);
  const b = track.bounds;
  const spots: Array<[number, number, number, number]> = [];
  for (let tries = 0; tries < 1400 && spots.length < 220; tries++) {
    const x = b.minX - 260 + rng() * (b.maxX - b.minX + 520);
    const z = b.minY - 260 + rng() * (b.maxY - b.minY + 520);
    if (!clearOfRoad(track, x, z, 50)) continue;
    spots.push([x, z, 0.7 + rng() * 0.8, rng()]);
  }
  // Two kinds, pines and broadleaf, each in a spread of greens so a wood is not one flat colour.
  const pines = spots.filter((p) => p[3] < 0.55);
  const broad = spots.filter((p) => p[3] >= 0.55);
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(9, 14, 9).translate(0, 7, 0),
    new THREE.ConeGeometry(7.5, 12, 9).translate(0, 13, 0),
    new THREE.ConeGeometry(5.5, 10, 9).translate(0, 19, 0),
  ])!;
  pineGeo.translate(0, 8, 0);
  const broadGeo = new THREE.IcosahedronGeometry(11, 1);
  broadGeo.scale(1, 0.85, 1);
  broadGeo.translate(0, 18, 0);
  const leaf = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const pine = new THREE.InstancedMesh(pineGeo, leaf, pines.length);
  const round = new THREE.InstancedMesh(broadGeo, leaf.clone(), broad.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 2, 10, 6).translate(0, 5, 0), new THREE.MeshLambertMaterial({ color: 0x5b4030 }), spots.length);
  // A soft shadow under each tree, as the cars have.
  const shade = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.35)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const greens = [0x2f6b34, 0x3a7d3c, 0x2a5e30, 0x47843a, 0x356f2e, 0x4d8f46];
  const place = (mesh: THREE.InstancedMesh, list: typeof spots) =>
    list.forEach(([x, z, sc, r], k) => {
      q.setFromAxisAngle(up, r * 40);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc * (0.9 + ((r * 7) % 0.3)), sc));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, color.setHex(greens[Math.floor(r * 997) % greens.length]).multiplyScalar(0.9 + ((r * 13) % 0.2)));
    });
  place(pine, pines);
  place(round, broad);
  spots.forEach(([x, z, sc], k) => {
    m.makeScale(sc, sc, sc).setPosition(x, 0, z);
    trunk.setMatrixAt(k, m);
    m.makeScale(sc, 1, sc).setPosition(x, -1.3, z);
    shade.setMatrixAt(k, m);
  });
  group.add(shade, trunk, pine, round);
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

/**
 * Spin the wheels by the distance the car covered, and point the front pair by
 * the eased steering (`TrailHistory.steer`), so they turn into a corner rather
 * than flicking from lock to lock.
 */
function turnWheels(rig: CarRig, c: RacingSnapshot['cars'][number], step: number, steer: number): void {
  const steps = step - rig.lastStep;
  if (steps > 0 && steps < 30) rig.roll += c.speed * steps;
  rig.lastStep = step;
  rig.car.wheels.forEach((w, k) => {
    w.rotation.y = k < 2 ? -steer * 0.4 : 0;
    for (const part of w.children) part.rotation.z = -rig.roll / (w.userData.r as number);
  });
}

/** Points a trail strip can hold: more than a trail's worth of frames at 60 a second. */
const TRAIL_POINTS = 96;

/**
 * A trail: a flat strip along the path the car drove, rebuilt every frame
 * from the history (`fillTrail`). The texture fades out along u (age) and
 * holds the colour, or the rainbow's bands, across v.
 */
function trailMesh(trail: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const fade = ctx.createLinearGradient(0, 0, 128, 0);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  if (trail === 'rainbow') {
    RAINBOW.forEach((col, k) => {
      ctx.fillStyle = col;
      ctx.fillRect(0, (k * 32) / RAINBOW.length, 128, 32 / RAINBOW.length + 1);
    });
  } else {
    ctx.fillStyle = trail.replace(/,\s*[\d.]+\)$/, ', 1)');
    ctx.fillRect(0, 0, 128, 32);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 2), 2));
  const index: number[] = [];
  for (let i = 0; i < TRAIL_POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** Lay a trail strip into its mesh, newest end first so the texture fades towards the old end. */
function fillTrail(mesh: THREE.Mesh, strip: ReturnType<typeof trailStrip>): void {
  const n = Math.min(TRAIL_POINTS, strip.length);
  mesh.visible = n >= 2;
  if (!mesh.visible) return;
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const y = WHEEL_R * 1.1;
  for (let k = 0; k < n; k++) {
    const p = strip[strip.length - 1 - k];
    pos.setXYZ(k * 2, p.lx, y, p.ly);
    pos.setXYZ(k * 2 + 1, p.rx, y, p.ry);
    uv.setXY(k * 2, p.age, 0);
    uv.setXY(k * 2 + 1, p.age, 1);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.setDrawRange(0, (n - 1) * 6);
}

/** The exhaust flame: two cones out of the back of the car, the core inside the outer. */
function flameMesh(flame: string): THREE.Group {
  const [core, outer] = flame.split('|');
  const group = new THREE.Group();
  for (const [color, r, l] of [
    [outer ?? '#ff7a1a', WID * 0.1, LEN * 0.32],
    [core ?? '#ffe08a', WID * 0.055, LEN * 0.2],
  ] as const) {
    const geo = new THREE.ConeGeometry(r, l, 10);
    // Point it backwards along -x, its base at the gearbox.
    geo.rotateZ(Math.PI / 2);
    geo.translate(-l / 2, 0, 0);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
  }
  // Out of the gearbox, under the rear wing.
  group.position.set(-LEN * 0.47, WID * 0.14, 0);
  group.visible = false;
  return group;
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

/** Tarmac: fine aggregate, a few lighter stones, and broad patches where it was laid in a different batch. */
function asphaltTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(42);
  ctx.fillStyle = '#d4d4d4';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 18; k++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 30 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rng() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 60 + (rng() < 0.03 ? 45 : 0);
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n));
  }
  ctx.putImageData(img, 0, 0);
  return repeating(c, 8);
}

/** Mown grass: two greens in wide stripes, with a little noise. */
function grassTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4c8a3f';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#56964a';
  ctx.fillRect(0, 0, S / 2, S);
  const img = ctx.getImageData(0, 0, S, S);
  const rng = mulberry32(5);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n));
  }
  ctx.putImageData(img, 0, 0);
  return repeating(c, 4);
}

/** Gravel: light and dark grains on white, tinted by the material. */
function gravelTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(11);
  for (let k = 0; k < 900; k++) {
    const v = 150 + Math.floor(rng() * 105);
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
  }
  return repeating(c, 4);
}

function repeating(c: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Deeper blue overhead, hazy near the horizon. */
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#4f8fd6');
  g.addColorStop(0.42, '#8fbfee');
  g.addColorStop(0.5, '#cfe3f5');
  g.addColorStop(1, '#cfe3f5');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Rows of spectators: dots of colour on a dark stand. */
/** People in a row of seats: a shirt, a head above it, some standing a little taller. */
function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a404c';
  ctx.fillRect(0, 0, 256, 64);
  // Seat backs.
  ctx.fillStyle = '#2b5fa8';
  for (let x = 1; x < 256; x += 8) ctx.fillRect(x, 40, 6, 10);
  const rng = mulberry32(9);
  const shirts = ['#ff2e4d', '#f4f6fb', '#38bdf8', '#ffb020', '#14b8a6', '#ff5fa2', '#2346c8', '#1f2937', '#84cc16'];
  const skin = ['#f1c7a5', '#d9a47c', '#a86e4a', '#7a4b2e', '#e8b896'];
  for (let x = 2; x < 252; x += 8) {
    if (rng() < 0.12) continue;
    const lift = rng() < 0.2 ? -6 : 0;
    ctx.fillStyle = shirts[Math.floor(rng() * shirts.length)];
    ctx.fillRect(x, 26 + lift, 6, 20);
    ctx.fillStyle = skin[Math.floor(rng() * skin.length)];
    ctx.beginPath();
    ctx.arc(x + 3, 21 + lift, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Trackside boards: plain coloured panels with a stripe, no names. */
function boardsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const panels = ['#e11d48', '#1d4ed8', '#f59e0b', '#0f172a', '#16a34a', '#f4f6fb'];
  for (let k = 0; k < 4; k++) {
    const col = panels[k % panels.length];
    ctx.fillStyle = col;
    ctx.fillRect(k * 64, 0, 64, 16);
    ctx.fillStyle = col === '#f4f6fb' || col === '#f59e0b' ? '#0f172a' : '#f4f6fb';
    ctx.fillRect(k * 64 + 10, 6, 44, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
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

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, LEN, WID, type CarPaint } from './car3d';
import { CAR_RADIUS } from '../../core/games/racing/env';
import { standPreview } from './scene3d';

/**
 * Dev only (`/carlab.html`): the 3D car on its own,
 * under the broadcast's sky. `?view=hero|side|top|rear|grid|broadcast|fit|all` picks a shot.
 */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7f0);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a5a30, 1.2));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(400, 700, 250);
scene.add(sun);

// Asphalt with a white line, so the car sits on something.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x3b404c, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const line = new THREE.Mesh(new THREE.PlaneGeometry(600, 1.2), new THREE.MeshBasicMaterial({ color: 0xe8eaee }));
line.rotation.x = -Math.PI / 2;
line.position.set(0, 0.02, -WID * 1.2);
scene.add(line);

function blob(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN * 1.25, WID * 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  return m;
}

const paints: CarPaint[] = [
  { color: '#e11d48', look: { secondary: '#f8fafc', pattern: 'stripe', number: 7, helmet: '#fde047', visor: 'flames', emblem: { shape: 'shield', symbol: 'bolt', fg: '#fde047', bg: '#111827' } } },
  { color: '#0ea5e9', look: { secondary: '#0f172a', pattern: 'twotone', number: 23, helmet: '#f8fafc', rim: '#fbbf24', shape: 'wedge' } },
  { color: '#16a34a', look: { secondary: '#facc15', pattern: 'chevron', number: 4, wing: '#facc15', shape: 'arrow', helmet: '#16a34a', visor: 'checker' } },
  { color: '#f97316', look: { secondary: '#1e293b', pattern: 'centerline', number: 11, shape: 'bulldog', rim: '#e5e7eb', helmet: '#1e293b', visor: 'star' } },
];

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'hero';

const cars = paints.map((p) => buildCar(p));
const spinning: THREE.Group[] = [];
const place = (g: THREE.Object3D, x: number, z: number, yaw = 0) => {
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  scene.add(g);
};

/** How far the car reaches from its centre, on the ground plane: must not pass `CAR_RADIUS`. */
function reach(g: THREE.Object3D): { r: number; at: string } {
  g.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let max = 0;
  let at = '';
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry.attributes.position || (m.material as THREE.Material).transparent) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const r = Math.hypot(v.x - g.position.x, v.z - g.position.z);
      if (r > max) {
        max = r;
        at = `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)} ${(m.material as THREE.Material).type}`;
      }
    }
  });
  return { r: max, at };
}
(window as unknown as { reach: unknown }).reach = (['classic', 'wedge', 'arrow', 'bulldog'] as const).map((shape) => {
  const c = buildCar({ color: '#888', look: { shape } });
  const r = reach(c.group);
  c.dispose();
  return { shape, reach: +r.r.toFixed(2), at: r.at, radius: CAR_RADIUS };
});

if (view === 'stand') {
  // A grandstand with a car going past, at the scale they share on track.
  const st = standPreview(120);
  st.position.set(0, 0, -WID * 2.2);
  st.rotation.y = Math.PI;
  scene.add(st);
  place(cars[0].group, 0, 0);
  cars[0].group.add(blob());
} else if (view === 'all') {
  // Every body shape against every pattern, with the pack prizes that sit on the car.
  const shapes = ['classic', 'wedge', 'arrow', 'bulldog'] as const;
  const patterns = ['solid', 'stripe', 'twotone', 'chevron', 'centerline', 'fade'] as const;
  const colors = ['#e11d48', '#0ea5e9', '#16a34a', '#f97316', '#a855f7', '#facc15', '#f8fafc', '#111827'];
  const decals = ['star', 'bolt', 'checker', 'flame', 'sun', 'crown'] as const;
  const visors = ['stripe', 'checker', 'star', 'flames', 'crown'] as const;
  shapes.forEach((shape, row) => {
    patterns.forEach((pattern, col) => {
      const k = row * patterns.length + col;
      const color = colors[k % colors.length];
      const c = buildCar({
        color,
        look: {
          shape,
          pattern,
          secondary: colors[(k + 3) % colors.length],
          number: (k * 7) % 99,
          helmet: colors[(k + 5) % colors.length],
          visor: visors[k % visors.length],
          decal: decals[k % decals.length],
          ...(k % 3 === 0 ? { rim: '#fbbf24' } : {}),
          ...(k % 4 === 1 ? { wing: '#22d3ee' } : {}),
          ...(k % 5 === 2 ? { emblem: { shape: 'shield', symbol: 'star', fg: '#fde047', bg: '#111827' } } : {}),
        },
      });
      place(c.group, (col - 2.5) * LEN * 1.25, (row - 1.5) * WID * 2.1, 0);
      c.group.add(blob());
    });
  });
} else if (view === 'fit') {
  // Top view: every car inside its physics circle, and pairs touching at awkward angles.
  const ring = (x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(CAR_RADIUS - 0.15, CAR_RADIUS, 64), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.05, z);
    scene.add(m);
  };
  const shapes = ['classic', 'wedge', 'arrow', 'bulldog'] as const;
  shapes.forEach((shape, i) => {
    const a = buildCar({ ...paints[i], look: { ...paints[i].look, shape } });
    const b = buildCar({ ...paints[(i + 1) % 4], look: { ...paints[(i + 1) % 4].look, shape } });
    const x = (i - 1.5) * CAR_RADIUS * 5;
    // Two cars exactly touching to the physics, corner to corner.
    const yawA = 0.6;
    const yawB = -2.2 + i * 0.4;
    place(a.group, x, -CAR_RADIUS, yawA);
    place(b.group, x, CAR_RADIUS, yawB);
    ring(x, -CAR_RADIUS);
    ring(x, CAR_RADIUS);
  });
} else if (view === 'grid') {
  cars.forEach((c, i) => {
    place(c.group, -i * LEN * 1.6, (i % 2 ? 1 : -1) * WID * 0.9);
    c.group.add(blob());
    spinning.push(...c.wheels);
  });
} else {
  place(cars[0].group, 0, 0);
  cars[0].group.add(blob());
  spinning.push(...cars[0].wheels);
}

const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 4000);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, WID * 0.25, 0);
const shots: Record<string, [number, number, number]> = {
  hero: [LEN * 0.95, WID * 0.55, LEN * 0.85],
  side: [0, WID * 0.3, LEN * 1.9],
  top: [0.01, LEN * 2.3, 0],
  rear: [-LEN * 1.1, WID * 0.8, -LEN * 0.6],
  grid: [LEN * 0.6, WID * 1.5, LEN * 2.1],
  broadcast: [LEN * 3.2, WID * 3.6, LEN * 2.6],
  fit: [0.01, CAR_RADIUS * 16, 0],
  all: [0.01, LEN * 5.6, LEN * 3.4],
  stand: [LEN * 2.5, LEN * 1.4, LEN * 3.4],
};
camera.position.set(...(shots[view] ?? shots.hero));
if (view === 'grid') controls.target.set(-LEN * 2.6, 0, 0);
if (view === 'fit' || view === 'all') controls.target.set(0, 0, 0);
if (view === 'stand') controls.target.set(0, 8, -WID * 4);
controls.update();

const bar = document.getElementById('bar')!;
for (const v of Object.keys(shots)) {
  const b = document.createElement('button');
  b.textContent = v;
  b.onclick = () => (location.search = `?view=${v}`);
  bar.append(b);
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const spin = params.get('spin') !== '0';
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000;
  last = now;
  if (spin) for (const w of spinning) w.children.forEach((m) => (m.rotation.z -= dt * 6));
  controls.update();
  renderer.render(scene, camera);
});

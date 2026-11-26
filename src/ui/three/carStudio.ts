import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, LEN, WID, type Car3D, type CarPaint } from './car3d';

/**
 * The car on a turntable, for the shop and the design screen: the same 3D car
 * the broadcast races, lit the same way, turning slowly until somebody takes
 * hold of it, then wherever they drag it. Loaded only by `CarViewer`, on
 * demand, so a screen that never shows it never downloads three.js.
 */
export interface CarStudio {
  setPaint(paint: CarPaint): void;
  /** Back to the three-quarter view and the slow turn. */
  reset(): void;
  dispose(): void;
}

/** Where the camera starts: a three-quarter view from the front, a little above. */
const HOME = new THREE.Vector3(LEN * 1.35, WID * 1.2, LEN * 1.35);
/** Seconds after letting go before the turntable starts again. */
const IDLE_S = 4;

export function createCarStudio(canvas: HTMLCanvasElement): CarStudio {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x3a3a48, 1.2));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(400, 700, 250);
  scene.add(sun);

  // A round plinth of asphalt for the car to stand on, fading out at its edge.
  const disposables: Array<{ dispose(): void }> = [env, pmrem];
  const floorTex = radial('rgba(52,56,68,1)', 'rgba(52,56,68,0)');
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(LEN * 1.3, 48),
    new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const shadeTex = radial('rgba(0,0,0,0.65)', 'rgba(0,0,0,0)');
  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN * 1.25, WID * 1.6),
    new THREE.MeshBasicMaterial({ map: shadeTex, transparent: true, depthWrite: false }),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = 0.05;
  scene.add(shade);
  disposables.push(floor.geometry, floor.material as THREE.Material, floorTex, shade.geometry, shade.material as THREE.Material, shadeTex);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 2000);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, WID * 0.22, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  // A scroll wheel over the car scrolls the page, as everywhere else on it.
  controls.enableZoom = false;
  // Never under the floor, never straight down.
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.6;
  controls.update();
  // On a phone a vertical swipe still scrolls the page; a sideways one turns the car.
  canvas.style.touchAction = 'pan-y';

  let idleAt = 0;
  const grab = () => {
    controls.autoRotate = false;
    idleAt = 0;
  };
  const release = () => {
    idleAt = performance.now() + IDLE_S * 1000;
  };
  controls.addEventListener('start', grab);
  controls.addEventListener('end', release);

  let car: Car3D | null = null;

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // A narrow box still shows the whole car: back off as it gets taller than wide.
    camera.position.setLength(HOME.length() * Math.max(1, 1.3 / camera.aspect));
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // Only draw while it can be seen.
  let visible = true;
  const seen = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  seen.observe(canvas);

  renderer.setAnimationLoop((now) => {
    if (!visible || document.hidden) return;
    if (idleAt && now > idleAt) {
      controls.autoRotate = true;
      idleAt = 0;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setPaint(paint) {
      if (car) {
        scene.remove(car.group);
        car.dispose();
      }
      car = buildCar(paint);
      scene.add(car.group);
    },
    reset() {
      camera.position.copy(HOME);
      resize();
      controls.autoRotate = true;
      idleAt = 0;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      seen.disconnect();
      controls.removeEventListener('start', grab);
      controls.removeEventListener('end', release);
      controls.dispose();
      car?.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // Give the context back now: the shop and the design screen each make one,
      // and a browser allows only a handful at a time.
      renderer.forceContextLoss();
    },
  };
}

function radial(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

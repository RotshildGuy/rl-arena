import type { RacingSnapshot } from '../core/games/racing/env';
import type { CarLook } from '../core/games/racing/render';

/**
 * The sound of a race: engines, tyres, hits and the team radio.
 *
 * The cars are made in the browser. Each car the camera is on gets an engine
 * - two oscillators through a filter - whose note follows its speed through
 * the gears, louder and brighter while it is pulling. A car that is braking
 * hard or sliding scrubs its tyres: a rough, low hiss of rubber on asphalt,
 * not a film squeal (a narrow high band, the first try, sounded like skating
 * on ice). A car that meets a wall or another car is heard hitting it. What
 * is heard is what is on screen: on a car shot the car in the middle of the
 * picture and whoever is near it, panned left and right by where they are in
 * the frame; on the whole-circuit shot a quiet hum of the leading cars.
 *
 * The team radio (`radio`) is heard from season 6 (`RADIO_VOICE_SEASON`):
 * Hebrew clips in `public/radio/gemini`, made by `scripts/radioGemini.py`
 * with Gemini TTS in several voices, played through the narrow band of a
 * two-way radio. Every driver keeps one voice and every pit wall another,
 * picked from the voices that have all their lines. Most desktop browsers
 * have no Hebrew speech voice of their own, so where a line has no clip
 * (English, or a wording added since) the browser's voice reads it, and on
 * most desktops that means it stays silent.
 *
 * Off until switched on: a browser only lets a page make a sound after a tap,
 * and a broadcast that starts shouting on its own is not one anybody keeps.
 */

/** Cars heard at once. More only muddies it, and costs a phone. */
const VOICES = 4;
/**
 * The first season whose broadcasts speak the team radio aloud. Season 5
 * ships without it, so no half-recorded voice is ever heard (decided 24.11).
 */
export const RADIO_VOICE_SEASON = 6;
/** Top speed of the fastest car, for the gears. A slower car just never reaches top gear. */
const SPEED_SCALE = 7.8;
const GEARS = 6;
/** Distance at which a car is heard at half its volume, in track units. */
const HEAR_HALF = 140;
/** Speed lost per step past which the tyres are working hard under braking. */
const BRAKE_DECEL = 0.12;

interface Voice {
  car: number;
  saw: OscillatorNode;
  sub: OscillatorNode;
  /** A turbo's whistle, silent on every other engine. */
  whistle: OscillatorNode;
  whistleGain: GainNode;
  subGain: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** The engine it is set up as, so the waves are only changed when the car changes. */
  engine: string;
}

export type EngineKind = NonNullable<CarLook['engine']> | 'stock';

/**
 * How each engine sounds (a pack prize, `shop.ts`): the waves, how the note
 * sits against the stock one, the sub-octave, and how bright it gets.
 */
const ENGINES: Record<EngineKind, { wave: OscillatorType; sub: OscillatorType; pitch: number; subLevel: number; bright: number; whistle: number; level: number }> = {
  stock: { wave: 'sawtooth', sub: 'square', pitch: 1, subLevel: 0.5, bright: 1, whistle: 0, level: 1 },
  // Lower and lumpy: a big sub-octave, a darker filter.
  v8: { wave: 'sawtooth', sub: 'square', pitch: 0.72, subLevel: 0.95, bright: 0.7, whistle: 0, level: 1.1 },
  // A scream: higher, thinner, brighter.
  v10: { wave: 'sawtooth', sub: 'triangle', pitch: 1.45, subLevel: 0.25, bright: 1.35, whistle: 0, level: 0.9 },
  // The stock engine with a turbo whistling over it.
  turbo: { wave: 'sawtooth', sub: 'square', pitch: 0.9, subLevel: 0.6, bright: 0.85, whistle: 0.05, level: 1 },
  // A smooth rising whine, no gears to speak of.
  electric: { wave: 'sine', sub: 'triangle', pitch: 2.6, subLevel: 0.35, bright: 1.6, whistle: 0, level: 0.75 },
};

export interface Camera {
  shot: string;
  car: number;
}

export type RadioLine = [who: 'driver' | 'team', text: string];

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private scrub: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private radioBus: GainNode | null = null;
  /** What the radio is playing now, so a new call can cut it off. */
  private onAir: AudioBufferSourceNode[] = [];
  private noise: AudioBuffer | null = null;
  private lastSpeed: number[] = [];
  private lastStep = -1;
  private lastWall: boolean[] = [];
  private lastCar: boolean[] = [];
  private lastHit = 0;
  private resumeOnTap: (() => void) | null = null;

  get on(): boolean {
    return this.ctx !== null;
  }

  /** Start the sound. Call from a tap; or later, and the first tap anywhere wakes it. */
  enable(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // A gentle limiter, so six engines and a crash never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    master.connect(comp);
    this.master = master;

    // White noise, looped, for tyres and hits.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    for (let i = 0; i < VOICES; i++) {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      const subGain = ctx.createGain();
      subGain.gain.value = 0.5;
      const whistle = ctx.createOscillator();
      whistle.type = 'sine';
      const whistleGain = ctx.createGain();
      whistleGain.gain.value = 0;
      saw.connect(filter);
      sub.connect(subGain).connect(filter);
      filter.connect(gain).connect(pan).connect(master);
      whistle.connect(whistleGain).connect(gain);
      saw.start();
      sub.start();
      whistle.start();
      this.voices.push({ car: -1, saw, sub, whistle, whistleGain, subGain, filter, gain, pan, engine: 'stock' });
    }

    // Tyre scrub: broad, low noise, roughened by a fast wobble in its level,
    // like rubber skipping over asphalt.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.6;
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 2200;
    const grain = ctx.createGain();
    grain.gain.value = 0.6;
    const wobble = ctx.createOscillator();
    wobble.type = 'triangle';
    wobble.frequency.value = 27;
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    wobble.connect(depth).connect(grain.gain);
    wobble.start();
    const scrubGain = ctx.createGain();
    scrubGain.gain.value = 0;
    src.connect(band).connect(body).connect(grain).connect(scrubGain).connect(master);
    src.start();
    this.scrub = { gain: scrubGain, filter: band };

    // The radio channel: the band of a two-way radio and a little grit. It
    // goes past the master, so a paused replay does not cut a call short.
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 320;
    const high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = 3400;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2);
    drive.curve = curve;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(low).connect(high).connect(drive).connect(comp);
    this.radioBus = bus;

    if (ctx.state === 'suspended') {
      this.resumeOnTap = () => void ctx.resume();
      window.addEventListener('pointerdown', this.resumeOnTap, { once: true });
    }
  }

  disable(): void {
    if (this.resumeOnTap) window.removeEventListener('pointerdown', this.resumeOnTap);
    this.resumeOnTap = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.voices = [];
    this.scrub = null;
    this.radioBus = null;
    this.onAir = [];
    this.lastStep = -1;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  /** Silence the cars without tearing down - a paused replay, the end of a session. */
  hush(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  /** One frame of the race as the camera sees it. `looks` by car: whose engine sounds how. */
  update(snap: RacingSnapshot, camera: Camera, looks?: ReadonlyArray<CarLook | undefined>): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.scrub) return;
    const now = ctx.currentTime;
    const cars = snap.cars;
    const steps = this.lastStep < 0 ? 1 : snap.step - this.lastStep;
    if (steps <= 0) {
      // Not moving (paused) or moved back (a seek): quiet, and start afresh.
      if (steps < 0) this.lastSpeed = [];
      this.lastStep = snap.step;
      this.hush();
      return;
    }
    this.lastStep = snap.step;
    this.master.gain.setTargetAtTime(0.55, now, 0.15);

    // Who is heard, and from where.
    const overview = camera.shot === 'overview';
    const focus = cars[camera.car] ?? cars[snap.order[0]];
    const heard: Array<{ car: number; level: number; pan: number }> = [];
    if (overview) {
      for (const car of snap.order.slice(0, VOICES)) {
        if (!cars[car]?.done) heard.push({ car, level: 0.28, pan: 0 });
      }
    } else if (focus) {
      const cos = Math.cos(focus.angle);
      const sin = Math.sin(focus.angle);
      const near = cars
        .map((c, car) => {
          const dx = c.x - focus.x;
          const dy = c.y - focus.y;
          // Sideways in the focus car's frame: left of it is left of the screen.
          const side = -dx * sin + dy * cos;
          const d = Math.hypot(dx, dy);
          return { car, d, pan: Math.max(-1, Math.min(1, side / 160)), done: c.done };
        })
        .filter((c) => !c.done)
        .sort((a, b) => a.d - b.d)
        .slice(0, VOICES);
      for (const c of near) heard.push({ car: c.car, level: 1 / (1 + (c.d / HEAR_HALF) ** 2), pan: c.pan });
    }

    // Engines: keep a voice on the car it was on, so a note never jumps cars.
    const free = this.voices.filter((v) => !heard.some((h) => h.car === v.car));
    for (const h of heard) {
      let v = this.voices.find((x) => x.car === h.car);
      if (!v) {
        v = free.shift();
        if (!v) continue;
        v.car = h.car;
      }
      const c = cars[h.car];
      const prev = this.lastSpeed[h.car] ?? c.speed;
      const accel = (c.speed - prev) / steps;
      const kind: EngineKind = looks?.[h.car]?.engine ?? 'stock';
      const e = ENGINES[kind] ?? ENGINES.stock;
      if (v.engine !== kind) {
        v.engine = kind;
        v.saw.type = e.wave;
        v.sub.type = e.sub;
        v.subGain.gain.setTargetAtTime(e.subLevel, now, 0.05);
      }
      const { freq: stock, load } = engineNote(c.speed, accel > 0.01);
      // An electric motor has no gears: one smooth climb with the speed.
      const freq = kind === 'electric' ? 60 + Math.min(1, c.speed / SPEED_SCALE) * 170 : stock;
      v.saw.frequency.setTargetAtTime(freq * e.pitch, now, 0.05);
      v.sub.frequency.setTargetAtTime((freq * e.pitch) / 2, now, 0.05);
      v.whistle.frequency.setTargetAtTime(2400 + load * 1800, now, 0.2);
      v.whistleGain.gain.setTargetAtTime(e.whistle * load * h.level, now, 0.15);
      v.filter.frequency.setTargetAtTime((500 + load * 2200) * e.bright, now, 0.06);
      v.gain.gain.setTargetAtTime(0.16 * e.level * h.level * (0.55 + 0.45 * load), now, 0.08);
      v.pan.pan.setTargetAtTime(h.pan, now, 0.1);
    }
    for (const v of free) {
      v.gain.gain.setTargetAtTime(0, now, 0.1);
      v.whistleGain.gain.setTargetAtTime(0, now, 0.1);
      v.car = -1;
    }

    // Tyres and hits, from the cars heard.
    let scrub = 0;
    let wall = 0;
    let contact = 0;
    for (const h of heard) {
      const c = cars[h.car];
      const prev = this.lastSpeed[h.car] ?? c.speed;
      const decel = (prev - c.speed) / steps;
      const braking = decel > BRAKE_DECEL && c.speed > 1.5 ? Math.min(1, (decel - BRAKE_DECEL) * 6) : 0;
      const slide = c.sliding ? Math.min(1, 0.4 + Math.abs(c.slip) * 0.5) : 0;
      scrub = Math.max(scrub, Math.max(braking * 0.7, slide) * h.level * Math.min(1, c.speed / 3));
      if (c.touchingWall && !this.lastWall[h.car]) wall = Math.max(wall, h.level * Math.min(1, 0.35 + prev / 5));
      if (c.touchingCar && !this.lastCar[h.car]) contact = Math.max(contact, h.level * Math.min(1, 0.3 + prev / 6));
    }
    this.scrub.gain.gain.setTargetAtTime(scrub * 0.32, now, 0.05);
    this.scrub.filter.frequency.setTargetAtTime(700 + scrub * 600, now, 0.08);
    if (now - this.lastHit > 0.12) {
      if (wall > 0.05) {
        this.lastHit = now;
        this.impact(wall, 'wall');
      } else if (contact > 0.05) {
        this.lastHit = now;
        this.impact(contact, 'car');
      }
    }

    this.lastSpeed = cars.map((c) => c.speed);
    this.lastWall = cars.map((c) => c.touchingWall);
    this.lastCar = cars.map((c) => c.touchingCar);
  }

  /**
   * A hit. Into a wall: a deep thump, the crunch of the bodywork and a clank.
   * Car against car: a lighter knock and a short scrape.
   */
  impact(level: number, kind: 'wall' | 'car'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    const from = kind === 'wall' ? 95 : 140;
    thump.frequency.setValueAtTime(from, t);
    thump.frequency.exponentialRampToValueAtTime(from * 0.4, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * (kind === 'wall' ? 0.9 : 0.55), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'wall' ? 0.3 : 0.16));
    thump.connect(g).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.35);
    if (kind === 'wall') {
      this.burst(level * 0.6, 1600, 0.2);
      this.burst(level * 0.25, 3200, 0.07, 'bandpass');
    } else {
      this.burst(level * 0.35, 1100, 0.12);
      this.burst(level * 0.12, 2400, 0.18, 'bandpass');
    }
  }

  /**
   * A radio call: the recorded clips where every line has one, one after
   * another through the radio channel; otherwise the browser's voice. A new
   * call cuts off whatever was still being said.
   */
  async radio(lines: RadioLine[], lang: string, who: Speakers = {}): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.radioBus) return;
    for (const s of this.onAir) {
      try {
        s.stop();
      } catch {
        // Already over.
      }
    }
    this.onAir = [];
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    const voiced = lang === 'he' ? await geminiFiles() : null;
    const names = lines.map(([role, text]) => {
      const voice = voiced && voiceFor_(voiced, role, who);
      const clip = voice && voiced!.clips[`${voice}|${role}|${text}`];
      return clip ? `gemini/${clip}` : null;
    });
    if (names.some((n) => !n)) {
      speakRadio(lines, lang);
      return;
    }
    const buffers = await Promise.all(names.map((n) => clip(ctx, n!)));
    // Switched off while the clips loaded, or one would not load.
    if (this.ctx !== ctx || !this.radioBus) return;
    if (buffers.some((b) => !b)) {
      speakRadio(lines, lang);
      return;
    }
    this.burst(0.06, 1800, 0.1, 'bandpass', this.radioBus);
    let at = ctx.currentTime + 0.12;
    for (const b of buffers) {
      const src = ctx.createBufferSource();
      src.buffer = b!;
      src.connect(this.radioBus);
      src.start(at);
      this.onAir.push(src);
      at += b!.duration + 0.25;
    }
  }

  /** A short noise hit: part of a crash, or the click of a radio opening. */
  burst(level: number, freq: number, seconds: number, type: BiquadFilterType = 'lowpass', out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(filter).connect(gain).connect(out ?? this.master);
    src.start(t, Math.random() * 0.5, seconds + 0.05);
  }
}

/** Who is talking: the driver's entry id and the team's account, which pick the two voices. */
export interface Speakers {
  driverId?: string;
  teamId?: string;
}

interface GeminiIndex {
  /** Per role, the voices that have every line of it, in the order they were recorded. */
  voices: { driver: string[]; team: string[] };
  /** "voice|role|text" to a file in public/radio/gemini. */
  clips: Record<string, string>;
}

let geminiPromise: Promise<GeminiIndex | null> | null = null;

function geminiFiles(): Promise<GeminiIndex | null> {
  geminiPromise ??= fetch('/radio/gemini/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<GeminiIndex>) : null))
    .catch(() => null);
  return geminiPromise;
}

/** A stable number from an id, to deal voices out. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The voice of one side of the radio. A driver always has the same voice,
 * and so does a pit wall - which, where there is a choice, is not the voice
 * of its own driver, so the two halves of a call never sound alike.
 */
function voiceFor_(index: GeminiIndex, role: 'driver' | 'team', who: Speakers): string | null {
  const drivers = index.voices.driver ?? [];
  const teams = index.voices.team ?? [];
  const driverVoice = drivers.length ? drivers[hashOf(who.driverId ?? '') % drivers.length] : null;
  if (role === 'driver') return driverVoice;
  if (!teams.length) return null;
  const options = teams.length > 1 ? teams.filter((v) => v !== driverVoice) : teams;
  return options[hashOf(who.teamId ?? who.driverId ?? '') % options.length];
}

const clips = new Map<string, Promise<AudioBuffer | null>>();

function clip(ctx: AudioContext, name: string): Promise<AudioBuffer | null> {
  let p = clips.get(name);
  if (!p) {
    p = fetch(`/radio/${name}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    clips.set(name, p);
  }
  return p;
}

/**
 * Play an engine pulling up through the gears, for the shop: a car alone on
 * a straight for two and a half seconds, through its own short-lived context.
 */
export function previewEngine(kind: EngineKind): void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const e = ENGINES[kind] ?? ENGINES.stock;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  filter.connect(out);
  const saw = ctx.createOscillator();
  saw.type = e.wave;
  const sub = ctx.createOscillator();
  sub.type = e.sub;
  const subGain = ctx.createGain();
  subGain.gain.value = e.subLevel;
  const whistle = ctx.createOscillator();
  const whistleGain = ctx.createGain();
  whistleGain.gain.value = e.whistle * 0.8;
  saw.connect(filter);
  sub.connect(subGain).connect(filter);
  whistle.connect(whistleGain).connect(out);
  const t0 = ctx.currentTime + 0.05;
  const steps = 50;
  for (let i = 0; i <= steps; i++) {
    const speed = (i / steps) * SPEED_SCALE;
    const at = t0 + (i / steps) * 2.4;
    const { freq: stock, load } = engineNote(speed, true);
    const freq = (kind === 'electric' ? 60 + (i / steps) * 170 : stock) * e.pitch;
    saw.frequency.setValueAtTime(freq, at);
    sub.frequency.setValueAtTime(freq / 2, at);
    whistle.frequency.setValueAtTime(2400 + load * 1800, at);
    filter.frequency.setValueAtTime((500 + load * 2200) * e.bright, at);
  }
  out.gain.setTargetAtTime(0.22 * e.level, t0, 0.05);
  out.gain.setTargetAtTime(0, t0 + 2.4, 0.08);
  for (const o of [saw, sub, whistle]) {
    o.start(t0);
    o.stop(t0 + 2.8);
  }
  setTimeout(() => void ctx.close(), 3200);
}

/**
 * The engine's note at a speed: up through the gears, each one starting a
 * little higher than the last began, the way a car sounds going down a
 * straight. `load` is how hard it is working - more of the harsh top end.
 */
export function engineNote(speed: number, pulling: boolean): { freq: number; load: number } {
  const v = Math.max(0, Math.min(1, speed / SPEED_SCALE));
  const span = 1 / GEARS;
  const gear = Math.min(GEARS - 1, Math.floor(v / span));
  const inGear = (v - gear * span) / span;
  const rpm = 0.32 + 0.68 * inGear;
  const freq = 55 + gear * 9 + rpm * 120;
  const load = Math.min(1, (pulling ? 0.65 : 0.25) + rpm * 0.35);
  return { freq, load };
}

/** The best voice the browser has for a language, or null. */
function voiceFor(lang: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const all = speechSynthesis.getVoices();
  const code = lang.toLowerCase();
  // Hebrew is "he" to most browsers and "iw" to some older Android ones.
  const codes = code === 'he' ? ['he', 'iw'] : [code];
  return all.find((v) => codes.some((c) => v.lang.toLowerCase().startsWith(c))) ?? null;
}

// Voices load late in Chrome; asking once early makes the first call find them.
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();

/**
 * Say a radio exchange with the browser's voice: the driver a little higher
 * and quicker, the pit wall lower and calmer. Silent where the browser has no
 * voice for the language.
 */
function speakRadio(lines: RadioLine[], lang: string): void {
  const voice = voiceFor(lang);
  if (!voice) return;
  speechSynthesis.cancel();
  for (const [who, text] of lines) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.pitch = who === 'driver' ? 1.15 : 0.85;
    u.rate = who === 'driver' ? 1.12 : 1.0;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  }
}

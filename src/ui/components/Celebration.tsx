import { useEffect, useRef } from 'react';
import type { CelebrationKind } from '../../core/games/racing/render';
import { useMotion } from '../motion';

/**
 * A podium celebration: a few seconds of confetti, bubbles, champagne and the
 * like over a car, bought in the shop. Drawn on a canvas that spills past the
 * car it sits on, never catching a tap meant for what is underneath.
 *
 * With animations off (the device asked for less motion, or the settings say
 * so) it draws one still frame from the middle of the celebration instead:
 * still a celebration, and nothing moves.
 */
export function Celebration({
  kind,
  colors,
  play = 0,
  fit,
}: {
  kind: CelebrationKind;
  /** The team's colours, first the main one; gold is added to every celebration. */
  colors: string[];
  /** Change it to play again. */
  play?: number;
  /** Fill the parent exactly, for a small swatch, rather than spill over it. */
  fit?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moving = useMotion() && !fit;
  const key = colors.join(',');

  useEffect(() => {
    const c = ref.current;
    const parent = c?.parentElement;
    if (!c || !parent) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = [...colors.filter(Boolean), GOLD];
    let stage: Stage;
    if (fit) {
      // A swatch is too small to throw anything across: play on a stage of
      // podium size and shrink the picture into the swatch.
      // Pieces are drawn bigger than they fly, or they would be specks.
      const side = 110;
      g.scale(w / side, h / side);
      stage = { w: side, h: side, origin: { x: side / 2, y: side * 0.7 }, scale: 0.55, grain: 1.5, palette };
    } else {
      // Where the car is, in the canvas: the middle of the parent.
      const cr = c.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      const origin = { x: pr.left + pr.width / 2 - cr.left, y: pr.top + pr.height * 0.45 - cr.top };
      const scale = Math.max(0.35, pr.height / 110);
      stage = { w, h, origin, scale, grain: scale, palette };
    }
    const show = makeShow(kind, stage);

    if (!moving) {
      // The still frame: run the show to its fullest moment and stop there.
      const dt = 1 / 30;
      for (let t = 0; t < show.peak; t += dt) show.step(t, dt);
      g.clearRect(0, 0, stage.w, stage.h);
      show.draw(g, show.peak);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const start = last;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      show.step(t, dt);
      g.clearRect(0, 0, stage.w, stage.h);
      if (t > DURATION_S + 1.2) return;
      show.draw(g, t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, play, moving, fit]);

  return <canvas ref={ref} className={`celebration ${fit ? 'fit' : ''}`} aria-hidden="true" />;
}

const GOLD = '#ffd34d';
/** How long new pieces keep coming; the last ones then fall or fade. */
const DURATION_S = 3.4;

interface Stage {
  w: number;
  h: number;
  origin: { x: number; y: number };
  /** How far things fly. */
  scale: number;
  /** How big each piece is drawn. */
  grain: number;
  palette: string[];
}

interface Show {
  /** The moment the still frame shows. */
  peak: number;
  step(t: number, dt: number): void;
  draw(g: CanvasRenderingContext2D, t: number): void;
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  spin: number;
  turn: number;
  /** Rockets: the height they burst at. Bubbles: the sway phase. */
  aux: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function piece(p: Partial<Piece> & { x: number; y: number }): Piece {
  return { vx: 0, vy: 0, age: 0, life: 3, size: 4, color: GOLD, spin: 0, turn: 0, aux: 0, ...p };
}

/** Moves every piece, drops the dead ones. */
function advance(list: Piece[], dt: number, gravity: number, drag = 0): Piece[] {
  for (const p of list) {
    p.age += dt;
    p.vy += gravity * dt;
    if (drag) {
      p.vx *= 1 - drag * dt;
      p.vy *= 1 - drag * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.spin += p.turn * dt;
  }
  return list.filter((p) => p.age < p.life);
}

/** 1 for most of a piece's life, easing to 0 at the end. */
const fade = (p: Piece, tail = 0.3) => Math.max(0, Math.min(1, (p.life - p.age) / (p.life * tail)));

function makeShow(kind: CelebrationKind, s: Stage): Show {
  switch (kind) {
    case 'confetti':
      return confetti(s);
    case 'bubbles':
      return bubbles(s);
    case 'balloons':
      return balloons(s);
    case 'champagne':
      return champagne(s);
    case 'fireworks':
      return fireworks(s);
    default:
      return sparkles(s);
  }
}

/** Two bursts from the car, then the paper flutters down. */
function confetti(s: Stage): Show {
  let list: Piece[] = [];
  const burst = (n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rnd(-Math.PI * 0.85, -Math.PI * 0.15);
      const v = rnd(160, 340) * s.scale;
      list.push(piece({
        x: s.origin.x, y: s.origin.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rnd(2.2, 3.4), size: rnd(4, 7) * s.grain, color: pick(s.palette),
        spin: rnd(0, 6), turn: rnd(-12, 12),
      }));
    }
  };
  let fired = 0;
  return {
    peak: 0.7,
    step(t, dt) {
      if (fired === 0 && t >= 0) { burst(70); fired = 1; }
      if (fired === 1 && t >= 0.6) { burst(50); fired = 2; }
      list = advance(list, dt, 260 * s.scale, 2.2);
      // Paper sways as it falls.
      for (const p of list) p.vx += Math.sin(p.spin) * 30 * dt * s.scale;
    },
    draw(g) {
      for (const p of list) {
        g.save();
        g.globalAlpha = fade(p);
        g.translate(p.x, p.y);
        g.rotate(p.spin * 0.5);
        g.scale(1, Math.cos(p.spin));
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        g.restore();
      }
    },
  };
}

/** Soap bubbles drift up from the car, swaying, and pop. */
function bubbles(s: Stage): Show {
  let list: Piece[] = [];
  let pops: Piece[] = [];
  let next = 0;
  return {
    peak: 1.6,
    step(t, dt) {
      while (t < DURATION_S - 0.8 && next <= t) {
        list.push(piece({
          x: s.origin.x + rnd(-14, 14) * s.scale, y: s.origin.y,
          vx: rnd(-30, 30) * s.scale, vy: rnd(-70, -35) * s.scale,
          life: rnd(1.8, 3), size: rnd(5, 13) * s.grain, aux: rnd(0, 6), color: pick(s.palette),
        }));
        next += 0.09;
      }
      for (const p of list) {
        p.vx += Math.sin(p.age * 3 + p.aux) * 40 * dt * s.scale;
        if (p.age + dt >= p.life) pops.push(piece({ x: p.x, y: p.y, life: 0.25, size: p.size }));
      }
      list = advance(list, dt, -10 * s.scale, 0.6);
      pops = advance(pops, dt, 0);
    },
    draw(g) {
      for (const p of list) {
        const r = p.size * Math.min(1, 0.4 + p.age * 1.5);
        const grad = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(0.6, 'rgba(255,255,255,0.06)');
        grad.addColorStop(1, 'rgba(255,255,255,0.18)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
        // A rim in the team's colour, the rainbow sheen a bubble has.
        g.globalAlpha = 0.75;
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(1, r * 0.12);
        g.beginPath();
        g.arc(p.x, p.y, r, Math.PI * 0.9, Math.PI * 1.9);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.beginPath();
        g.arc(p.x, p.y, r, Math.PI * 1.9, Math.PI * 2.9);
        g.stroke();
        g.globalAlpha = 1;
      }
      for (const p of pops) {
        const k = p.age / p.life;
        g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        g.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const r0 = p.size * (0.8 + k);
          g.beginPath();
          g.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
          g.lineTo(p.x + Math.cos(a) * (r0 + 4), p.y + Math.sin(a) * (r0 + 4));
          g.stroke();
        }
      }
    },
  };
}

/** A handful of balloons in the team's colours, let go one after another. */
function balloons(s: Stage): Show {
  let list: Piece[] = [];
  let next = 0;
  let n = 0;
  return {
    peak: 1.5,
    step(t, dt) {
      while (n < 8 && next <= t) {
        list.push(piece({
          x: s.origin.x + rnd(-24, 24) * s.scale, y: s.origin.y,
          vx: rnd(-14, 14) * s.scale, vy: rnd(-95, -70) * s.scale,
          life: DURATION_S + 0.6 - next, size: rnd(9, 12) * s.grain, aux: rnd(0, 6),
          color: s.palette[n % s.palette.length],
        }));
        n++;
        next += 0.28;
      }
      for (const p of list) p.vx = Math.sin(p.age * 2 + p.aux) * 16 * s.scale;
      list = advance(list, dt, 0);
    },
    draw(g) {
      for (const p of list) {
        const r = p.size;
        g.globalAlpha = fade(p, 0.15);
        // The string, trailing and swaying.
        g.strokeStyle = 'rgba(160,170,190,0.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(p.x, p.y + r * 1.2);
        g.quadraticCurveTo(p.x + Math.sin(p.age * 3 + p.aux) * 6, p.y + r * 2.2, p.x - p.vx * 0.1, p.y + r * 3.2);
        g.stroke();
        g.fillStyle = p.color;
        g.beginPath();
        g.ellipse(p.x, p.y, r * 0.85, r * 1.05, 0, 0, Math.PI * 2);
        g.fill();
        // The knot and a highlight.
        g.beginPath();
        g.moveTo(p.x - 2.5, p.y + r * 1.15);
        g.lineTo(p.x + 2.5, p.y + r * 1.15);
        g.lineTo(p.x, p.y + r);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.beginPath();
        g.ellipse(p.x - r * 0.3, p.y - r * 0.4, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    },
  };
}

/** A spray of champagne from the car, swinging from one side to the other. */
function champagne(s: Stage): Show {
  let list: Piece[] = [];
  return {
    peak: 1.1,
    step(t, dt) {
      if (t < 2.2) {
        // The bottle swings across the top of the car and back.
        const aim = -Math.PI / 2 + Math.sin(t * 2.2) * 0.75;
        const count = Math.round(260 * dt);
        for (let i = 0; i < count; i++) {
          const a = aim + rnd(-0.12, 0.12);
          const v = rnd(230, 330) * s.scale;
          list.push(piece({
            x: s.origin.x, y: s.origin.y - 10 * s.scale, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            life: rnd(0.9, 1.5), size: rnd(1.4, 3) * s.grain,
            color: Math.random() < 0.7 ? '#fff4c2' : Math.random() < 0.5 ? GOLD : '#ffffff',
          }));
        }
      }
      list = advance(list, dt, 420 * s.scale, 0.8);
    },
    draw(g) {
      for (const p of list) {
        g.globalAlpha = 0.85 * fade(p, 0.4);
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
  };
}

/** Small rockets go up from the car and burst over it. */
function fireworks(s: Stage): Show {
  let rockets: Piece[] = [];
  let sparks: Piece[] = [];
  let next = 0;
  let n = 0;
  return {
    peak: 1.25,
    step(t, dt) {
      while (n < 5 && next <= t) {
        const top = Math.max(12, s.origin.y - rnd(70, 120) * s.scale);
        rockets.push(piece({
          x: s.origin.x + rnd(-8, 8) * s.scale, y: s.origin.y,
          vx: rnd(-45, 45) * s.scale, vy: -320 * s.scale, life: 2, aux: top, color: s.palette[n % s.palette.length],
        }));
        n++;
        next += 0.55;
      }
      for (const r of rockets) {
        if (r.y <= r.aux) {
          r.age = r.life;
          const count = 42;
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + rnd(-0.05, 0.05);
            const v = rnd(70, 130) * s.scale;
            sparks.push(piece({
              x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
              life: rnd(0.9, 1.4), size: rnd(1.4, 2.4) * s.grain, color: Math.random() < 0.8 ? r.color : GOLD,
            }));
          }
        }
      }
      rockets = advance(rockets, dt, 0);
      sparks = advance(sparks, dt, 90 * s.scale, 1.6);
    },
    draw(g) {
      for (const r of rockets) {
        g.strokeStyle = r.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(r.x, r.y);
        g.lineTo(r.x - r.vx * 0.06, r.y - r.vy * 0.06);
        g.stroke();
      }
      for (const p of sparks) {
        g.globalAlpha = fade(p, 0.5);
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
  };
}

/** Gold stars twinkle around the car and drift up. The quiet one. */
function sparkles(s: Stage): Show {
  let list: Piece[] = [];
  let next = 0;
  return {
    peak: 1.2,
    step(t, dt) {
      while (t < DURATION_S - 0.6 && next <= t) {
        const a = rnd(0, Math.PI * 2);
        const d = rnd(14, 46) * s.scale;
        list.push(piece({
          x: s.origin.x + Math.cos(a) * d, y: s.origin.y + Math.sin(a) * d * 0.9,
          vy: rnd(-26, -12) * s.scale, life: rnd(0.8, 1.4), size: rnd(4, 8) * s.grain,
          color: Math.random() < 0.65 ? GOLD : pick(s.palette), spin: rnd(0, 1),
        }));
        next += 0.05;
      }
      list = advance(list, dt, 0);
    },
    draw(g) {
      for (const p of list) {
        // Grows then shrinks: a twinkle.
        const k = Math.sin((p.age / p.life) * Math.PI);
        const r = p.size * k;
        g.fillStyle = p.color;
        g.globalAlpha = Math.min(1, k * 1.4);
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + p.spin;
          const rr = i % 2 === 0 ? r : r * 0.28;
          const x = p.x + Math.cos(a) * rr;
          const y = p.y + Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    },
  };
}

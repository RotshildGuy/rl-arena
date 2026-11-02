/**
 * The team emblem: a shape, a symbol on it, and two colours - each picked from
 * a closed list, so an emblem is four ids and never free text or an emoji.
 * Nothing in it needs moderating, and nothing in it draws as a box on a device
 * that lacks some font.
 *
 * Every shape and symbol is one SVG path on a 24x24 box. The same string draws
 * in React (`<path d>`) and on a canvas (`new Path2D(d)`), so the emblem in a
 * table and the one on the car are the same drawing. Symbols fill even-odd,
 * which is what lets a ring have a hole.
 */

export interface Emblem {
  shape: string;
  symbol: string;
  /** The symbol's colour. */
  fg: string;
  /** The shape's colour. */
  bg: string;
}

/** A regular star around the centre of the box, `points` tips, alternating radii. */
function star(points: number, outer: number, inner: number, cy = 12): string {
  const parts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    parts.push(`${i === 0 ? 'M' : 'L'}${(12 + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return parts.join(' ') + ' Z';
}

/** A full circle as two arcs (one arc from a point to itself draws nothing). */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** A three-by-three chequer, the flag that ends every race. */
function chequer(): string {
  const out: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if ((row + col) % 2) continue;
      const x = 7.5 + col * 3;
      const y = 7.5 + row * 3;
      out.push(`M${x} ${y} H${x + 3} V${y + 3} H${x} Z`);
    }
  }
  return out.join(' ');
}

/** Append-only in spirit: an id here may be on somebody's emblem. */
export const EMBLEM_SHAPES: Record<string, string> = {
  shield: 'M12 1.5 L21 4.5 V11 C21 16.5 17.2 20.6 12 22.5 C6.8 20.6 3 16.5 3 11 V4.5 Z',
  circle: circle(12, 12, 10.5),
  hexagon: 'M12 1.5 L21.1 6.75 V17.25 L12 22.5 L2.9 17.25 V6.75 Z',
  diamond: 'M12 1 L23 12 L12 23 L1 12 Z',
};

export const EMBLEM_SYMBOLS: Record<string, string> = {
  star: star(5, 6.5, 2.7),
  bolt: 'M13.6 4.8 L7.6 13.2 H11.4 L10.4 19.2 L16.4 10.8 H12.6 Z',
  flame:
    'M12 4.6 C14.6 7.6 16.6 10 16.6 13.6 A4.6 4.6 0 0 1 7.4 13.6 C7.4 11.6 8.5 10.2 9.6 9 C9.8 10.6 10.6 11.6 11.6 12 C11.2 9.6 11.6 7 12 4.6 Z',
  crown: 'M6.4 16.6 L5.4 8.4 L9.2 11.4 L12 6.8 L14.8 11.4 L18.6 8.4 L17.6 16.6 Z',
  chevron: 'M5.8 8.6 L12 13.6 L18.2 8.6 V12.4 L12 17.4 L5.8 12.4 Z',
  arrow: 'M12 5.2 L17.8 11 H14.1 V18.6 H9.9 V11 H6.2 Z',
  wheel: `${circle(12, 12, 6.6)} ${circle(12, 12, 4.4)} ${circle(12, 12, 1.6)}`,
  chequer: chequer(),
  heart: 'M12 18.2 C7 14.6 5.4 12.2 5.4 9.9 A3.3 3.3 0 0 1 12 8.6 A3.3 3.3 0 0 1 18.6 9.9 C18.6 12.2 17 14.6 12 18.2 Z',
  mountain: 'M4.8 17.2 L10 8.8 L12.6 12.6 L14.6 10 L19.2 17.2 Z',
  drop: 'M12 4.8 C14.6 8.8 16.6 11.4 16.6 14 A4.6 4.6 0 0 1 7.4 14 C7.4 11.4 9.4 8.8 12 4.8 Z',
  sun: star(8, 6.8, 4.2),
};

/**
 * The colours an emblem may use. No purple, green or yellow, for the same
 * reason the shop has no such paint: on a timing screen they mean lap times.
 */
export const EMBLEM_COLORS: readonly string[] = [
  '#f4f6fb', '#14161d', '#ff2e4d', '#b3122e', '#ff7a1a',
  '#38bdf8', '#2346c8', '#14b8a6', '#ff5fa2', '#c8d0de',
];

/** What a team gets the moment it unlocks the builder, before choosing anything. */
export const DEFAULT_EMBLEM: Emblem = { shape: 'shield', symbol: 'star', fg: '#f4f6fb', bg: '#2346c8' };

/**
 * An emblem as read from somebody's shop document, which anybody can write:
 * anything not on the lists is null, and the emblem is not drawn at all.
 */
export function normalizeEmblem(raw: unknown): Emblem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { shape, symbol, fg, bg } = r;
  if (typeof shape !== 'string' || !Object.hasOwn(EMBLEM_SHAPES, shape)) return null;
  if (typeof symbol !== 'string' || !Object.hasOwn(EMBLEM_SYMBOLS, symbol)) return null;
  if (typeof fg !== 'string' || !EMBLEM_COLORS.includes(fg)) return null;
  if (typeof bg !== 'string' || !EMBLEM_COLORS.includes(bg)) return null;
  // A symbol in the colour of its shape is an empty badge.
  if (fg === bg) return null;
  return { shape, symbol, fg, bg };
}

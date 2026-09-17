/**
 * Team liveries.
 *
 * A championship is only readable if you can find your car at a glance, so a
 * team's colour is derived from its name and never changes: the same person gets
 * the same colour on every screen, in every race, on every device — no central
 * registry needed.
 */
export const TEAM_COLORS = [
  '#FF3B5C', // scarlet
  '#22D3EE', // cyan
  '#A3E635', // lime
  '#C084FC', // violet
  '#FB923C', // orange
  '#38BDF8', // sky
  '#F472B6', // magenta
  '#34D399', // emerald
  '#FACC15', // amber
  '#818CF8', // indigo
  '#F87171', // coral
  '#2DD4BF', // teal
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function teamColor(team: string): string {
  return TEAM_COLORS[hash(team.trim() || 'team') % TEAM_COLORS.length];
}

/**
 * A driver's three-letter code, the way a timing screen abbreviates a name.
 * Latin letters are upper-cased; Hebrew has no case, so the first three
 * characters stand as they are.
 */
export function driverTag(name: string): string {
  const clean = name.replace(/[\s'"־–-]/g, '');
  const three = (clean || 'CAR').slice(0, 3);
  return /[a-z]/i.test(three) ? three.toUpperCase() : three;
}

/**
 * Two cars from the same team need telling apart, exactly as a real team's two
 * drivers do. The second gets a lighter shade of the same livery.
 */
export function shadeFor(color: string, index: number): string {
  if (index <= 0) return color;
  const amount = Math.min(0.55, index * 0.28);
  const n = parseInt(color.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (
    '#' +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((c) => mix(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

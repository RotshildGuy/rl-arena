import { teamColor, teamLook } from './livery';
import type { Paint } from './shop';
import type { CarLook } from '../games/racing/render';

/**
 * How the cars of a field are painted, from what each team bought (already
 * checked by `validLook`) and what is derived from names. Pure, so every
 * browser that draws a grid paints it the same.
 */

export interface CarRef {
  id: string;
  uid: string;
  team: string;
  driver: string;
}

/**
 * The numbers a team's cars wear, one each and never two the same. A number
 * the team picked for a car comes first; a car without one takes the old
 * team-wide number, else the one derived from its name - moved up one at a
 * time past any number a team-mate already has. `cars` must come in the same
 * order in every browser (a race card's entry list does), so every viewer
 * sees the same numbers.
 */
export function teamNumbers(cars: CarRef[], bought: Paint | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const c of cars) {
    const n = bought?.numbers?.[c.id];
    if (n !== undefined && !taken.has(n)) {
      out.set(c.id, n);
      taken.add(n);
    }
  }
  for (const c of cars) {
    if (out.has(c.id)) continue;
    let n = bought?.look.number ?? teamLook(c.team, c.driver).number ?? 1;
    for (let tries = 0; taken.has(n) && tries < 99; tries++) n = (n % 99) + 1;
    out.set(c.id, n);
    taken.add(n);
  }
  return out;
}

/**
 * How every car of a field is painted: one colour for the whole team, the
 * team's bought look over the look derived from its name, and a number of
 * its own on each car. Broadcast, report and share card all draw from this,
 * so a car looks the same on every screen.
 */
export function fieldPaint(
  cars: CarRef[],
  paint: Map<string, Paint>,
): Map<string, { color: string; look: CarLook; number: number }> {
  const byTeam = new Map<string, CarRef[]>();
  for (const c of cars) byTeam.set(c.uid, [...(byTeam.get(c.uid) ?? []), c]);
  const out = new Map<string, { color: string; look: CarLook; number: number }>();
  for (const [uid, mates] of byTeam) {
    const bought = paint.get(uid);
    const numbers = teamNumbers(mates, bought);
    for (const c of mates) {
      const number = numbers.get(c.id)!;
      out.set(c.id, {
        color: bought?.color ?? teamColor(c.team),
        look: { ...teamLook(c.team, c.driver), ...bought?.look, number },
        number,
      });
    }
  }
  return out;
}

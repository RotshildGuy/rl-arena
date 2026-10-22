import { RACE_LAPS } from './format';
import { TRACK_DEFS } from '../games/racing/tracks';
import type { RaceCard, RaceResult } from './types';

/**
 * All-time records, per circuit.
 *
 * The calendar rotates through the four tracks, so each one comes round every
 * few days - which is what turns a lap record into something to aim at rather
 * than a trivium. Everything here is derived from race cards and results that
 * are already loaded; no extra reads, and no separate record to keep in step.
 */
export interface RecordHolder {
  entryId: string;
  driver: string;
  team: string;
  ms: number;
  raceId: string;
  round: number;
  at: number;
}

export interface TrackRecord {
  trackId: string;
  name: string;
  races: number;
  /** Quickest lap ever set in a race on this circuit. */
  lap: RecordHolder | null;
  /** Quickest qualifying lap - the pole record. */
  quali: RecordHolder | null;
  /** Quickest full-distance race. Heats are shorter and do not qualify. */
  distance: RecordHolder | null;
}

function better(current: RecordHolder | null, candidate: RecordHolder): RecordHolder {
  return current === null || candidate.ms < current.ms ? candidate : current;
}

/**
 * Pass only race days that are over and have a result. A record revealed while
 * its race is still being broadcast would spoil the broadcast.
 */
export function trackRecords(cards: RaceCard[], results: Map<string, RaceResult>): TrackRecord[] {
  const byTrack = new Map<string, TrackRecord>();
  for (const def of TRACK_DEFS) {
    byTrack.set(def.id, { trackId: def.id, name: def.name, races: 0, lap: null, quali: null, distance: null });
  }

  for (const card of cards) {
    const rec = byTrack.get(card.trackId);
    const result = results.get(card.id);
    if (!rec || !result) continue;
    rec.races++;

    const entries = new Map(card.entries.map((e) => [e.id, e]));
    const holder = (entryId: string, ms: number): RecordHolder => {
      const e = entries.get(entryId);
      return {
        entryId,
        driver: e?.driver ?? '-',
        team: e?.team ?? '-',
        ms,
        raceId: card.id,
        round: card.round,
        at: card.startsAt,
      };
    };

    for (const q of card.qualifying) {
      if (q.bestLapMs !== null) rec.quali = better(rec.quali, holder(q.entryId, q.bestLapMs));
    }

    for (const session of result.sessions) {
      for (const f of session.classification) {
        if (f.bestLapMs !== null) rec.lap = better(rec.lap, holder(f.entryId, f.bestLapMs));
        // Only the full distance counts: a heat is six laps, and comparing it to
        // a ten-lap race would hand the record to whoever ran the shorter one.
        if (f.status === 'finished' && f.laps === RACE_LAPS && f.totalMs !== null) {
          rec.distance = better(rec.distance, holder(f.entryId, f.totalMs));
        }
      }
    }
  }

  return [...byTrack.values()];
}

/**
 * The next round that will be held on a given circuit. The calendar cycles
 * through the tracks in order, so this is arithmetic rather than a lookup.
 */
export function nextRoundOnTrack(trackId: string, afterRound: number): number | null {
  const index = TRACK_DEFS.findIndex((t) => t.id === trackId);
  if (index < 0) return null;
  const n = TRACK_DEFS.length;
  // Rounds are 1-based and round r runs track (r - 1) % n.
  const offset = ((index - afterRound % n) % n + n) % n;
  return afterRound + 1 + offset;
}

/**
 * What a lap in training has to beat, on one circuit.
 *
 * A lap time with nothing next to it does not say when a model is good enough
 * to enter. The nearest real yardstick is the pole of the last Grand Prix held
 * on the same circuit - a single flying lap on an empty track, which is exactly
 * what the best lap in training is. Before that circuit has had a Grand Prix
 * with a pole, the all-time lap record from the records tab stands in.
 *
 * Car physics matters: a pole set on tyres that never let go is not a target
 * for a car that can slide. A target from the physics being trained on is
 * always preferred, and one from another version says so (`samePhysics`).
 */
export interface TrainingTarget {
  kind: 'pole' | 'record';
  ms: number;
  /** Whose lap it is: the entry, so a house driver's name can be shown in the reader's language. */
  entryId: string;
  driver: string;
  round: number;
  raceName: string;
  samePhysics: boolean;
}

export function trainingTarget(
  cards: RaceCard[],
  results: Map<string, RaceResult>,
  trackId: string,
  physics: number,
  now: number,
): TrainingTarget | null {
  const held = cards
    .filter((c) => c.trackId === trackId && c.startsAt <= now)
    .sort((a, b) => b.round - a.round);
  const physicsOf = (c: RaceCard) => c.physics ?? 1;

  const poleOf = (c: RaceCard): TrainingTarget | null => {
    const q = c.qualifying[0];
    if (!q || q.bestLapMs === null) return null;
    const e = c.entries.find((x) => x.id === q.entryId);
    return {
      kind: 'pole',
      ms: q.bestLapMs,
      entryId: q.entryId,
      driver: e?.driver ?? '-',
      round: c.round,
      raceName: c.name,
      samePhysics: physicsOf(c) === physics,
    };
  };
  const recordOf = (pool: RaceCard[]): TrainingTarget | null => {
    const rec = trackRecords(pool, results).find((r) => r.trackId === trackId);
    const best = rec?.lap ?? null;
    if (!best) return null;
    const card = pool.find((c) => c.id === best.raceId);
    return {
      kind: 'record',
      ms: best.ms,
      entryId: best.entryId,
      driver: best.driver,
      round: best.round,
      raceName: card?.name ?? '',
      samePhysics: card ? physicsOf(card) === physics : false,
    };
  };

  const same = held.filter((c) => physicsOf(c) === physics);
  for (const c of same) {
    const t = poleOf(c);
    if (t) return t;
  }
  const sameRecord = recordOf(same);
  if (sameRecord) return sameRecord;
  for (const c of held) {
    const t = poleOf(c);
    if (t) return t;
  }
  return recordOf(held);
}

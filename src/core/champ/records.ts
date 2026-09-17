import { RACE_LAPS } from './format';
import { TRACK_DEFS } from '../games/racing/tracks';
import type { RaceCard, RaceResult } from './types';

/**
 * All-time records, per circuit.
 *
 * The calendar rotates through the four tracks, so each one comes round every
 * few days — which is what turns a lap record into something to aim at rather
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
  /** Quickest qualifying lap — the pole record. */
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
        driver: e?.driver ?? '—',
        team: e?.team ?? '—',
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

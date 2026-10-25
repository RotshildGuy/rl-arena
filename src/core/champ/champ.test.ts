import { describe, expect, it } from 'vitest';
import { awardPoints, pointsForPosition, CLASSIFY_FRACTION } from './points';
import { planSessions, snakeSeed, GRID_SIZE } from './format';
import { isNameOk, nameKey } from './names';
import { drawRotation, fitRotation, ROTATION_SIZE, TRACK_POOL_FROM_SEASON } from './rotation';
import {
  currentRound,
  israelOffsetAt20,
  lockAtForRound,
  seasonNumber,
  startsAtForRound,
  LOCK_BEFORE_MS,
} from './schedule';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe('points', () => {
  it('scores the top ten 25-18-15-12-10-8-6-4-2-1 and nothing below', () => {
    expect([1, 2, 3, 10, 11, 0].map(pointsForPosition)).toEqual([25, 18, 15, 1, 0, 0]);
  });

  it('gives the fastest-lap bonus only to a classified finisher in the points', () => {
    const base = { eliminatedIn: null, status: 'finished' as const };
    const day = awardPoints(
      [
        { ...base, entryId: 'a', position: 1, laps: 10 },
        { ...base, entryId: 'b', position: 2, laps: 10 },
      ],
      'b',
      10,
    );
    expect(day.map((p) => p.points)).toEqual([25, 19]);
  });

  it('leaves a car that covered less than half the distance unclassified', () => {
    const day = awardPoints(
      [
        { entryId: 'a', position: 1, laps: 10, eliminatedIn: null, status: 'finished' },
        { entryId: 'b', position: 2, laps: 10 * CLASSIFY_FRACTION - 1, eliminatedIn: null, status: 'dnf' },
      ],
      null,
      10,
    );
    expect(day[1]).toMatchObject({ classified: false, points: 0, position: 2 });
  });
});

describe('race-day format', () => {
  it('runs a single race when the field fits one grid', () => {
    const sessions = planSessions(ids(GRID_SIZE));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe('race');
  });

  it('splits a bigger field into heats and a final', () => {
    const sessions = planSessions(ids(25));
    expect(sessions.filter((s) => s.kind === 'heat')).toHaveLength(3);
    expect(sessions.at(-1)?.kind).toBe('final');
    const heats = sessions.filter((s) => s.kind === 'heat');
    expect(heats.reduce((n, s) => n + s.advance, 0)).toBeLessThanOrEqual(GRID_SIZE);
  });

  it('spreads qualifying order across heats in a serpentine', () => {
    expect(snakeSeed(ids(6), 3)).toEqual([
      ['c1', 'c6'],
      ['c2', 'c5'],
      ['c3', 'c4'],
    ]);
  });
});

describe('names', () => {
  it('rejects links, invisible characters and one-letter rulers', () => {
    expect(isNameOk('Red Bull Ring')).toBe(true);
    expect(isNameOk('visit spam.com')).toBe(false);
    expect(isNameOk('a‮b team')).toBe(false);
    expect(isNameOk('xxxxxxx')).toBe(false);
  });

  it('treats case and spacing variants as the same team', () => {
    expect(nameKey('  Fast   Cars ')).toBe(nameKey('fast cars'));
  });
});

describe('schedule', () => {
  it('follows Israel daylight saving at 20:00', () => {
    expect(israelOffsetAt20(2026, 6, 1)).toBe(3); // July
    expect(israelOffsetAt20(2026, 11, 1)).toBe(2); // December
    expect(israelOffsetAt20(2026, 9, 25)).toBe(2); // last Sunday of October: winter time by evening
  });

  it('starts every round at 20:00 Israel time, a day apart', () => {
    expect(new Date(startsAtForRound(1)).toISOString()).toBe('2026-10-25T18:00:00.000Z');
    expect(startsAtForRound(2) - startsAtForRound(1)).toBe(24 * 60 * 60 * 1000);
    expect(startsAtForRound(1) - lockAtForRound(1)).toBe(LOCK_BEFORE_MS);
  });

  it('knows which round has started', () => {
    expect(currentRound(startsAtForRound(1) - 1)).toBe(0);
    expect(currentRound(startsAtForRound(5))).toBe(5);
    expect(currentRound(startsAtForRound(5) + 60_000)).toBe(5);
  });

  it('groups eight rounds into a season', () => {
    expect([1, 8, 9, 16, 17].map(seasonNumber)).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('track rotation', () => {
  it('draws the same distinct circuits for a season on every client', () => {
    const n = TRACK_POOL_FROM_SEASON + 1;
    const draw = drawRotation(n);
    expect(draw).toEqual(drawRotation(n));
    expect(new Set(draw).size).toBe(ROTATION_SIZE);
  });

  it('never opens a season on the circuit the last one closed on', () => {
    expect(fitRotation(['oval', 'ring', 'coast', 'clover'], 'oval')[0]).not.toBe('oval');
  });
});

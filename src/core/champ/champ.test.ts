import { describe, expect, it } from 'vitest';
import { validLook } from './shop';
import { awardPoints, pointsForPosition, CLASSIFY_FRACTION } from './points';
import { planSessions, snakeSeed, GRID_SIZE, KNOCKOUT_FORMAT_ROUND } from './format';
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
  const V2 = KNOCKOUT_FORMAT_ROUND;
  /** Races per elimination round, in order, then "final". */
  const ladder = (n: number, round = V2) => {
    const sessions = planSessions(ids(n), round);
    const per = new Map<number, number>();
    for (const s of sessions) if (s.kind === 'heat') per.set(s.round, (per.get(s.round) ?? 0) + 1);
    return [...per.values()];
  };

  it('runs a single race when the field fits one grid', () => {
    const sessions = planSessions(ids(GRID_SIZE), V2);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe('race');
  });

  it('builds the knockout ladder from season 4', () => {
    expect(ladder(11)).toEqual([2]);
    expect(ladder(20)).toEqual([2]);
    expect(ladder(21)).toEqual([3]);
    expect(ladder(30)).toEqual([3]);
    expect(ladder(31)).toEqual([4, 2]);
    expect(ladder(40)).toEqual([4, 2]);
    expect(ladder(41)).toEqual([6, 2]);
    expect(ladder(60)).toEqual([6, 2]);
    expect(ladder(61)).toEqual([8, 4, 2]);
    expect(ladder(100)).toEqual([12, 4, 2]);
    expect(ladder(121)).toEqual([16, 8, 4, 2]);
  });

  it('keeps the old ladder for rounds raced before it', () => {
    expect(ladder(25, V2 - 1)).toEqual([3]);
    expect(ladder(100, V2 - 1)).toEqual([10, 2]);
  });

  it('never lets a whole session through, and never overfills a grid', () => {
    for (let n = GRID_SIZE + 1; n <= 200; n++) {
      const sessions = planSessions(ids(n), V2);
      const rounds = new Map<number, typeof sessions>();
      for (const s of sessions) rounds.set(s.round, [...(rounds.get(s.round) ?? []), s]);
      let field = n;
      for (const [, group] of [...rounds].sort((a, b) => a[0] - b[0])) {
        const smallest = Math.floor(field / group.length);
        expect(Math.ceil(field / group.length), `n=${n}`).toBeLessThanOrEqual(GRID_SIZE);
        if (group[0].kind === 'heat') {
          expect(group[0].advance, `n=${n}`).toBeLessThanOrEqual(smallest - 2);
          field = group.length * group[0].advance;
        }
      }
    }
  });

  it('names a round by how many races it has', () => {
    const names = (n: number) => planSessions(ids(n), V2).filter((s) => s.kind === 'heat').map((s) => s.name.replace(/ \d+$/, ''));
    expect(new Set(names(15))).toEqual(new Set(['חצי גמר']));
    expect(new Set(names(25))).toEqual(new Set(['מקצה']));
    expect(new Set(names(35))).toEqual(new Set(['רבע גמר', 'חצי גמר']));
    expect(new Set(names(70))).toEqual(new Set(['שמינית גמר', 'רבע גמר', 'חצי גמר']));
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

describe('shop celebrations', () => {
  const doc = (purchases: string[]) => ({ purchases, equipped: { celebration: 'celebrate-confetti' }, updatedAt: 0 });

  it('a bought celebration goes on the car', () => {
    expect(validLook(doc(['celebrate-confetti']), 1000)?.look.celebration).toBe('confetti');
  });

  it('one that was not paid for, or not afforded, draws nothing', () => {
    expect(validLook(doc([]), 1000)).toBeNull();
    expect(validLook(doc(['celebrate-confetti']), 10)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { SETUPS, isSetupId, setupOf, DEFAULT_SETUP } from '../games/racing/setup';
import { ratingsBefore, BASE_RATING } from './ratings';
import { betBook, bettableRound, onLadder, raceOdds, seasonOdds, settleBet, titleDecided, validBet, MIN_STAKE, type Bet } from './bets';
import { setupsFor } from './sim';
import { POINTS } from './points';
import { raceIdForRound, seasonForRound, seasonRange, startsAtForRound, SETUP_ROUND } from './schedule';
import { settleWallets, type WalletStore } from '../../server/wallets';
import type { ArenaEntry, DayPlace, RaceCard, RaceResult } from './types';

// Season 5: car setups, hidden ratings, odds and bets.

const FIRST = seasonRange(5).first;
const LAST = seasonRange(5).last;
const HOUR = 60 * 60 * 1000;

/** Driver id -> team uid. "a" and "a2" share a team. */
const TEAM: Record<string, string> = { a: 'ua', a2: 'ua', b: 'ub', c: 'uc', d: 'ud' };

function entry(id: string, setup?: string): ArenaEntry {
  return {
    id,
    uid: TEAM[id] ?? `u-${id}`,
    driver: id,
    team: TEAM[id] ?? id,
    gameId: 'racing',
    algorithm: 'ga',
    arch: { obsSize: 4, hidden: [8], nActions: 9 },
    obsVersion: 1,
    tag: id.toUpperCase(),
    createdAt: 0,
    updatedAt: 0,
    modelId: id,
    episodes: 1,
    ...(setup ? { setup } : {}),
  };
}

function card(round: number, ids: string[]): RaceCard {
  return {
    id: raceIdForRound(round),
    seasonId: seasonForRound(round),
    round,
    name: `race ${round}`,
    trackId: 'oval',
    laps: 10,
    seed: round,
    startsAt: startsAtForRound(round),
    entries: ids.map((id) => entry(id)),
    qualifying: [],
    createdAt: 0,
  };
}

function result(c: RaceCard, order: string[]): RaceResult {
  const places: DayPlace[] = order.map((entryId, i) => ({
    entryId,
    position: i + 1,
    points: POINTS[i] ?? 0,
    eliminatedIn: null,
    status: 'finished',
    classified: true,
  }));
  return { raceId: c.id, seasonId: c.seasonId, computedAt: 0, sessions: [], places, pole: null, fastestLap: null };
}

/** `n` race days from the first of season 5, every one won in `order`. */
function season(n: number, ids: string[], order = ids) {
  const cards = Array.from({ length: n }, (_, i) => card(FIRST + i, ids));
  const results = new Map(cards.map((c) => [c.id, result(c, order)]));
  return { cards, results };
}

function bet(over: Partial<Bet> & { round: number }): Bet {
  return {
    id: 'x',
    kind: 'race',
    market: 'driver',
    pick: 'a',
    stake: 20,
    raceId: raceIdForRound(over.round),
    seasonId: seasonForRound(over.round),
    placedAt: startsAtForRound(over.round) - 60_000,
    ...over,
  };
}

const priceOf = (runners: { id: string; odds: number }[], id: string) => runners.find((r) => r.id === id)!.odds;

describe('car setup', () => {
  it('has a balanced car of exactly 1 on every factor', () => {
    const b = setupOf(DEFAULT_SETUP);
    expect([b.topSpeed, b.accel, b.grip, b.brake]).toEqual([1, 1, 1, 1]);
  });

  it('is a trade-off: every other setup gains somewhere and pays somewhere', () => {
    for (const s of SETUPS.filter((x) => x.id !== DEFAULT_SETUP)) {
      const f = [s.topSpeed, s.accel, s.grip, s.brake];
      expect(f.some((v) => v > 1)).toBe(true);
      expect(f.some((v) => v < 1)).toBe(true);
    }
  });

  it('treats anything unknown as balanced', () => {
    expect(isSetupId('downforce')).toBe(true);
    expect(isSetupId('rocket')).toBe(false);
    expect(setupOf(undefined).id).toBe(DEFAULT_SETUP);
    expect(setupOf(42).id).toBe(DEFAULT_SETUP);
  });

  it('reaches a race only from SETUP_ROUND, and only for cars that chose one', () => {
    const field = [entry('a', 'lowdrag'), entry('b')];
    expect(setupsFor(SETUP_ROUND - 1, field).size).toBe(0);
    const on = setupsFor(SETUP_ROUND, field);
    expect(on.get('a')).toBe('lowdrag');
    expect(on.has('b')).toBe(false);
  });
});

describe('hidden ratings', () => {
  it('start everybody at the base rating', () => {
    const r = ratingsBefore([], new Map());
    expect(r.races).toBe(0);
    expect(r.drivers.get('a') ?? BASE_RATING).toBe(BASE_RATING);
  });

  it('move the winner up most and the last car down', () => {
    const { cards, results } = season(1, ['a', 'b', 'c', 'd']);
    const r = ratingsBefore(cards, results);
    const [ra, rb, rd] = ['a', 'b', 'd'].map((id) => r.drivers.get(id)!);
    expect(ra).toBeGreaterThan(rb);
    expect(ra).toBeGreaterThan(BASE_RATING);
    expect(rd).toBeLessThan(BASE_RATING);
  });

  it('score a team on its best car of the day', () => {
    const { cards, results } = season(1, ['a', 'b', 'a2', 'c'], ['a', 'b', 'a2', 'c']);
    const r = ratingsBefore(cards, results);
    expect(r.teams.get('ua')!).toBeGreaterThan(r.teams.get('ub')!);
    expect(r.teams.size).toBe(3);
  });

  it('ignore a race without a settled result', () => {
    const { cards, results } = season(3, ['a', 'b']);
    results.delete(cards[2].id);
    expect(ratingsBefore(cards, results).races).toBe(2);
  });

  it('carry over from one season to the next', () => {
    const { cards, results } = season(3, ['a', 'b']);
    const next = card(seasonRange(6).first, ['a', 'b']);
    const r = ratingsBefore([...cards, next], results, next.round);
    expect(r.races).toBe(3);
    expect(r.drivers.get('a')!).toBeGreaterThan(BASE_RATING);
  });
});

describe('race odds', () => {
  it('price equal cars equally, with the house margin', () => {
    const field = ['a', 'b', 'c', 'd'].map((id) => entry(id));
    const runners = raceOdds('driver', field, ratingsBefore([], new Map()));
    expect(new Set(runners.map((r) => r.odds)).size).toBe(1);
    expect(runners[0].odds).toBe(3.6); // 0.9 / 0.25
    expect(runners.reduce((s, r) => s + r.p, 0)).toBeCloseTo(1, 9);
  });

  it('put the favourite first and pay it least', () => {
    const { cards, results } = season(4, ['a', 'b', 'c']);
    const runners = raceOdds('driver', cards[0].entries, ratingsBefore(cards, results));
    expect(runners.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(runners[0].odds).toBeLessThan(runners[2].odds);
    expect(runners.every((r) => r.odds >= 1.01 && r.odds <= 50)).toBe(true);
    // The book is never in the bettors' favour.
    expect(runners.reduce((s, r) => s + 1 / r.odds, 0)).toBeGreaterThanOrEqual(1);
  });

  it('list one runner per team in the team market', () => {
    const field = ['a', 'a2', 'b', 'c'].map((id) => entry(id));
    const runners = raceOdds('team', field, ratingsBefore([], new Map()));
    expect(runners.map((r) => r.id).sort()).toEqual(['ua', 'ub', 'uc']);
  });
});

describe('season odds', () => {
  it('pay at least the race price in the first half of the season', () => {
    for (const done of [0, 1, 2]) {
      const { cards, results } = season(done + 1, ['a', 'b', 'c', 'd']);
      const round = FIRST + done;
      for (const market of ['driver', 'team'] as const) {
        const title = seasonOdds(market, round, cards, results);
        const race = raceOdds(market, cards[done].entries, ratingsBefore(cards, results, round));
        for (const r of race) expect(priceOf(title, r.id)).toBeGreaterThanOrEqual(r.odds);
      }
    }
  });

  it('pay the leader less the further the season goes', () => {
    const ids = ['a', 'b', 'c'];
    const early = season(1, ids);
    const late = season(LAST - FIRST, ids);
    const before = priceOf(seasonOdds('driver', FIRST, early.cards, new Map(), early.cards[0].entries), 'a');
    const after = priceOf(seasonOdds('driver', LAST, late.cards, late.results, late.cards[0].entries), 'a');
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(1.1);
  });

  it('list the runners by what they pay, after the race floor', () => {
    const { cards, results } = season(2, ['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd']);
    for (const market of ['driver', 'team'] as const) {
      const odds = seasonOdds(market, FIRST + 1, cards, results).map((r) => r.odds);
      expect(odds).toEqual([...odds].sort((x, y) => x - y));
    }
  });

  it('are the same every time they are asked', () => {
    const { cards, results } = season(3, ['a', 'b', 'c']);
    const once = JSON.stringify(seasonOdds('driver', FIRST + 3, cards, results, cards[0].entries));
    expect(JSON.stringify(seasonOdds('driver', FIRST + 3, cards, results, cards[0].entries))).toBe(once);
  });
});

describe('odds ladder', () => {
  it('rounds down to the steps an exchange quotes', () => {
    expect([1.009, 1.016, 1.999, 2.05, 3.62, 5.97, 9.7, 18.9, 21.9, 31.3, 39.8, 77].map(onLadder)).toEqual([
      1, 1.01, 1.99, 2.04, 3.6, 5.9, 9.6, 18.5, 21, 30, 38, 75,
    ]);
  });
});

describe('a title already won', () => {
  // Eight rounds a season: after six, "a" leads "b" by 6 x 7 = 42 and two days can bring 52.
  it('is open while the rest could still catch up', () => {
    const { cards, results } = season(6, ['a', 'b', 'c']);
    expect(titleDecided('driver', FIRST + 6, cards, results)).toBe(false);
  });

  it('closes once the leader is out of reach', () => {
    // "a" wins all six and b, c, d take turns behind: 90 each against 150, two days left worth 52.
    const ids = ['a', 'b', 'c', 'd'];
    const cards = Array.from({ length: 6 }, (_, i) => card(FIRST + i, ids));
    const rest = ['b', 'c', 'd'];
    const results = new Map(cards.map((c, i) => [c.id, result(c, ['a', ...rest.slice(i % 3), ...rest.slice(0, i % 3)])]));
    expect(titleDecided('driver', FIRST + 6, cards, results)).toBe(true);
    expect(titleDecided('driver', FIRST + 5, cards, results)).toBe(false);
  });

  it('is never decided on a tie with what is left', () => {
    // a 25 per day, b 18 per day: after 7 days the lead is 49, one day left is worth 26.
    const { cards, results } = season(7, ['a', 'b']);
    expect(titleDecided('driver', FIRST + 7, cards, results)).toBe(true);
    // Rounds before any result: never decided.
    expect(titleDecided('driver', FIRST, cards, results)).toBe(false);
  });

  it('counts a one-two for a team', () => {
    // ua takes 25+18 a day against 15 for ub: after 6 days 258 against 90, two days left worth 88.
    const { cards, results } = season(6, ['a', 'a2', 'b']);
    expect(titleDecided('team', FIRST + 6, cards, results)).toBe(true);
    // After 2 days 86 against 30: 6 days left can bring 264.
    expect(titleDecided('team', FIRST + 2, cards, results)).toBe(false);
  });

  it('returns the coins of a bet placed on it', () => {
    const { cards, results } = season(7, ['a', 'b']);
    const late = bet({ round: FIRST + 7, kind: 'season' });
    expect(settleBet(late, cards, results, startsAtForRound(LAST) + 4 * 3600_000)).toMatchObject({ status: 'void', reason: 'closed', payout: 20 });
  });
});

describe('bets', () => {
  const { cards, results } = season(4, ['a', 'b', 'c']);
  const R = FIRST + 3;
  const after = startsAtForRound(FIRST + 6);
  const odds = priceOf(raceOdds('driver', cards[3].entries, ratingsBefore(cards, results, R)), 'a');

  it('have a minimum stake and no maximum', () => {
    expect(validBet(bet({ round: R, stake: MIN_STAKE }))).toBe(true);
    expect(validBet(bet({ round: R, stake: MIN_STAKE - 1 }))).toBe(false);
    expect(validBet(bet({ round: R, stake: 10.5 }))).toBe(false);
    expect(validBet(bet({ round: R, stake: 1_000_000 }))).toBe(true);
  });

  it('pay the stake times the odds on a win and nothing on a loss', () => {
    const won = settleBet(bet({ round: R }), cards, results, after);
    expect(won).toMatchObject({ status: 'won', payout: Math.floor(20 * odds) });
    expect(settleBet(bet({ round: R, pick: 'b' }), cards, results, after)).toMatchObject({ status: 'lost', payout: 0 });
  });

  it('pay a team bet when any car of the team wins', () => {
    expect(settleBet(bet({ round: R, market: 'team', pick: 'ua' }), cards, results, after).status).toBe('won');
  });

  it('return the stake when the race never happens', () => {
    const r = FIRST + 5;
    const s = settleBet(bet({ round: r }), cards, results, startsAtForRound(r) + 4 * HOUR);
    expect(s).toMatchObject({ status: 'void', payout: 20, reason: 'norace' });
  });

  it('void a bet placed after the lights', () => {
    expect(settleBet(bet({ round: R, placedAt: startsAtForRound(R) }), cards, results, after).status).toBe('void');
  });

  it('settle a season bet only when the season is over', () => {
    const sb = bet({ round: FIRST + 1, kind: 'season' });
    expect(settleBet(sb, cards, results, after).status).toBe('open');
    expect(settleBet(sb, cards, results, startsAtForRound(LAST) + 4 * HOUR).status).toBe('won');
  });
});

describe('bet book', () => {
  const { cards, results } = season(4, ['a', 'b', 'c']);
  const R = FIRST + 2;
  const after = startsAtForRound(FIRST + 6);

  it('lets a team go all in, and voids what it cannot afford', () => {
    const book = betBook([bet({ id: '1', round: R, stake: 40 }), bet({ id: '2', round: R, stake: 1, pick: 'b' })], 40, cards, results, after);
    expect(book.rows.find((x) => x.bet.id === '1')!.s.status).toBe('won');
    expect(book.rows.find((x) => x.bet.id === '2')!.s.reason).toBe('funds');
  });

  it('frees winnings only for bets placed after the race that paid them', () => {
    const win = bet({ id: '1', round: R, stake: 40 });
    const tooSoon = bet({ id: '2', round: R + 1, stake: 30, placedAt: startsAtForRound(R) - 1000 });
    const later = bet({ id: '3', round: R + 1, stake: 30, placedAt: startsAtForRound(R) + 1000 });
    expect(betBook([win, tooSoon], 40, cards, results, after).rows.find((x) => x.bet.id === '2')!.s.reason).toBe('funds');
    expect(betBook([win, later], 40, cards, results, after).rows.find((x) => x.bet.id === '3')!.s.reason).toBeUndefined();
  });

  it('counts open stakes in net but not in what is published', () => {
    const open = bet({ id: '1', round: FIRST + 5, stake: 25 });
    const book = betBook([open], 100, cards, results, startsAtForRound(FIRST + 5) - 1);
    expect(book).toMatchObject({ net: -25, settledNet: 0, atStake: 25 });
  });
});

describe('wallet settlement on the server', () => {
  it('publishes one number per team: its settled bet net', async () => {
    const { cards, results } = season(4, ['a', 'b', 'c']);
    const now = startsAtForRound(FIRST + 6);
    const written = new Map<string, number>();
    const store: WalletStore = {
      allCards: async () => cards,
      allResults: async () => results,
      allBets: async () => [
        { uid: 'ua', bet: bet({ id: '1', round: FIRST + 2, stake: 10 }) },
        { uid: 'ub', bet: bet({ id: '2', round: FIRST + 2, stake: 10, pick: 'a' }) },
      ],
      shop: async () => undefined,
      putWallet: async (uid, net) => void written.set(uid, net),
    };
    expect(await settleWallets(store, now)).toBe(2);
    expect(written.get('ua')!).toBeGreaterThan(0);
    // Team b's bet won too, on another team's car.
    expect(written.get('ub')!).toBe(written.get('ua')!);
    // Running it again writes the same numbers.
    const first = [...written];
    await settleWallets(store, now);
    expect([...written]).toEqual(first);
  });
});

describe('bettable round', () => {
  it('is always a race whose lights are still to come', () => {
    for (const t of [startsAtForRound(FIRST) - 1, startsAtForRound(FIRST), startsAtForRound(FIRST + 3) + HOUR]) {
      const r = bettableRound(t);
      expect(startsAtForRound(r)).toBeGreaterThan(t);
      expect(startsAtForRound(r - 1)).toBeLessThanOrEqual(t);
    }
  });
});

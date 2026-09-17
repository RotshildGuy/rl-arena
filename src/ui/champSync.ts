import { buildRaceCard } from '../core/champ/card';
import { eligibleEntries } from '../core/champ/card';
import { MIN_ENTRIES } from '../core/champ/format';
import { currentRound, raceIdForRound, roundsToBackfill, startsAtForRound } from '../core/champ/schedule';
import { runRaceDay } from '../core/champ/sim';
import type { ArenaEntry, RaceCard, RaceResult } from '../core/champ/types';
import { getArena, type ArenaStore } from '../storage/arena';
import { getChampCache } from '../storage/champCache';
import type { FromChamp, ToChamp, WeightPairs } from '../workers/champProtocol';

/**
 * Runs the championship forward.
 *
 * There is no server here. Whoever opens the app does the work: any round whose
 * lights have gone out but that nobody has simulated yet gets built, raced and
 * written back, create-only, so the first record to land is the record. That
 * makes the daily race happen without anything running between visits.
 */

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<string, { resolve: (v: never) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/champ.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<FromChamp>) => {
      const msg = ev.data;
      const p = pending.get(msg.tag);
      if (!p) return;
      pending.delete(msg.tag);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else if (msg.type === 'card') (p.resolve as (v: RaceCard) => void)(msg.card);
      else (p.resolve as (v: RaceResult) => void)(msg.result);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('חישוב המרוץ נכשל'));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** `Omit` over a union has to distribute, or it collapses to the shared fields. */
type Untagged<T> = T extends unknown ? Omit<T, 'tag'> : never;

function ask<T>(msg: Untagged<ToChamp>): Promise<T> {
  const w = ensureWorker();
  const tag = `c${seq++}`;
  if (!w) return Promise.reject(new Error('no worker'));
  return new Promise<T>((resolve, reject) => {
    pending.set(tag, { resolve: resolve as never, reject });
    w.postMessage({ ...msg, tag } as ToChamp);
    // A day that cannot be simulated in a minute is a day something is wrong.
    setTimeout(() => {
      if (pending.delete(tag)) reject(new Error('חישוב המרוץ לקח יותר מדי זמן'));
    }, 60_000);
  });
}

async function buildCard(round: number, entries: ArenaEntry[], weights: WeightPairs): Promise<RaceCard> {
  try {
    return await ask<RaceCard>({ type: 'buildCard', round, entries, weights });
  } catch {
    // Workers are unavailable in a few embedded browsers; the main thread can
    // still do it, it just stutters.
    return buildRaceCard(round, entries, new Map(weights));
  }
}

async function runDay(card: RaceCard, weights: WeightPairs): Promise<RaceResult> {
  try {
    return await ask<RaceResult>({ type: 'runDay', card, weights });
  } catch {
    return runRaceDay(card, new Map(weights));
  }
}

export interface ChampionshipState {
  entries: ArenaEntry[];
  cards: RaceCard[];
  results: Map<string, RaceResult>;
  /** Non-null while a round is being simulated, for the progress line. */
  busy: string | null;
  kind: 'local' | 'cloud';
  uid: string;
}

export type SyncProgress = (note: string | null) => void;

async function weightsForEntries(arena: ArenaStore, entries: ArenaEntry[]): Promise<WeightPairs> {
  const pairs = await Promise.all(
    entries.map(async (e) => [e.id, await arena.loadEntryWeights(e.id)] as [string, string | null]),
  );
  return pairs.filter((p): p is [string, string] => p[1] !== null);
}

/**
 * Bring the championship up to date and return everything the screens need.
 *
 * Missing rounds are processed oldest first so the standings build in the order
 * they were raced.
 */
export async function syncChampionship(onProgress: SyncProgress = () => {}): Promise<ChampionshipState> {
  const arena = await getArena();
  const [entries, uid] = await Promise.all([arena.listEntries(), arena.uid()]);
  const cache = getChampCache(arena.kind);

  const cards = new Map<string, RaceCard>();
  const results = new Map<string, RaceResult>();

  // Walk the calendar rather than listing the collection. Race ids are derived
  // from the round number, so the app already knows every document that could
  // exist and can ask only about the ones it has not seen — which is what keeps
  // a visit costing the same on day 400 as on day 4.
  const lastRound = currentRound();
  const runnable = new Set(roundsToBackfill());

  for (let round = 1; round <= lastRound; round++) {
    const raceId = raceIdForRound(round);
    try {
      let card = await cache.getCard(raceId);
      if (!card && !(await cache.isBlank(raceId))) {
        card = await arena.getCard(raceId);
        if (card) await cache.putCard(card);
      }

      if (!card && runnable.has(round)) {
        const field = eligibleEntries(entries, round);
        if (field.length >= MIN_ENTRIES) {
          onProgress(`מריץ מוקדמות לסבב ${round}…`);
          const weights = await weightsForEntries(arena, field);
          if (weights.length >= MIN_ENTRIES) {
            card = await arena.putCard(await buildCard(round, entries, weights), new Map(weights));
            await cache.putCard(card);
          }
        }
      }

      if (!card) {
        // Outside the backfill window a missing round can never appear, so the
        // absence is worth remembering; inside it, keep checking.
        if (!runnable.has(round)) await cache.markBlank(raceId);
        continue;
      }
      cards.set(raceId, card);

      let result = await cache.getResult(raceId);
      if (!result) {
        result = await arena.getResult(raceId);
        if (result) await cache.putResult(result);
      }

      if (!result && runnable.has(round)) {
        onProgress(`מריץ את ${card.name}…`);
        const weights = await arena.loadRaceWeights(raceId);
        if (weights.size >= MIN_ENTRIES) {
          result = await arena.putResult(await runDay(card, [...weights.entries()]));
          await cache.putResult(result);
        }
      }

      if (result) results.set(raceId, result);
    } catch {
      // One round that cannot be built or written must not take the season with
      // it: everything already raced still shows, and the next visit retries.
    }
  }

  onProgress(null);
  return {
    entries,
    cards: [...cards.values()].sort((a, b) => a.round - b.round),
    results,
    busy: null,
    kind: arena.kind,
    uid,
  };
}

/** Whether the next race is close enough to show a countdown rather than a date. */
export function msUntilNextRace(now = Date.now()): number {
  return startsAtForRound(currentRound(now) + 1) - now;
}

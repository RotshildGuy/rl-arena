import { useCallback, useEffect, useState } from 'react';
import { airingRound, currentRound } from '../core/champ/schedule';
import { syncChampionship, type ChampionshipState } from './champSync';

/**
 * Championship data, fetched once per session and shared by every screen.
 *
 * Bringing the season up to date can mean simulating several race days, so
 * re-running it on every tab switch would make the app feel broken. The cache is
 * module-level and invalidated explicitly: entering a model, or the clock
 * passing the next lights-out.
 */
let cache: ChampionshipState | null = null;
let inflight: Promise<ChampionshipState> | null = null;
let note: string | null = null;
/** Which round the cache was built for, so a race starting invalidates it. */
let cacheRound = -1;
/** And which round was on air, so the feed opening invalidates it too. */
let cacheAiring = -1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function invalidateChampionship(): void {
  cache = null;
  inflight = null;
  emit();
}

function load(): Promise<ChampionshipState> {
  // `inflight` is kept after it resolves so concurrent callers share one sync;
  // `cache` is what says the data is ready.
  if (inflight && !cache) return inflight;
  if (cache) return Promise.resolve(cache);
  return refresh();
}

/**
 * Re-sync without taking down what is on screen.
 *
 * The two moments the season is guaranteed to be stale — the feed opening and
 * the lights going out — are also the two moments somebody is most likely to be
 * watching. Clearing the cache first would replace their broadcast with "no
 * race to show" for as long as the simulation takes, so the old state stays up
 * until the new one is ready to take its place.
 */
function refresh(): Promise<ChampionshipState> {
  cacheRound = currentRound();
  cacheAiring = airingRound();
  inflight = syncChampionship((n) => {
    note = n;
    emit();
  })
    .then((s) => {
      cache = s;
      note = null;
      emit();
      return s;
    })
    .catch((e) => {
      inflight = null;
      note = null;
      emit();
      throw e;
    });
  return inflight;
}

export interface ChampionshipView {
  state: ChampionshipState | null;
  progress: string | null;
  error: string | null;
  reload(): void;
}

export function useChampionship(): ChampionshipView {
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (!cache) void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const reload = useCallback(() => {
    invalidateChampionship();
    setError(null);
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * The two moments a cached season is guaranteed to be wrong. A minute before
   * the lights the card of the round about to start has to be built, or there
   * is nothing for the feed to open on; and when the lights go out the race
   * itself needs running. Without this, a tab left open through 20:00 would
   * quietly miss the race it was waiting for.
   */
  useEffect(() => {
    const id = setInterval(() => {
      if (cache && (currentRound() > cacheRound || airingRound() > cacheAiring)) {
        void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  return { state: cache, progress: note, error, reload };
}

/** A clock that re-renders once a second — countdowns and live windows need it. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

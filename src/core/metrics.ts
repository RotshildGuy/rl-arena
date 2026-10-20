/**
 * Retention, from nothing but "this account did this thing on this day".
 *
 * An event carries no detail: no screen size, no referrer, no time of day, no
 * model name. It is the pseudonymous uid the account already has, one of a
 * handful of event names, and a UTC day. That is enough to answer the only
 * questions that matter right now - do people come back, and how many of the
 * people who visit get as far as putting a car on the grid - and too little to
 * say anything else about anybody.
 *
 * Pure and deterministic so it can be checked in `npm run sanity`.
 */
export const METRIC_EVENTS = ['visit', 'train', 'save', 'enter', 'watch'] as const;
export type MetricEvent = (typeof METRIC_EVENTS)[number];

export interface MetricRow {
  uid: string;
  event: MetricEvent;
  /** `YYYY-MM-DD`, UTC - the same clock the race calendar runs on. */
  day: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

export interface RetentionPoint {
  /** Days after the first visit. */
  day: number;
  /** Accounts old enough to have had the chance. */
  cohort: number;
  /** Of those, how many were back on that day or any day after it. */
  returned: number;
}

export interface MetricsSummary {
  /** Accounts seen at all. */
  accounts: number;
  retention: RetentionPoint[];
  /** Accounts that reached each event, at any point. */
  funnel: Record<MetricEvent, number>;
}

/**
 * Day-N retention the forgiving way: someone counts as retained on day 7 if
 * they were back on day 7 *or later*. Exact-day retention punishes anybody
 * who races on Thursdays only, and for a game with one race a day "did they
 * keep coming back" is the honest question.
 *
 * An account only joins a cohort once `today` is far enough past its first
 * visit - a person who arrived yesterday has not had a chance to come back a
 * week later, and counting them as lost would make every week look worse.
 */
export function summarize(rows: MetricRow[], today: string, horizons = [1, 7, 30]): MetricsSummary {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const funnel = Object.fromEntries(METRIC_EVENTS.map((e) => [e, new Set<string>()])) as Record<
    MetricEvent,
    Set<string>
  >;

  for (const r of rows) {
    const d = dayIndex(r.day);
    if (!Number.isFinite(d)) continue;
    first.set(r.uid, Math.min(first.get(r.uid) ?? d, d));
    last.set(r.uid, Math.max(last.get(r.uid) ?? d, d));
    funnel[r.event]?.add(r.uid);
  }

  const now = dayIndex(today);
  const retention = horizons.map((h) => {
    let cohort = 0;
    let returned = 0;
    for (const [uid, f] of first) {
      if (now - f < h) continue;
      cohort++;
      if ((last.get(uid) ?? f) - f >= h) returned++;
    }
    return { day: h, cohort, returned };
  });

  return {
    accounts: first.size,
    retention,
    funnel: Object.fromEntries(METRIC_EVENTS.map((e) => [e, funnel[e].size])) as Record<MetricEvent, number>,
  };
}

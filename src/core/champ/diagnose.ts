import { RACING_REWARDS } from '../games/racing/rewards';
import type { Finish, RaceCard, RaceResult, SessionResult } from './types';

/**
 * Why a car lost, and which slider to move about it.
 *
 * The report says what happened. Learning from a defeat is the whole loop of
 * this game, and until now a team had to work out the "why" alone, from a lap
 * chart. These are a handful of plain rules over the telemetry every race
 * already records, each ending in one concrete thing to change - a named
 * slider and a direction, in the same words the training screen uses.
 *
 * Every car that did not win gets at least one piece of advice; when no rule
 * fires the last one, pace, always does. Pure, so it is checked in sanity.
 */
export type AdviceKind = 'unready' | 'walls' | 'speed' | 'contact' | 'pace';

export interface Advice {
  kind: AdviceKind;
  /** What was seen, with the numbers. */
  finding: string;
  /** What to do about it. */
  action: string;
  /** The slider to move, if the advice is a slider. */
  slider?: string;
  direction?: 'right' | 'left';
}

const label = (key: string) => RACING_REWARDS.find((c) => c.key === key)?.label ?? key;

/**
 * Wall contact per lap above which the wall can be the problem - and it has to
 * stand out from the field as well. In traffic every car brushes the walls a
 * few times a lap; advice that every car gets says nothing about any of them.
 */
const WALLS_PER_LAP = 0.5;
/** How far above the rest of the field's median a car has to be to be told. */
const STANDS_OUT = 1.3;
/** Top speed this far under the field's average is a car holding back. */
const SLOW_TOP_SPEED = 0.93;
/** Contact with other cars, per lap, that starts to cost places. */
const CONTACT_PER_LAP = 0.4;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The session that decided a car's day: where it was knocked out, or the last it ran. */
function decidingSession(result: RaceResult, entryId: string): { session: SessionResult; finish: Finish } | null {
  const place = result.places.find((p) => p.entryId === entryId);
  const order = place?.eliminatedIn
    ? result.sessions.filter((s) => s.sessionId === place.eliminatedIn)
    : [...result.sessions].reverse();
  for (const session of order) {
    const finish = session.classification.find((f) => f.entryId === entryId);
    if (finish) return { session, finish };
  }
  return null;
}

export function diagnoseCar(card: RaceCard, result: RaceResult, entryId: string): Advice[] {
  const decided = decidingSession(result, entryId);
  const place = result.places.find((p) => p.entryId === entryId);
  if (!decided || !place) return [];
  const { session, finish } = decided;
  const field = session.classification;
  const winnerLaps = Math.max(1, ...field.map((f) => f.laps));
  const laps = Math.max(1, finish.laps);
  const out: Advice[] = [];

  if (finish.laps < winnerLaps * 0.5) {
    out.push({
      kind: 'unready',
      finding: `השלים ${finish.laps} מתוך ${winnerLaps} הקפות`,
      action: `המודל לא מוכן למרוץ מלא. אמנו אותו על ${card.laps} הקפות, כדי שילמד להחזיק מרחק ולא רק הקפה אחת.`,
    });
  }

  const rest = field.filter((f) => f.entryId !== entryId && f.laps > 0);
  const perLap = (f: Finish, n: number) => n / Math.max(1, f.laps);
  const wallRate = finish.wallHits / laps;
  const fieldWalls = median(rest.map((f) => perLap(f, f.wallHits)));
  if (finish.wallHits >= 3 && wallRate >= WALLS_PER_LAP && wallRate > fieldWalls * STANDS_OUT) {
    out.push({
      kind: 'walls',
      finding: `${finish.wallHits} פגיעות בקיר ב-${finish.laps} הקפות, יותר מרוב המגרש`,
      action: `הזיזו ימינה את "${label('wallHit')}" - קנס חמור יותר על הקיר מלמד לבלום לפני הפנייה.`,
      slider: 'wallHit',
      direction: 'right',
    });
  }

  const others = field.filter((f) => f.entryId !== entryId && f.topSpeed > 0);
  const avgTop = others.length ? others.reduce((s, f) => s + f.topSpeed, 0) / others.length : 0;
  if (avgTop > 0 && finish.topSpeed > 0 && finish.topSpeed < avgTop * SLOW_TOP_SPEED) {
    out.push({
      kind: 'speed',
      finding: `מהירות שיא ${finish.topSpeed.toFixed(1)}, מול ממוצע ${avgTop.toFixed(1)} של השאר`,
      action: `הזיזו ימינה את "${label('speed')}" - הוא נוהג לאט מדי בישורות.`,
      slider: 'speed',
      direction: 'right',
    });
  }

  const lostPlaces = finish.gridPos > 0 ? finish.position - finish.gridPos : 0;
  const fieldContact = median(rest.map((f) => perLap(f, f.carHits)));
  const contactRate = finish.carHits / laps;
  if (finish.carHits >= 3 && contactRate >= CONTACT_PER_LAP && contactRate > fieldContact * STANDS_OUT && lostPlaces > 0) {
    out.push({
      kind: 'contact',
      finding: `${finish.carHits} מגעים עם רכבים, ו-${lostPlaces} מקומות שאבדו מהזינוק`,
      action: `הזיזו שמאלה את "${label('carHit')}" - המגעים עולים לו מקומות.`,
      slider: 'carHit',
      direction: 'left',
    });
  }

  if (out.length === 0 && place.position > 1) {
    const best = session.fastestLap?.ms ?? null;
    const gap = best !== null && finish.bestLapMs !== null ? (finish.bestLapMs - best) / best : null;
    out.push({
      kind: 'pace',
      finding:
        gap === null
          ? 'לא השלים הקפה נקייה'
          : gap <= 0.005
            ? 'קצב הקפה בין המהירים במרוץ'
            : `ההקפה המהירה שלו איטית ב-${(gap * 100).toFixed(1)}% מהמהירה במרוץ`,
      action:
        gap !== null && gap <= 0.005
          ? 'הקצב קיים; המקום הלך בזינוק או בתנועה. אמנו עם יותר רכבים על המסלול כדי שילמד לעקוף.'
          : 'הוא נקי אבל איטי. המשיכו לאמן אותו על המסלול הזה - זמן אימון הוא מה שחסר כאן.',
    });
  }

  return out;
}

/** Advice for every car of the day, keyed by entry id. */
export function diagnoseDay(card: RaceCard, result: RaceResult): Map<string, Advice[]> {
  const out = new Map<string, Advice[]>();
  for (const p of result.places) out.set(p.entryId, diagnoseCar(card, result, p.entryId));
  return out;
}

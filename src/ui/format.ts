/**
 * Time formatting, motorsport conventions.
 *
 * Lap times are written `m:ss.mmm` once they pass a minute and `s.mmm` below it,
 * which is what a timing screen does; gaps always carry their sign so a column
 * of them reads as a ladder.
 */
export function lapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return '—';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = (total % 60000) / 1000;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

export function raceTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return '—';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = (total % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function gapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return '—';
  return '+' + lapTime(Math.abs(ms));
}

/** Short gap for a live tower, where three decimals are more noise than signal. */
export function shortGap(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—';
  if (ms >= 60000) return '+' + Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(1).padStart(4, '0');
  return '+' + (ms / 1000).toFixed(1);
}

/** Countdown to a moment, as `d ימים hh:mm:ss`. */
export function untilText(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const clock = `${hh}:${mm}:${ss}`;
  return days > 0 ? `${days} ימים ${clock}` : clock;
}

export function dateText(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function timeText(ms: number): string {
  return new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function dateTimeText(ms: number): string {
  return `${dateText(ms)} · ${timeText(ms)}`;
}

export function durationText(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} שע׳ ${m % 60} דק׳`;
  if (m > 0) return `${m}:${String(s % 60).padStart(2, '0')} דק׳`;
  return `${s} שנ׳`;
}

export function compactNumber(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

export function posClass(position: number, dnf = false): string {
  if (dnf) return 'pos dnf';
  if (position === 1) return 'pos p1';
  if (position === 2) return 'pos p2';
  if (position === 3) return 'pos p3';
  return 'pos';
}

/**
 * Which colour a lap time gets: purple for the fastest of the session, green for
 * a driver's own best, yellow otherwise — the same three colours every real
 * timing graphic uses, so nobody has to be told what they mean.
 */
export function lapClass(ms: number | null, sessionBest: number | null, personalBest: number | null): string {
  if (ms === null) return 't-dim';
  if (sessionBest !== null && ms <= sessionBest + 0.001) return 't-purple';
  if (personalBest !== null && ms <= personalBest + 0.001) return 't-green';
  return 't-yellow';
}

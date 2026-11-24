import { useMemo } from 'react';
import { getTrack } from '../../core/games/racing/tracks';
import { TRACK_CHARACTER } from '../../core/games/racing/setup';
import { trackRecords } from '../../core/champ/records';
import { seasonRange, seasonRotation, startsAtForRound, trackForRound } from '../../core/champ/schedule';
import type { RaceCard, RaceResult } from '../../core/champ/types';
import { settledResults } from '../../core/champ/timing';
import { useT } from '../../i18n';
import { driverName, teamName, trackName } from '../../i18n/names';
import { dateText, lapTime } from '../format';
import { isolated } from './Name';

/**
 * A season at a glance: its four circuits, when each one is raced, what kind
 * of circuit it is, the lap to beat there and who has won there before.
 *
 * Everything comes from what is already loaded - the calendar, the records
 * of finished race days and their results - and the character of a circuit
 * from the setup table (`TRACK_CHARACTER`), so a team can choose a setup for
 * the season it is about to race.
 */
export function SeasonPreview({
  season,
  cards,
  results,
  now,
}: {
  season: number;
  cards: RaceCard[];
  results: Map<string, RaceResult>;
  now: number;
}) {
  // Finished race days only: a record from a race still on air would spoil it.
  // Worked out again once a minute, not on every tick of the clock.
  const minute = Math.floor(now / 60_000);
  const settled = useMemo(() => settledResults(cards, results, minute * 60_000), [cards, results, minute]);
  const c = useT().championship;
  const tracks = seasonRotation(season);
  const { first, last } = seasonRange(season);

  const records = useMemo(() => new Map(trackRecords(cards, settled).map((r) => [r.trackId, r])), [cards, settled]);

  /** Wins on each circuit, by driver, over every season so far. */
  const winners = useMemo(() => {
    const out = new Map<string, Map<string, { name: string; team: string; wins: number }>>();
    for (const card of cards) {
      const res = settled.get(card.id);
      const win = res?.places.find((p) => p.position === 1 && p.classified);
      const e = win && card.entries.find((x) => x.id === win.entryId);
      if (!e) continue;
      const byDriver = out.get(card.trackId) ?? new Map();
      const row = byDriver.get(e.id) ?? { name: driverName(e), team: teamName(e.team), wins: 0 };
      row.wins++;
      byDriver.set(e.id, row);
      out.set(card.trackId, byDriver);
    }
    return out;
  }, [cards, settled]);

  return (
    <div className="card notched season-preview">
      <div className="head">
        <div className="eyebrow">{c.previewTitle(season)}</div>
      </div>
      <div className="small muted" style={{ marginBottom: 10 }}>
        {c.previewIntro}
      </div>
      <div className="season-preview-grid">
        {tracks.map((trackId) => {
          const rounds: number[] = [];
          for (let r = first; r <= last; r++) if (trackForRound(r) === trackId) rounds.push(r);
          const rec = records.get(trackId);
          const best = [...(winners.get(trackId)?.values() ?? [])].sort((a, b) => b.wins - a.wins)[0];
          const character = TRACK_CHARACTER[trackId] ?? 'balanced';
          return (
            <div className="preview-track" key={trackId}>
              <TrackOutline trackId={trackId} />
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong>{trackName(trackId)}</strong>
                  <span className={`pill small char-${character}`}>{c.character[character]}</span>
                </div>
                <div className="dim tiny">{rounds.map((r) => dateText(startsAtForRound(r))).join(' · ')}</div>
                <div className="tiny" style={{ marginTop: 4 }}>
                  {rec?.lap ? (
                    <>
                      {c.lapRecord} <span className="mono">{lapTime(rec.lap.ms)}</span> · {isolated(rec.lap.driver)}
                    </>
                  ) : (
                    <span className="dim">{c.noRecordYet}</span>
                  )}
                </div>
                <div className="tiny muted">
                  {best ? c.mostWins(isolated(best.name), best.wins) : c.noWinnerYet}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The circuit's centreline, small, as a line drawing. */
function TrackOutline({ trackId }: { trackId: string }) {
  const points = useMemo(() => {
    const t = getTrack(trackId);
    const n = t.center.length / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, t.center[i * 2]);
      maxX = Math.max(maxX, t.center[i * 2]);
      minY = Math.min(minY, t.center[i * 2 + 1]);
      maxY = Math.max(maxY, t.center[i * 2 + 1]);
    }
    const scale = 52 / Math.max(maxX - minX, maxY - minY);
    const ox = (60 - (maxX - minX) * scale) / 2;
    const oy = (60 - (maxY - minY) * scale) / 2;
    const step = Math.max(1, Math.floor(n / 80));
    const out: string[] = [];
    for (let i = 0; i < n; i += step) {
      out.push(`${(ox + (t.center[i * 2] - minX) * scale).toFixed(1)},${(oy + (t.center[i * 2 + 1] - minY) * scale).toFixed(1)}`);
    }
    return out.join(' ');
  }, [trackId]);
  return (
    <svg className="track-outline" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
      <polygon points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

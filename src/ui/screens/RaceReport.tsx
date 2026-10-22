import { useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { ScrollX } from '../components/ScrollX';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { DriverCell } from '../components/Livery';
import { findCopies } from '../../core/champ/copies';
import { Podium } from '../components/Podium';
import { useTeamPaint } from '../teamLooks';
import { teamLook } from '../../core/champ/livery';
import { PositionChart, type PositionLine } from '../components/PositionChart';
import { shadeFor, teamColor } from '../../core/champ/livery';
import { lapsFor } from '../../core/champ/format';
import { dayStatus, sessionWindows } from '../../core/champ/timing';
import { diagnoseDay } from '../../core/champ/diagnose';
import { AdviceLine } from '../components/AdviceLine';
import type { ArenaEntry, Finish, RaceCard, RaceResult, SessionResult } from '../../core/champ/types';
import { dateTimeText, gapTime, lapClass, lapTime, posClass, raceTime, speedText, untilText } from '../format';
import { t as words, useLang, useT } from '../../i18n';
import { driverOf, grandPrixTitle, teamName, teamOf, trackName } from '../../i18n/names';

export function RaceReport() {
  const r = useT().report;
  const { viewRaceId, go, openRace } = useApp();
  const { state, progress } = useChampionship();
  const now = useNow(1000);

  const card = state?.cards.find((c) => c.id === viewRaceId) ?? null;
  const result = card ? (state?.results.get(card.id) ?? null) : null;

  if (!state) return <PageSkeleton variant="race" note={progress} />;
  if (!card) {
    return (
      <div className="empty">
        {progress ?? r.notFound}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => go('championship')}>{r.backToChamp}</button>
        </div>
      </div>
    );
  }

  const status = dayStatus(card, result, now);

  /**
   * Only the sessions that have already taken the flag.
   *
   * A heat that is over is history and there is nothing left to spoil about it,
   * so it can be read while the next one is still to come. The day's fastest lap
   * is recomputed over those sessions alone, or the heats would give away what
   * the final is about to do.
   */
  const shown = useMemo(() => {
    if (!result) return null;
    const sessions = result.sessions.filter((s) => status.finished.has(s.sessionId));
    if (!sessions.length) return null;
    if (sessions.length === result.sessions.length) return result;
    let fastest = result.fastestLap;
    if (fastest && !sessions.some((s) => s.fastestLap?.entryId === fastest?.entryId && s.fastestLap?.ms === fastest?.ms)) {
      fastest = null;
      for (const s of sessions) {
        if (s.fastestLap && (fastest === null || s.fastestLap.ms < fastest.ms)) fastest = s.fastestLap;
      }
    }
    return { ...result, sessions, fastestLap: fastest };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, [...status.finished].join(',')]);

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">
            {r.round(card.round, trackName(card.trackId))}
          </div>
          <h1 className="display">{grandPrixTitle(card.trackId)}</h1>
          <div className="muted small">
            {dateTimeText(card.startsAt)} · {r.entrants(card.entries.length)}
          </div>
        </div>
        <div className="actions">
          <button className="cyan" onClick={() => openRace(card.id, 'broadcast')}>
            {r.watch}
          </button>
          <button className="ghost" onClick={() => go('championship')}>
            {r.back}
          </button>
        </div>
      </div>

      {status.phase !== 'done' && (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="row wrap">
            <span className={`pill ${status.phase === 'racing' ? 'live' : ''}`}>
              {status.phase === 'racing' ? (
                <>
                  <span className="blip" /> {r.onAir}
                </>
              ) : (
                r.between
              )}
            </span>
            <span>
              {status.phase === 'racing'
                ? r.stillRunning(status.current?.session.name ?? r.theSession)
                : status.next
                  ? r.startsIn(status.next.session.name, untilText(status.next.startsAt - now))
                  : r.notOver}
            </span>
            <div style={{ flex: 1 }} />
            <button className="primary" onClick={() => openRace(card.id, 'broadcast')}>
              {r.toBroadcast}
            </button>
          </div>
        </div>
      )}

      {!state.entries.some((e) => e.uid === state.uid && !e.retired) && (
        <div className="card notched try-banner" style={{ marginBottom: 14 }}>
          <div style={{ display: 'grid', gap: 2, flex: '1 1 220px' }}>
            <b>{r.tryTitle}</b>
            <span className="small muted">{r.tryBody}</span>
          </div>
          <button className="primary" onClick={() => go('library')}>
            {r.tryButton}
          </button>
        </div>
      )}

      {shown && <Report card={card} result={shown} />}

      {/* Only once the whole day is over: the advice reads the final places. */}
      {result && status.phase === 'done' && <Diagnosis card={card} result={result} uid={state.uid} />}

      <Qualifying card={card} />
    </>
  );
}

/**
 * "Copy of X" for a car that raced with exactly the weights another team
 * raced with first (`core/champ/copies.ts`), or undefined.
 */
function useCopyNote(card: RaceCard): (entryId: string) => string | undefined {
  const { state } = useChampionship();
  const copies = useMemo(() => findCopies(state?.cards ?? [card]), [state, card]);
  return (entryId) => {
    const c = copies.get(`${card.id}/${entryId}`);
    return c ? words().report.copyOf(c.driver, teamName(c.team)) : undefined;
  };
}

function Report({ card, result }: { card: RaceCard; result: RaceResult }) {
  const r = useT().report;
  const lang = useLang();
  const copyNote = useCopyNote(card);
  const entries = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const paint = useTeamPaint(card.entries.map((e) => e.uid));
  // Session names are in the reader's language, so they are worked out again when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const windows = useMemo(() => sessionWindows(card), [card, lang]);
  const [sessionId, setSessionId] = useState(result.sessions[result.sessions.length - 1]?.sessionId ?? '');
  const session = result.sessions.find((s) => s.sessionId === sessionId) ?? result.sessions[0];
  const plan = windows.find((w) => w.session.id === session?.sessionId)?.session;

  const colorOf = useMemo(() => {
    const seen = new Map<string, number>();
    const map = new Map<string, string>();
    for (const e of card.entries) {
      const n = seen.get(e.uid) ?? 0;
      seen.set(e.uid, n + 1);
      map.set(e.id, shadeFor(teamColor(e.team), n));
    }
    return map;
  }, [card]);

  if (!session) return null;

  const winner = session.classification[0];
  // The podium of the session on screen - the final by default, a heat when
  // one is picked - so a session still to come is never given away.
  const podium = session.classification.slice(0, 3).map((f) => {
    const e = entries.get(f.entryId);
    const bought = e ? paint.get(e.uid) : undefined;
    return {
      position: f.position,
      driver: driverOf(e) ?? '-',
      team: teamOf(e) ?? '-',
      color: bought?.color ?? colorOf.get(f.entryId) ?? '#888',
      look: { ...teamLook(e?.team ?? '', e?.driver ?? ''), ...bought?.look },
      detail: f.status === 'dnf' ? r.retired : f.position === 1 ? raceTime(f.totalMs) : gapText(timeGapMs(f, session.classification[0])),
    };
  });
  const mostOvertakes = [...session.classification].sort((a, b) => b.overtakes - a.overtakes)[0];
  const mostLed = [...session.classification].sort((a, b) => b.lapsLed - a.lapsLed)[0];
  // A car that retired was not clean, however few walls it touched first.
  const cleanest = session.classification
    .filter((f) => f.status !== 'dnf')
    .sort((a, b) => a.wallHits + a.carHits - (b.wallHits + b.carHits))[0];
  const fastestTop = [...session.classification].sort((a, b) => b.topSpeed - a.topSpeed)[0];
  const sessionBest = session.fastestLap?.ms ?? null;
  const laps = plan ? lapsFor(plan) : Math.max(...session.classification.map((f) => f.laps), 1);

  const lines: PositionLine[] = session.classification.map((f) => ({
    label: driverOf(entries.get(f.entryId)) ?? '-',
    color: colorOf.get(f.entryId) ?? '#888',
    positions: f.lapPositions,
    gridPos: f.gridPos || f.position,
    highlight: f.position === 1,
  }));

  return (
    <>
      <div className="card notched" style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {r.podium}{result.sessions.length > 1 ? ` · ${plan?.name ?? ''}` : ''}
        </div>
        <Podium places={podium} />
      </div>

      <div className="cols-4" style={{ marginBottom: 14 }}>
        <StatCard
          label={r.winner}
          value={driverOf(entries.get(winner.entryId)) ?? '-'}
          sub={teamOf(entries.get(winner.entryId))}
          accent
        />
        <StatCard
          label={r.pole}
          value={driverOf(entries.get(result.pole ?? '')) ?? '-'}
          sub={lapTime(card.qualifying[0]?.bestLapMs)}
        />
        <StatCard
          label={r.fastLap}
          value={lapTime(result.fastestLap?.ms)}
          sub={driverOf(entries.get(result.fastestLap?.entryId ?? ''))}
          purple
        />
        <StatCard
          label={r.overtakes}
          value={String(mostOvertakes?.overtakes ?? 0)}
          sub={driverOf(entries.get(mostOvertakes?.entryId ?? ''))}
        />
      </div>

      {result.sessions.length > 1 && (
        <div className="segmented" style={{ marginBottom: 12 }}>
          {result.sessions.map((s) => {
            const name = windows.find((w) => w.session.id === s.sessionId)?.session.name ?? s.sessionId;
            return (
              <button key={s.sessionId} className={s.sessionId === sessionId ? 'on' : ''} onClick={() => setSessionId(s.sessionId)}>
                {name}
              </button>
            );
          })}
        </div>
      )}

      <div className="card notched" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <ScrollX>
          <table className="timing pin-2">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#</th>
                <th>{r.driver}</th>
                <th className="num">{r.grid}</th>
                <th className="num">{r.laps}</th>
                <th className="num">{r.timeGap}</th>
                <th className="num">{r.fastLap}</th>
                <th className="num">{r.topSpeed}</th>
                <th className="num" title={r.overtakesTitle}>{r.overtakesCol}</th>
                <th className="num" title={r.hitsTitle}>{r.hitsCol}</th>
                <th className="num">{r.led}</th>
                <th className="num">{r.pts}</th>
              </tr>
            </thead>
            <tbody>
              {session.classification.map((f) => {
                const e = entries.get(f.entryId);
                const place = result.places.find((p) => p.entryId === f.entryId);
                const isFinalSession = session.sessionId === result.sessions[result.sessions.length - 1]?.sessionId;
                const delta = (f.gridPos || 0) - f.position;
                return (
                  <tr key={f.entryId}>
                    <td>
                      <span className={posClass(f.position, f.status === 'dnf')}>
                        {f.status === 'dnf' ? '-' : f.position}
                      </span>
                    </td>
                    <td>
                      <DriverCell
                        driver={driverOf(e) ?? '-'}
                        team={teamOf(e) ?? '-'}
                        tag={e?.tag}
                        color={colorOf.get(f.entryId)}
                        note={copyNote(f.entryId)}
                      />
                    </td>
                    <td className="mono num">
                      {f.gridPos || '-'}
                      {delta !== 0 && f.gridPos > 0 && (
                        <span className={delta > 0 ? 'delta-up' : 'delta-down'}> {delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>
                      )}
                    </td>
                    <td className="mono num">{f.laps}</td>
                    <td className="mono num">
                      {f.status === 'dnf' ? (
                        <span className="muted">{r.retired}</span>
                      ) : f.position === 1 ? (
                        raceTime(f.totalMs)
                      ) : (
                        gapText(timeGapMs(f, session.classification[0]))
                      )}
                    </td>
                    <td className={`mono num ${lapClass(f.bestLapMs, sessionBest, f.bestLapMs)}`}>
                      {lapTime(f.bestLapMs)}
                    </td>
                    <td className="mono num muted">{speedText(f.topSpeed)}</td>
                    <td className="mono num">{f.overtakes || '-'}</td>
                    <td className="mono num muted">{f.wallHits + f.carHits || '-'}</td>
                    <td className="mono num muted">{f.lapsLed || '-'}</td>
                    <td className="mono num" style={{ fontWeight: 800 }}>
                      {!isFinalSession || !place ? (
                        <span className="dim">-</span>
                      ) : place.classified ? (
                        place.points || <span className="dim">0</span>
                      ) : (
                        <span className="dim" title={r.ncTitle}>
                          NC
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollX>
      </div>

      <div className="small muted" style={{ margin: '-6px 0 14px' }}>
        {r.ncNote}
      </div>

      <div className="split" style={{ marginBottom: 14 }}>
        <div className="card notched">
          <div className="head">
            <div className="eyebrow">{r.chart}</div>
            <div className="fill" />
            <span className="dim tiny">{r.chartNote}</span>
          </div>
          <PositionChart lines={lines} laps={laps} />
        </div>

        <div className="card notched">
          <div className="head">
            <div className="eyebrow">{r.headlines}</div>
          </div>
          <Headline label={r.mostLed} who={entries.get(mostLed?.entryId ?? '')} value={r.lapsValue(mostLed?.lapsLed ?? 0)} />
          <Headline label={r.topSpeed} who={entries.get(fastestTop?.entryId ?? '')} value={speedText(fastestTop?.topSpeed ?? 0)} />
          <Headline
            label={r.cleanest}
            who={entries.get(cleanest?.entryId ?? '')}
            value={cleanest ? r.wallHits(cleanest.wallHits) : '-'}
          />
          <Headline
            label={r.dnfs}
            who={undefined}
            value={r.ofTotal(session.classification.filter((f) => f.status === 'dnf').length, session.classification.length)}
          />
        </div>
      </div>

      <LapTimes session={session} entries={entries} colorOf={colorOf} />
    </>
  );
}

/**
 * How far behind the winner a car was, always as time. For a car that finished
 * on the winner's lap this is the gap at the flag. A lapped car crossed the line
 * fewer times, so its own finish time is not comparable with the winner's;
 * instead it is measured at the last line both crossed - the car's final lap
 * against the winner's same lap.
 */
function timeGapMs(f: Finish, winner: Finish | undefined): number | null {
  if (!winner || f.laps === 0) return null;
  if (f.laps >= winner.laps) return f.gapMs;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return sum(f.lapTimesMs.slice(0, f.laps)) - sum(winner.lapTimesMs.slice(0, f.laps));
}

function gapText(ms: number | null): string {
  return ms === null ? '-' : gapTime(ms);
}

function Headline({ label, who, value }: { label: string; who?: ArenaEntry; value: string }) {
  return (
    <div className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tiny dim" style={{ letterSpacing: '0.08em' }}>
          {label}
        </div>
        <div style={{ fontWeight: 700 }}>{driverOf(who) ?? '-'}</div>
      </div>
      <span className="mono small">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  purple,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  purple?: boolean;
}) {
  return (
    <div className="card notched">
      <div className="tiny dim" style={{ letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="display"
        style={{
          fontSize: 20,
          color: accent ? 'var(--accent)' : purple ? 'var(--purple)' : 'var(--text)',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/** Lap-by-lap times, coloured the way a timing screen colours them. */
function LapTimes({
  session,
  entries,
  colorOf,
}: {
  session: SessionResult;
  entries: Map<string, ArenaEntry>;
  colorOf: Map<string, string>;
}) {
  const r = useT().report;
  const maxLaps = Math.max(0, ...session.classification.map((f) => f.lapTimesMs.length));
  if (maxLaps === 0) return null;
  const best = session.fastestLap?.ms ?? null;

  return (
    <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div className="eyebrow">{r.lapTimes}</div>
        <div className="row wrap small" style={{ marginTop: 6 }}>
          <span className="t-purple">{r.purple}</span>
          <span className="t-green">{r.green}</span>
          <span className="t-yellow">{r.yellow}</span>
        </div>
      </div>
      <ScrollX>
        <table className="timing pin-1">
          <thead>
            <tr>
              <th>{r.driver}</th>
              {Array.from({ length: maxLaps }, (_, i) => (
                <th key={i} className="num">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {session.classification.map((f: Finish) => {
              const e = entries.get(f.entryId);
              return (
                <tr key={f.entryId}>
                  <td>
                    <DriverCell
                      driver={driverOf(e) ?? '-'}
                      team={teamOf(e) ?? '-'}
                      tag={e?.tag}
                      color={colorOf.get(f.entryId)}
                    />
                  </td>
                  {Array.from({ length: maxLaps }, (_, i) => {
                    const ms = f.lapTimesMs[i] ?? null;
                    return (
                      <td key={i} className={`mono num ${lapClass(ms, best, f.bestLapMs)}`}>
                        {ms === null ? '-' : lapTime(ms)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}

/** Qualifying: the session that sets the grid, and the source of pole positions. */
function Qualifying({ card }: { card: RaceCard }) {
  const r = useT().report;
  const copyNote = useCopyNote(card);
  const entries = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const pole = card.qualifying.find((q) => q.bestLapMs !== null)?.bestLapMs ?? null;
  const bestSectors = [0, 1, 2].map((s) => {
    const times = card.qualifying.map((q) => q.sectorsMs[s]).filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  });

  return (
    <div className="card notched" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div className="eyebrow">{r.quali}</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {r.qualiNote}
        </div>
      </div>
      <ScrollX>
        <table className="timing pin-2">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th>{r.driver}</th>
              <th className="num">{r.time}</th>
              <th className="num">{r.gap}</th>
              <th className="num">{r.sector(1)}</th>
              <th className="num">{r.sector(2)}</th>
              <th className="num">{r.sector(3)}</th>
              <th className="num">{r.topSpeed}</th>
            </tr>
          </thead>
          <tbody>
            {card.qualifying.map((q, i) => {
              const e = entries.get(q.entryId);
              return (
                <tr key={q.entryId}>
                  <td>
                    <span className={posClass(i + 1, q.bestLapMs === null)}>{q.bestLapMs === null ? '-' : i + 1}</span>
                  </td>
                  <td>
                    <DriverCell driver={driverOf(e) ?? '-'} team={teamOf(e) ?? '-'} tag={e?.tag} note={copyNote(q.entryId)} />
                  </td>
                  <td className={`mono num ${i === 0 ? 't-purple' : ''}`}>{lapTime(q.bestLapMs)}</td>
                  <td className="mono num muted">
                    {q.bestLapMs === null || pole === null ? '-' : i === 0 ? '-' : gapTime(q.bestLapMs - pole)}
                  </td>
                  {[0, 1, 2].map((s) => (
                    <td key={s} className={`mono num ${lapClass(q.sectorsMs[s], bestSectors[s], q.sectorsMs[s])}`}>
                      {lapTime(q.sectorsMs[s])}
                    </td>
                  ))}
                  <td className="mono num muted">{speedText(q.topSpeed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>
    </div>
  );
}

/**
 * What went wrong, car by car, and which slider to move. The team's own cars
 * come first and open; everybody else's is one tap away, because reading why
 * a rival lost is half of working out how to beat them.
 */
function Diagnosis({ card, result, uid }: { card: RaceCard; result: RaceResult; uid: string }) {
  const r = useT().report;
  const lang = useLang();
  // The advice is written in the reader's language, so it is worked out again when that changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const advice = useMemo(() => diagnoseDay(card, result), [card, result, lang]);
  const entries = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const [showAll, setShowAll] = useState(false);
  const rows = result.places
    .filter((p) => (advice.get(p.entryId)?.length ?? 0) > 0)
    .sort((a, b) => Number(entries.get(b.entryId)?.uid === uid) - Number(entries.get(a.entryId)?.uid === uid) || a.position - b.position);
  const mine = rows.filter((p) => entries.get(p.entryId)?.uid === uid);
  const shown = showAll || mine.length === 0 ? rows : mine;
  if (rows.length === 0) return null;

  return (
    <div className="card notched" style={{ marginTop: 14 }}>
      <div className="head">
        <div className="eyebrow">{r.diagnosis}</div>
        <div className="fill" />
        {mine.length > 0 && rows.length > mine.length && (
          <button className="ghost small" onClick={() => setShowAll((v) => !v)}>
            {showAll ? r.onlyMine : r.allCars(rows.length)}
          </button>
        )}
      </div>
      {shown.map((p) => {
        const e = entries.get(p.entryId);
        return (
          <div key={p.entryId} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className={posClass(p.position, p.status === 'dnf')}>{p.position}</span>
              <DriverCell driver={driverOf(e) ?? '-'} team={teamOf(e) ?? '-'} tag={e?.tag} />
            </div>
            {advice.get(p.entryId)!.map((a, i) => (
              <AdviceLine key={i} advice={a} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

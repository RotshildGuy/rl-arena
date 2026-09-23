import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { DriverCell } from '../components/Livery';
import { PositionChart, type PositionLine } from '../components/PositionChart';
import { shadeFor, teamColor } from '../../core/champ/livery';
import { lapsFor } from '../../core/champ/format';
import { dayStatus, sessionWindows } from '../../core/champ/timing';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import type { ArenaEntry, Finish, RaceCard, RaceResult, SessionResult } from '../../core/champ/types';
import { dateTimeText, gapTime, lapClass, lapTime, posClass, raceTime, untilText } from '../format';

export function RaceReport() {
  const { viewRaceId, go, openRace } = useApp();
  const { state, progress } = useChampionship();
  const now = useNow(1000);

  const card = state?.cards.find((c) => c.id === viewRaceId) ?? null;
  const result = card ? (state?.results.get(card.id) ?? null) : null;

  if (!state || !card) {
    return (
      <div className="empty">
        {progress ?? 'לא נמצא מרוץ.'}
        <div style={{ marginTop: 14 }}>
          <button onClick={() => go('championship')}>חזרה לאליפות</button>
        </div>
      </div>
    );
  }

  const status = dayStatus(card, result, now);
  const track = TRACK_DEFS.find((t) => t.id === card.trackId);

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
            סבב {card.round} · {track?.name ?? card.trackId}
          </div>
          <h1 className="display">{card.name}</h1>
          <div className="muted small">
            {dateTimeText(card.startsAt)} · {card.entries.length} משתתפים
          </div>
        </div>
        <div className="actions">
          <button className="cyan" onClick={() => openRace(card.id, 'broadcast')}>
            צפייה בשידור
          </button>
          <button className="ghost" onClick={() => go('championship')}>
            חזרה
          </button>
        </div>
      </div>

      {status.phase !== 'done' && (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="row wrap">
            <span className={`pill ${status.phase === 'racing' ? 'live' : ''}`}>
              {status.phase === 'racing' ? (
                <>
                  <span className="blip" /> בשידור
                </>
              ) : (
                'בין מקצים'
              )}
            </span>
            <span>
              {status.phase === 'racing'
                ? `${status.current?.session.name ?? 'המקצה'} עוד רץ — התוצאות שלו ייחשפו כשיירד עליו הדגל.`
                : status.next
                  ? `${status.next.session.name} מתחיל בעוד ${untilText(status.next.startsAt - now)}.`
                  : 'היום עוד לא הסתיים.'}
            </span>
            <div style={{ flex: 1 }} />
            <button className="primary" onClick={() => openRace(card.id, 'broadcast')}>
              לשידור
            </button>
          </div>
        </div>
      )}

      {shown && <Report card={card} result={shown} />}

      <Qualifying card={card} />
    </>
  );
}

function Report({ card, result }: { card: RaceCard; result: RaceResult }) {
  const entries = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const windows = useMemo(() => sessionWindows(card), [card]);
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
  const mostOvertakes = [...session.classification].sort((a, b) => b.overtakes - a.overtakes)[0];
  const mostLed = [...session.classification].sort((a, b) => b.lapsLed - a.lapsLed)[0];
  const fastestTop = [...session.classification].sort((a, b) => b.topSpeed - a.topSpeed)[0];
  const sessionBest = session.fastestLap?.ms ?? null;
  const laps = plan ? lapsFor(plan) : Math.max(...session.classification.map((f) => f.laps), 1);

  const lines: PositionLine[] = session.classification.map((f) => ({
    label: entries.get(f.entryId)?.driver ?? '—',
    color: colorOf.get(f.entryId) ?? '#888',
    positions: f.lapPositions,
    gridPos: f.gridPos || f.position,
    highlight: f.position === 1,
  }));

  return (
    <>
      <div className="cols-4" style={{ marginBottom: 14 }}>
        <StatCard
          label="מנצח"
          value={entries.get(winner.entryId)?.driver ?? '—'}
          sub={entries.get(winner.entryId)?.team}
          accent
        />
        <StatCard
          label="עמדת זינוק ראשונה"
          value={entries.get(result.pole ?? '')?.driver ?? '—'}
          sub={lapTime(card.qualifying[0]?.bestLapMs)}
        />
        <StatCard
          label="הקפה מהירה"
          value={lapTime(result.fastestLap?.ms)}
          sub={entries.get(result.fastestLap?.entryId ?? '')?.driver}
          purple
        />
        <StatCard
          label="הכי הרבה עקיפות"
          value={String(mostOvertakes?.overtakes ?? 0)}
          sub={entries.get(mostOvertakes?.entryId ?? '')?.driver}
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
        <div className="scroll-x">
          <table className="timing pin-2">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#</th>
                <th>נהג</th>
                <th className="num">זינוק</th>
                <th className="num">הקפות</th>
                <th className="num">זמן / פער</th>
                <th className="num">הקפה מהירה</th>
                <th className="num">מהירות שיא</th>
                <th className="num">עקיפות</th>
                <th className="num">פגיעות</th>
                <th className="num">הובלה</th>
                <th className="num">נק׳</th>
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
                        {f.status === 'dnf' ? '—' : f.position}
                      </span>
                    </td>
                    <td>
                      <DriverCell
                        driver={e?.driver ?? '—'}
                        team={e?.team ?? '—'}
                        tag={e?.tag}
                        color={colorOf.get(f.entryId)}
                      />
                    </td>
                    <td className="mono num">
                      {f.gridPos || '—'}
                      {delta !== 0 && f.gridPos > 0 && (
                        <span className={delta > 0 ? 'delta-up' : 'delta-down'}> {delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>
                      )}
                    </td>
                    <td className="mono num">{f.laps}</td>
                    <td className="mono num">
                      {f.status === 'dnf' ? (
                        <span className="muted">פרש</span>
                      ) : f.position === 1 ? (
                        raceTime(f.totalMs)
                      ) : (
                        gapTime(f.gapMs)
                      )}
                    </td>
                    <td className={`mono num ${lapClass(f.bestLapMs, sessionBest, f.bestLapMs)}`}>
                      {lapTime(f.bestLapMs)}
                    </td>
                    <td className="mono num muted">{f.topSpeed.toFixed(1)}</td>
                    <td className="mono num">{f.overtakes || '—'}</td>
                    <td className="mono num muted">{f.wallHits + f.carHits || '—'}</td>
                    <td className="mono num muted">{f.lapsLed || '—'}</td>
                    <td className="mono num" style={{ fontWeight: 800 }}>
                      {!isFinalSession || !place ? (
                        <span className="dim">—</span>
                      ) : place.classified ? (
                        place.points || <span className="dim">0</span>
                      ) : (
                        <span className="dim" title="לא סווג — לא השלים מספיק מרחק">
                          NC
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="small muted" style={{ margin: '-6px 0 14px' }}>
        NC — לא סווג: רכב שלא השלים לפחות מחצית מהמרחק של המנצח אינו צובר נקודות.
      </div>

      <div className="split" style={{ marginBottom: 14 }}>
        <div className="card notched">
          <div className="head">
            <div className="eyebrow">גרף המרוץ</div>
            <div className="fill" />
            <span className="dim tiny">מיקום בסוף כל הקפה</span>
          </div>
          <PositionChart lines={lines} laps={laps} />
        </div>

        <div className="card notched">
          <div className="head">
            <div className="eyebrow">כותרות</div>
          </div>
          <Headline label="הוביל הכי הרבה הקפות" who={entries.get(mostLed?.entryId ?? '')} value={`${mostLed?.lapsLed ?? 0} הקפות`} />
          <Headline label="מהירות שיא" who={entries.get(fastestTop?.entryId ?? '')} value={(fastestTop?.topSpeed ?? 0).toFixed(1)} />
          <Headline
            label="הכי נקי"
            who={entries.get(
              [...session.classification].sort((a, b) => a.wallHits + a.carHits - (b.wallHits + b.carHits))[0]?.entryId ?? '',
            )}
            value={`${[...session.classification].sort((a, b) => a.wallHits + a.carHits - (b.wallHits + b.carHits))[0]?.wallHits ?? 0} פגיעות בקיר`}
          />
          <Headline
            label="פרישות"
            who={undefined}
            value={`${session.classification.filter((f) => f.status === 'dnf').length} מתוך ${session.classification.length}`}
          />
        </div>
      </div>

      <LapTimes session={session} entries={entries} colorOf={colorOf} />
    </>
  );
}

function Headline({ label, who, value }: { label: string; who?: ArenaEntry; value: string }) {
  return (
    <div className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tiny dim" style={{ letterSpacing: '0.08em' }}>
          {label}
        </div>
        <div style={{ fontWeight: 700 }}>{who?.driver ?? '—'}</div>
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
  const maxLaps = Math.max(0, ...session.classification.map((f) => f.lapTimesMs.length));
  if (maxLaps === 0) return null;
  const best = session.fastestLap?.ms ?? null;

  return (
    <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div className="eyebrow">זמני הקפות</div>
        <div className="row wrap small" style={{ marginTop: 6 }}>
          <span className="t-purple">■ המהירה במרוץ</span>
          <span className="t-green">■ שיא אישי</span>
          <span className="t-yellow">■ איטית יותר</span>
        </div>
      </div>
      <div className="scroll-x">
        <table className="timing pin-1">
          <thead>
            <tr>
              <th>נהג</th>
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
                      driver={e?.driver ?? '—'}
                      team={e?.team ?? '—'}
                      tag={e?.tag}
                      color={colorOf.get(f.entryId)}
                    />
                  </td>
                  {Array.from({ length: maxLaps }, (_, i) => {
                    const ms = f.lapTimesMs[i] ?? null;
                    return (
                      <td key={i} className={`mono num ${lapClass(ms, best, f.bestLapMs)}`}>
                        {ms === null ? '—' : lapTime(ms)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Qualifying: the session that sets the grid, and the source of pole positions. */
function Qualifying({ card }: { card: RaceCard }) {
  const entries = useMemo(() => new Map(card.entries.map((e) => [e.id, e])), [card]);
  const pole = card.qualifying.find((q) => q.bestLapMs !== null)?.bestLapMs ?? null;
  const bestSectors = [0, 1, 2].map((s) => {
    const times = card.qualifying.map((q) => q.sectorsMs[s]).filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  });

  return (
    <div className="card notched" style={{ padding: 0, overflow: 'hidden', marginTop: 14 }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <div className="eyebrow">מוקדמות</div>
        <div className="small muted" style={{ marginTop: 4 }}>
          כל מודל רץ לבד על מסלול ריק, שלוש הקפות. ההקפה המהירה ביותר קובעת את עמדת הזינוק.
        </div>
      </div>
      <div className="scroll-x">
        <table className="timing pin-2">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th>נהג</th>
              <th className="num">זמן</th>
              <th className="num">פער</th>
              <th className="num">מקטע 1</th>
              <th className="num">מקטע 2</th>
              <th className="num">מקטע 3</th>
              <th className="num">מהירות שיא</th>
            </tr>
          </thead>
          <tbody>
            {card.qualifying.map((q, i) => {
              const e = entries.get(q.entryId);
              return (
                <tr key={q.entryId}>
                  <td>
                    <span className={posClass(i + 1, q.bestLapMs === null)}>{q.bestLapMs === null ? '—' : i + 1}</span>
                  </td>
                  <td>
                    <DriverCell driver={e?.driver ?? '—'} team={e?.team ?? '—'} tag={e?.tag} />
                  </td>
                  <td className={`mono num ${i === 0 ? 't-purple' : ''}`}>{lapTime(q.bestLapMs)}</td>
                  <td className="mono num muted">
                    {q.bestLapMs === null || pole === null ? '—' : i === 0 ? '—' : gapTime(q.bestLapMs - pole)}
                  </td>
                  {[0, 1, 2].map((s) => (
                    <td key={s} className={`mono num ${lapClass(q.sectorsMs[s], bestSectors[s], q.sectorsMs[s])}`}>
                      {lapTime(q.sectorsMs[s])}
                    </td>
                  ))}
                  <td className="mono num muted">{q.topSpeed.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

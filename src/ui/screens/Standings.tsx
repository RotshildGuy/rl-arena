import { useMemo, useState } from 'react';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { buildStandings, POINTS, FASTEST_LAP_BONUS } from '../../core/champ/points';
import { teamColor } from '../../core/champ/livery';
import { dayState, settledResults } from '../../core/champ/timing';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import { trackForRound } from '../../core/champ/schedule';
import { DriverCell } from '../components/Livery';
import { dateText, lapTime, posClass, raceTime } from '../format';
import { trackRecords, nextRoundOnTrack, type RecordHolder } from '../../core/champ/records';
import { RACE_LAPS } from '../../core/champ/format';
import { currentRound, startsAtForRound } from '../../core/champ/schedule';
import type { RaceCard, RaceResult } from '../../core/champ/types';

type Tab = 'drivers' | 'teams' | 'results' | 'records';

export function Standings() {
  const { openRace } = useApp();
  const { state, progress } = useChampionship();
  const now = useNow(5000);
  const [tab, setTab] = useState<Tab>('drivers');

  const standings = useMemo(
    () => (state ? buildStandings({ cards: state.cards, results: settledResults(state.cards, state.results, now) }) : null),
    [state],
  );

  // Only race days that are actually over belong in a championship table.
  const raced = useMemo(
    () =>
      state
        ? state.cards.filter((c) => state.results.has(c.id) && dayState(c, now, state.results.get(c.id)) === 'done')
        : [],
    [state, now],
  );

  const mine = new Set(state ? state.entries.filter((e) => e.uid === state.uid).map((e) => e.id) : []);

  if (!state || !standings) {
    return <div className="empty">{progress ?? 'טוען את האליפות…'}</div>;
  }

  if (standings.drivers.length === 0) {
    return (
      <div className="empty">
        <h2 style={{ marginBottom: 6 }}>אין עדיין טבלה</h2>
        <p style={{ margin: 0 }}>הטבלה תיבנה אחרי הגרנד פרי הראשון.</p>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">עונה 1</div>
          <h1 className="display">טבלאות האליפות</h1>
        </div>
        <div className="actions">
          <div className="segmented">
            <button className={tab === 'drivers' ? 'on' : ''} onClick={() => setTab('drivers')}>
              נהגים
            </button>
            <button className={tab === 'teams' ? 'on' : ''} onClick={() => setTab('teams')}>
              קבוצות
            </button>
            <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>
              תוצאות
            </button>
            <button className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>
              שיאים
            </button>
          </div>
        </div>
      </div>

      {tab === 'drivers' && (
        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="scroll-x">
            <table className="timing pin-2">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  <th>נהג</th>
                  <th className="num">נקודות</th>
                  <th className="num">נצחונות</th>
                  <th className="num">פודיומים</th>
                  <th className="num">פול</th>
                  <th className="num">הקפה מהירה</th>
                  <th className="num">זינוקים</th>
                  <th className="num">פרישות</th>
                </tr>
              </thead>
              <tbody>
                {standings.drivers.map((d) => (
                  <tr key={d.entryId} className={d.entryIds.some((id) => mine.has(id)) ? 'me' : ''}>
                    <td>
                      <span className={posClass(d.position)}>{d.position}</span>
                    </td>
                    <td>
                      <DriverCell driver={d.driver} team={d.team} tag={d.tag} />
                    </td>
                    <td className="mono num" style={{ fontWeight: 800, fontSize: 15 }}>
                      {d.points}
                    </td>
                    <td className="mono num">{d.wins || '—'}</td>
                    <td className="mono num">{d.podiums || '—'}</td>
                    <td className="mono num">{d.poles || '—'}</td>
                    <td className="mono num">{d.fastestLaps || '—'}</td>
                    <td className="mono num muted">{d.starts}</td>
                    <td className="mono num muted">{d.dnfs || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'teams' && (
        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="timing">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#</th>
                <th>קבוצה</th>
                <th className="num">נקודות</th>
                <th className="num">נצחונות</th>
                <th className="num">פודיומים</th>
              </tr>
            </thead>
            <tbody>
              {standings.teams.map((t) => {
                const drivers = standings.drivers.filter((d) => d.team === t.team);
                return (
                  <tr key={t.team}>
                    <td>
                      <span className={posClass(t.position)}>{t.position}</span>
                    </td>
                    <td>
                      <div className="driver">
                        <span className="livery" style={{ background: teamColor(t.team) }} />
                        <div className="names">
                          <span className="who">{t.team}</span>
                          <span className="team">{drivers.map((d) => d.driver).join(' · ')}</span>
                        </div>
                      </div>
                    </td>
                    <td className="mono num" style={{ fontWeight: 800, fontSize: 15 }}>
                      {t.points}
                    </td>
                    <td className="mono num">{t.wins || '—'}</td>
                    <td className="mono num">{t.podiums || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'results' && (
        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          {raced.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>
              עוד לא הסתיים אף גרנד פרי.
            </div>
          ) : (
            <div className="scroll-x">
              <table className="timing pin-1">
                <thead>
                  <tr>
                    <th>נהג</th>
                    {raced.map((c) => (
                      <th key={c.id} className="num" title={c.name}>
                        <button
                          className="ghost small"
                          style={{ padding: '2px 4px' }}
                          onClick={() => openRace(c.id, 'report')}
                        >
                          {TRACK_DEFS.find((t) => t.id === trackForRound(c.round))?.name.slice(0, 4) ?? c.round}
                          <br />
                          <span className="dim tiny">{dateText(c.startsAt)}</span>
                        </button>
                      </th>
                    ))}
                    <th className="num">סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.drivers.map((d) => (
                    <tr key={d.entryId} className={d.entryIds.some((id) => mine.has(id)) ? 'me' : ''}>
                      <td>
                        <DriverCell driver={d.driver} team={d.team} tag={d.tag} />
                      </td>
                      {raced.map((c) => {
                        const cell = d.byRace[c.id];
                        return (
                          <td key={c.id} className="mono num">
                            {!cell ? (
                              <span className="dim">—</span>
                            ) : (
                              <span
                                className={posClass(cell.position, cell.status === 'dnf')}
                                title={`${cell.points} נקודות`}
                              >
                                {cell.status === 'dnf' ? 'DNF' : cell.position}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="mono num" style={{ fontWeight: 800 }}>
                        {d.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'records' && <Records cards={raced} results={state.results} now={now} />}

      {tab !== 'records' && (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>שיטת הניקוד</div>
        <div className="row wrap small">
          {POINTS.map((p, i) => (
            <span className="pill" key={i}>
              <span className={posClass(i + 1)} style={{ minWidth: 20, height: 18, fontSize: 11 }}>
                {i + 1}
              </span>
              {p}
            </span>
          ))}
          <span className="pill hot">הקפה מהירה +{FASTEST_LAP_BONUS}</span>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          שיטת הניקוד המקובלת במרוצי מכוניות: נקודות לעשרת הראשונים, ונקודת בונוס להקפה המהירה ביותר —
          אך ורק אם הנהג סיים בעשירייה. שוויון נקודות נשבר לפי מספר הנצחונות, ואם גם הוא שווה — לפי
          מספר המקומות השניים, וכן הלאה. רכב שלא השלים לפחות מחצית מהמרחק של המנצח אינו מסווג
          ואינו צובר נקודות, גם אם דורג בעשירייה.
        </div>
      </div>
      )}
    </>
  );
}

/**
 * The record book. With four circuits on a four-day rotation, every track comes
 * back within the week — which is what makes a lap record worth chasing rather
 * than just worth reading.
 */
function Records({
  cards,
  results,
  now,
}: {
  cards: RaceCard[];
  results: Map<string, RaceResult>;
  now: number;
}) {
  const records = useMemo(() => trackRecords(cards, results), [cards, results]);
  const round = currentRound(now);

  return (
    <div className="grid">
      {records.map((r) => {
        const next = nextRoundOnTrack(r.trackId, round);
        return (
          <div className="card notched" key={r.trackId}>
            <div className="head">
              <div className="eyebrow">{r.name}</div>
              <div className="fill" />
              <span className="muted small">
                {r.races === 0 ? 'טרם נערך' : `${r.races} ${r.races === 1 ? 'מרוץ' : 'מרוצים'}`}
              </span>
              {next !== null && (
                <span className="pill small" title={`סבב ${next}`}>
                  הבא: {dateText(startsAtForRound(next))}
                </span>
              )}
            </div>

            {r.races === 0 ? (
              <div className="muted small">המסלול הזה עוד לא אירח גרנד פרי.</div>
            ) : (
              <div className="cols-3">
                <RecordCell label="שיא הקפה במרוץ" holder={r.lap} purple />
                <RecordCell label="שיא הקפה במוקדמות" holder={r.quali} />
                <RecordCell label={`שיא מרוץ (${RACE_LAPS} הקפות)`} holder={r.distance} full />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecordCell({
  label,
  holder,
  purple,
  full,
}: {
  label: string;
  holder: RecordHolder | null;
  purple?: boolean;
  full?: boolean;
}) {
  return (
    <div>
      <div className="tiny dim" style={{ letterSpacing: '0.08em', marginBottom: 3 }}>
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 19, fontWeight: 800, color: purple ? 'var(--purple)' : 'var(--text)' }}
      >
        {holder ? (full ? raceTime(holder.ms) : lapTime(holder.ms)) : '—'}
      </div>
      {holder && (
        <div className="small">
          <span style={{ fontWeight: 700 }}>{holder.driver}</span>
          <span className="muted"> · {holder.team}</span>
          <div className="dim tiny">
            סבב {holder.round} · {dateText(holder.at)}
          </div>
        </div>
      )}
    </div>
  );
}

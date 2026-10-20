import { useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
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
import { currentRound, displaySeason, seasonNumber, seasonRange, startsAtForRound } from '../../core/champ/schedule';
import { hallOfFame, rookieUids, seasonCards, type SeasonHonours } from '../../core/champ/seasons';
import { leagueView } from '../../core/champ/league';
import { LeaguePanel, useLeagues } from '../components/Leagues';
import type { RaceCard, RaceResult } from '../../core/champ/types';

type Tab = 'drivers' | 'teams' | 'results' | 'records' | 'fame';

export function Standings() {
  const { openRace, leagueId, setLeague } = useApp();
  const { leagues, reload: reloadLeagues } = useLeagues();
  /** The rookies' table is a league of its own, chosen from the same picker. */
  const ROOKIES = '__rookies';
  const rookies = leagueId === ROOKIES;
  const league = leagues.find((l) => l.id === leagueId) ?? null;
  const { state, progress } = useChampionship();
  const now = useNow(5000);
  const [tab, setTab] = useState<Tab>('drivers');
  const current = displaySeason(now);
  const [picked, setPicked] = useState<number | null>(null);
  const season = picked ?? current;

  /** Every season that has had a race, plus the one on now even before its first. */
  const seasons = useMemo(() => {
    const set = new Set(state ? state.cards.map((c) => seasonNumber(c.round)) : []);
    set.add(current);
    return [...set].sort((a, b) => b - a);
  }, [state, current]);

  // A league is the same season with only its members' cars in it.
  const view = useMemo(() => {
    if (!state) return null;
    const cards = seasonCards(state.cards, season);
    const settled = settledResults(state.cards, state.results, now);
    if (rookies) return leagueView(cards, settled, rookieUids(state.cards, season));
    return league ? leagueView(cards, settled, league.members) : { cards, results: settled };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, season, league, rookies]);
  const standings = useMemo(() => (view ? buildStandings(view) : null), [view]);

  // Only race days that are actually over belong in a championship table.
  const allRaced = useMemo(
    () =>
      state
        ? state.cards.filter((c) => state.results.has(c.id) && dayState(c, now, state.results.get(c.id)) === 'done')
        : [],
    [state, now],
  );
  const raced = useMemo(() => {
    const inSeason = seasonCards(allRaced, season);
    if (!view || (!league && !rookies)) return inSeason;
    const kept = new Set(view.cards.map((c) => c.id));
    return inSeason.filter((c) => kept.has(c.id));
  }, [allRaced, season, view, league, rookies]);

  const fame = useMemo(
    () => (state ? hallOfFame(state.cards, settledResults(state.cards, state.results, now), now) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, current],
  );

  const mine = new Set(state ? state.entries.filter((e) => e.uid === state.uid).map((e) => e.id) : []);

  if (!state || !standings) {
    return <PageSkeleton variant="table" note={progress} />;
  }

  if (standings.drivers.length === 0 && fame.length === 0 && seasons.length === 1 && !leagueId && leagues.length === 0) {
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
          <div className="eyebrow">
            עונה {season}
            {season === current ? ' · נוכחית' : ''} · סבבים {seasonRange(season).first}–{seasonRange(season).last}
          </div>
          <h1 className="display">{rookies ? 'טבלת הטירונים' : league ? league.name : 'טבלאות האליפות'}</h1>
        </div>
        <div className="actions">
          {tab !== 'fame' && tab !== 'records' && (
            <select
              value={leagueId ?? ''}
              onChange={(e) => setLeague(e.target.value || null)}
              aria-label="ליגה"
              style={{ width: 'auto' }}
            >
              <option value="">כל המתחרים</option>
              <option value={ROOKIES}>טירונים - העונה הראשונה שלהם</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  ליגה: {l.name}
                </option>
              ))}
            </select>
          )}
          {seasons.length > 1 && tab !== 'fame' && tab !== 'records' && (
            <select
              value={season}
              onChange={(e) => setPicked(Number(e.target.value))}
              aria-label="עונה"
              style={{ width: 'auto' }}
            >
              {seasons.map((n) => (
                <option key={n} value={n}>
                  עונה {n}
                  {n === current ? ' (נוכחית)' : ''}
                </option>
              ))}
            </select>
          )}
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
            <button className={tab === 'fame' ? 'on' : ''} onClick={() => setTab('fame')}>
              היכל התהילה
            </button>
          </div>
        </div>
      </div>

      {(tab === 'drivers' || tab === 'teams') && standings.drivers.length === 0 && (
        <div className="empty">
          <h2 style={{ marginBottom: 6 }}>עונה {season} עוד לא התחילה</h2>
          <p style={{ margin: 0 }}>
            הטבלה מתחילה מאפס בכל עונה, ותיבנה אחרי הגרנד פרי הראשון שלה - סבב {seasonRange(season).first}.
          </p>
        </div>
      )}

      {tab === 'drivers' && standings.drivers.length > 0 && (
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
                    <td className="mono num">{d.wins || '-'}</td>
                    <td className="mono num">{d.podiums || '-'}</td>
                    <td className="mono num">{d.poles || '-'}</td>
                    <td className="mono num">{d.fastestLaps || '-'}</td>
                    <td className="mono num muted">{d.starts}</td>
                    <td className="mono num muted">{d.dnfs || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'teams' && standings.drivers.length > 0 && (
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
                const drivers = standings.drivers.filter((d) => t.entries.includes(d.entryId));
                return (
                  <tr key={t.uid || t.team}>
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
                    <td className="mono num">{t.wins || '-'}</td>
                    <td className="mono num">{t.podiums || '-'}</td>
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
                              <span className="dim">-</span>
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

      {/* Records are all-time: a lap record does not reset with the table. */}
      {tab === 'records' && <Records cards={allRaced} results={state.results} now={now} />}

      {tab === 'fame' && <HallOfFame fame={fame} />}

      {(tab === 'drivers' || tab === 'teams') && <LeaguePanel leagues={leagues} onChanged={reloadLeagues} />}

      {tab !== 'records' && tab !== 'fame' && (
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
          שיטת הניקוד המקובלת במרוצי מכוניות: נקודות לעשרת הראשונים, ונקודת בונוס להקפה המהירה ביותר -
          אך ורק אם הנהג סיים בעשירייה. שוויון נקודות נשבר לפי מספר הנצחונות, ואם גם הוא שווה - לפי
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
 * back within the week - which is what makes a lap record worth chasing rather
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
        {holder ? (full ? raceTime(holder.ms) : lapTime(holder.ms)) : '-'}
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

/**
 * The champions of every season that has finished, newest first. Computed from
 * the results like everything else, so it is complete the moment a season's
 * final takes the flag, with nothing to close or archive.
 */
function HallOfFame({ fame }: { fame: SeasonHonours[] }) {
  if (fame.length === 0) {
    return (
      <div className="empty">
        <h2 style={{ marginBottom: 6 }}>עוד אין אלופים</h2>
        <p style={{ margin: 0 }}>
          אלוף הנהגים ואלוף הקבוצות של כל עונה נכנסים לכאן ברגע שהמרוץ האחרון שלה מסתיים.
        </p>
      </div>
    );
  }
  return (
    <div className="grid">
      {fame.map((h) => (
        <div className="card notched" key={h.season}>
          <div className="head">
            <div className="eyebrow">עונה {h.season}</div>
            <div className="fill" />
            <span className="muted small">
              סבבים {h.first}–{h.last} · {h.races} {h.races === 1 ? 'מרוץ' : 'מרוצים'}
            </span>
          </div>
          <div className="cols-2">
            <div>
              <div className="tiny dim" style={{ letterSpacing: '0.08em', marginBottom: 4 }}>
                🏆 אלוף הנהגים
              </div>
              {h.driver ? (
                <>
                  <DriverCell driver={h.driver.driver} team={h.driver.team} tag={h.driver.tag} />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    <span className="mono">{h.driver.points}</span> נקודות · {h.driver.wins} נצחונות
                    {h.runnerUp && ` · ${h.driver.points - h.runnerUp.points} לפני ${h.runnerUp.driver}`}
                  </div>
                </>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
            <div>
              <div className="tiny dim" style={{ letterSpacing: '0.08em', marginBottom: 4 }}>
                אלופת הקבוצות
              </div>
              {h.team ? (
                <>
                  <div className="driver">
                    <span className="livery" style={{ background: teamColor(h.team.team) }} />
                    <div className="names">
                      <span className="who">{h.team.team}</span>
                    </div>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    <span className="mono">{h.team.points}</span> נקודות · {h.team.wins} נצחונות
                  </div>
                </>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

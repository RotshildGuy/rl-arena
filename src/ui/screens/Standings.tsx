import { useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { ScrollX } from '../components/ScrollX';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { buildStandings, POINTS, FASTEST_LAP_BONUS } from '../../core/champ/points';
import { teamColor } from '../../core/champ/livery';
import { dayState, settledResults } from '../../core/champ/timing';
import { trackForRound } from '../../core/champ/schedule';
import { DriverCell } from '../components/Livery';
import { dateText, lapTime, posClass, raceTime } from '../format';
import { trackRecords, nextRoundOnTrack, type RecordHolder } from '../../core/champ/records';
import { RACE_LAPS } from '../../core/champ/format';
import { SeasonTracks } from '../components/SeasonTracks';
import { currentRound, displaySeason, seasonNumber, seasonRange, startsAtForRound } from '../../core/champ/schedule';
import { hallOfFame, rookieUids, seasonCards, type SeasonHonours } from '../../core/champ/seasons';
import { leagueView } from '../../core/champ/league';
import { LeaguePanel, useLeagues } from '../components/Leagues';
import type { RaceCard, RaceResult } from '../../core/champ/types';
import { useT } from '../../i18n';
import { driverName, grandPrixTitle, teamName, trackName } from '../../i18n/names';
import { isolated, Name } from '../components/Name';

type Tab = 'drivers' | 'teams' | 'results' | 'records' | 'fame';

export function Standings() {
  const s = useT().standings;
  const { openRace, leagueId, setLeague } = useApp();
  const { leagues, reload: reloadLeagues } = useLeagues();
  /** The rookies' table is a league of its own, chosen from the same picker. */
  const ROOKIES = '__rookies';
  const rookies = leagueId === ROOKIES;
  const league = leagues.find((l) => l.id === leagueId) ?? null;
  const { state } = useChampionship();
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
    return <PageSkeleton variant="table" />;
  }

  if (standings.drivers.length === 0 && fame.length === 0 && seasons.length === 1 && !leagueId && leagues.length === 0) {
    return (
      <div className="empty">
        <h2 style={{ marginBottom: 6 }}>{s.noTable}</h2>
        <p style={{ margin: 0 }}>{s.afterFirst}</p>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">
            {s.season(season)}
            {season === current ? s.currentTag : ''} · {s.rounds(seasonRange(season).first, seasonRange(season).last)}
          </div>
          <h1 className="display">{rookies ? s.rookies : league ? <Name>{league.name}</Name> : s.title}</h1>
          <div style={{ marginTop: 6 }}>
            <SeasonTracks season={season} />
          </div>
        </div>
        <div className="actions">
          {tab !== 'fame' && tab !== 'records' && (
            <select
              value={leagueId ?? ''}
              onChange={(e) => setLeague(e.target.value || null)}
              aria-label={s.league}
              style={{ width: 'auto' }}
            >
              <option value="">{s.everyone}</option>
              <option value={ROOKIES}>{s.rookiesOption}</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {s.leagueOption(l.name)}
                </option>
              ))}
            </select>
          )}
          {seasons.length > 1 && tab !== 'fame' && tab !== 'records' && (
            <select
              value={season}
              onChange={(e) => setPicked(Number(e.target.value))}
              aria-label={s.seasonLabel}
              style={{ width: 'auto' }}
            >
              {seasons.map((n) => (
                <option key={n} value={n}>
                  {s.season(n)}
                  {n === current ? s.current : ''}
                </option>
              ))}
            </select>
          )}
          <div className="segmented">
            <button className={tab === 'drivers' ? 'on' : ''} onClick={() => setTab('drivers')}>
              {s.drivers}
            </button>
            <button className={tab === 'teams' ? 'on' : ''} onClick={() => setTab('teams')}>
              {s.teams}
            </button>
            <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>
              {s.results}
            </button>
            <button className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>
              {s.records}
            </button>
            <button className={tab === 'fame' ? 'on' : ''} onClick={() => setTab('fame')}>
              {s.fame}
            </button>
          </div>
        </div>
      </div>

      {(tab === 'drivers' || tab === 'teams') && standings.drivers.length === 0 && (
        <div className="empty">
          <h2 style={{ marginBottom: 6 }}>{s.notStarted(season)}</h2>
          <p style={{ margin: 0 }}>
            {s.fromZero(seasonRange(season).first)}
          </p>
        </div>
      )}

      {tab === 'drivers' && standings.drivers.length > 0 && (
        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          <ScrollX>
            <table className="timing pin-2">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  <th>{s.driver}</th>
                  <th className="num">{s.points}</th>
                  <th className="num">{s.wins}</th>
                  <th className="num">{s.podiums}</th>
                  <th className="num">{s.poles}</th>
                  <th className="num">{s.fastLap}</th>
                  <th className="num">{s.starts}</th>
                  <th className="num">{s.dnfs}</th>
                </tr>
              </thead>
              <tbody>
                {standings.drivers.map((d) => (
                  <tr key={d.entryId} className={d.entryIds.some((id) => mine.has(id)) ? 'me' : ''}>
                    <td>
                      <span className={posClass(d.position)}>{d.position}</span>
                    </td>
                    <td>
                      <DriverCell driver={driverName({ id: d.entryId, driver: d.driver })} team={teamName(d.team)} tag={d.tag} />
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
          </ScrollX>
        </div>
      )}

      {tab === 'teams' && standings.drivers.length > 0 && (
        <div className="card notched" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="timing">
            <thead>
              <tr>
                <th style={{ width: 46 }}>#</th>
                <th>{s.team}</th>
                <th className="num">{s.points}</th>
                <th className="num">{s.wins}</th>
                <th className="num">{s.podiums}</th>
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
                          <span className="who">
                            <Name>{teamName(t.team)}</Name>
                          </span>
                          <span className="team">{drivers.map((d) => isolated(driverName({ id: d.entryId, driver: d.driver }))).join(' · ')}</span>
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
              {s.noneFinished}
            </div>
          ) : (
            <ScrollX>
              <table className="timing pin-1">
                <thead>
                  <tr>
                    <th>{s.driver}</th>
                    {raced.map((c) => (
                      <th key={c.id} className="num" title={grandPrixTitle(c.trackId)}>
                        <button
                          className="ghost small"
                          style={{ padding: '2px 4px' }}
                          onClick={() => openRace(c.id, 'report')}
                        >
                          {trackName(trackForRound(c.round)).slice(0, 4)}
                          <br />
                          <span className="dim tiny">{dateText(c.startsAt)}</span>
                        </button>
                      </th>
                    ))}
                    <th className="num">{s.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.drivers.map((d) => (
                    <tr key={d.entryId} className={d.entryIds.some((id) => mine.has(id)) ? 'me' : ''}>
                      <td>
                        <DriverCell driver={driverName({ id: d.entryId, driver: d.driver })} team={teamName(d.team)} tag={d.tag} />
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
                                title={s.pointsTitle(cell.points)}
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
            </ScrollX>
          )}
        </div>
      )}

      {/* Records are all-time: a lap record does not reset with the table. */}
      {tab === 'records' && <Records cards={allRaced} results={state.results} now={now} />}

      {tab === 'fame' && <HallOfFame fame={fame} />}

      {(tab === 'drivers' || tab === 'teams') && <LeaguePanel leagues={leagues} onChanged={reloadLeagues} />}

      {tab !== 'records' && tab !== 'fame' && (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{s.scoring}</div>
        <div className="row wrap small">
          {POINTS.map((p, i) => (
            <span className="pill" key={i}>
              <span className={posClass(i + 1)} style={{ minWidth: 20, height: 18, fontSize: 11 }}>
                {i + 1}
              </span>
              {p}
            </span>
          ))}
          <span className="pill hot">{s.fastLapBonus(FASTEST_LAP_BONUS)}</span>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          {s.scoringBody}
        </div>
      </div>
      )}
    </>
  );
}

/**
 * The record book. Four circuits a season on a four-day rotation, so every
 * track in it comes back within the week - which is what makes a lap record
 * worth chasing rather than just worth reading.
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
  const s = useT().standings;
  const records = useMemo(() => trackRecords(cards, results), [cards, results]);
  const round = currentRound(now);
  // A circuit with no race behind it and none coming up is just a name.
  const shown = records
    .map((r) => ({ r, next: nextRoundOnTrack(r.trackId, round) }))
    .filter(({ r, next }) => r.races > 0 || next !== null);

  return (
    <div className="grid">
      {shown.map(({ r, next }) => {
        return (
          <div className="card notched" key={r.trackId}>
            <div className="head">
              <div className="eyebrow">{trackName(r.trackId)}</div>
              <div className="fill" />
              <span className="muted small">
                {r.races === 0 ? s.notYet : s.races(r.races)}
              </span>
              {next !== null && (
                <span className="pill small" title={s.round(next)}>
                  {s.next(dateText(startsAtForRound(next)))}
                </span>
              )}
            </div>

            {r.races === 0 ? (
              <div className="muted small">{s.noGrandPrix}</div>
            ) : (
              <div className="cols-3">
                <RecordCell label={s.raceLap} holder={r.lap} purple />
                <RecordCell label={s.qualiLap} holder={r.quali} />
                <RecordCell label={s.raceRecord(RACE_LAPS)} holder={r.distance} full />
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
  const s = useT().standings;
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
          <span style={{ fontWeight: 700 }}>
            <Name>{driverName({ id: holder.entryId, driver: holder.driver })}</Name>
          </span>
          <span className="muted">
            {' · '}
            <Name>{teamName(holder.team)}</Name>
          </span>
          <div className="dim tiny">
            {s.round(holder.round)} · {dateText(holder.at)}
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
  const s = useT().standings;
  if (fame.length === 0) {
    return (
      <div className="empty">
        <h2 style={{ marginBottom: 6 }}>{s.noChampions}</h2>
        <p style={{ margin: 0 }}>
          {s.championsWhen}
        </p>
      </div>
    );
  }
  return (
    <div className="grid">
      {fame.map((h) => (
        <div className="card notched" key={h.season}>
          <div className="head">
            <div className="eyebrow">{s.season(h.season)}</div>
            <div className="fill" />
            <span className="muted small">
              {s.rounds(h.first, h.last)} · {s.races(h.races)}
            </span>
          </div>
          <div className="cols-2">
            <div>
              <div className="tiny dim" style={{ letterSpacing: '0.08em', marginBottom: 4 }}>
                {s.driversChampion}
              </div>
              {h.driver ? (
                <>
                  <DriverCell driver={driverName({ id: h.driver.entryId, driver: h.driver.driver })} team={teamName(h.driver.team)} tag={h.driver.tag} />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    <span className="mono">{h.driver.points}</span>
                    {s.pointsWins(h.driver.wins)}
                    {h.runnerUp && s.ahead(h.driver.points - h.runnerUp.points, isolated(driverName({ id: h.runnerUp.entryId, driver: h.runnerUp.driver })))}
                  </div>
                </>
              ) : (
                <span className="muted">-</span>
              )}
            </div>
            <div>
              <div className="tiny dim" style={{ letterSpacing: '0.08em', marginBottom: 4 }}>
                {s.teamsChampion}
              </div>
              {h.team ? (
                <>
                  <div className="driver">
                    <span className="livery" style={{ background: teamColor(h.team.team) }} />
                    <div className="names">
                      <span className="who">
                        <Name>{teamName(h.team.team)}</Name>
                      </span>
                    </div>
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    <span className="mono">{h.team.points}</span>
                    {s.pointsWins(h.team.wins)}
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

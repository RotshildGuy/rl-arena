import { useEffect, useMemo, useRef, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { buildStandings } from '../../core/champ/points';
import { teamColor } from '../../core/champ/livery';
import { GRID_SIZE, MIN_ENTRIES, SESSION_GAP_MS, lapsFor, planSessions } from '../../core/champ/format';
import {
  airingRound,
  DAY_MS,
  displaySeason,
  roundInSeason,
  seasonNumber,
  lockAtForRound,
  startsAtForRound,
  trackForRound,
} from '../../core/champ/schedule';
import { eligibleEntries } from '../../core/champ/card';
import { carRecaps, type CarRecap } from '../../core/champ/recap';
import { diagnoseCar } from '../../core/champ/diagnose';
import { AdviceLine } from '../components/AdviceLine';
import { shareResult } from '../shareCard';
import { hallOfFame, seasonCards, type SeasonHonours } from '../../core/champ/seasons';
import { HOUSE_FROM_ROUND, HOUSE_GRID, HOUSE_TEAM, isHouse } from '../../core/champ/house';
import { dayState, dayStatus, resultsVisible, settledResults } from '../../core/champ/timing';
import { qualifyingOrder } from '../../core/champ/sim';
import type { ArenaEntry, RaceCard, RaceResult } from '../../core/champ/types';
import { DriverCell } from '../components/Livery';
import { TeamNameForm } from '../components/TeamNameForm';
import { CoachAnchor, useCoachStep } from '../coach';
import { getStore, type ModelMeta } from '../../storage';
import { removeEntry, entryDrift } from '../enterChampionship';
import { dateText, dateTimeText, lapTime, posClass, timeText, untilText, untilWords } from '../format';
import { googleCalendarUrl } from '../calendar';
import { SeasonTracks } from '../components/SeasonTracks';
import { locale, useT } from '../../i18n';
import { driverName, driverOf, grandPrixTitle, teamName, teamOf, trackName } from '../../i18n/names';
import { isolated, Name } from '../components/Name';

/**
 * The models in this browser's garage. Two panels below need to line the grid up
 * against them - one to spot a car running old weights, one to spot a car whose
 * model is gone entirely - and they should not each read the database.
 */
function useMyModels(): ModelMeta[] {
  const [models, setModels] = useState<ModelMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await getStore();
      const list = await store.list('racing');
      if (!cancelled) setModels(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return models;
}

export function Championship() {
  const t = useT();
  const c = t.championship;
  const { go, openRace, competitor, nameTaken } = useApp();
  const { state, progress, error, reload } = useChampionship();
  const now = useNow();
  const [editingName, setEditingName] = useState(!competitor);
  /** Whether this person has started typing a name of their own. */
  const typed = useRef(false);
  const coach = useCoachStep();

  /**
   * On a device this account has never been used on, the team name arrives from
   * the account a moment after this screen mounts. Taking it closes the form
   * before anyone fills it in - which is the point, since the answer already
   * exists - but never while they are in the middle of typing one.
   */
  useEffect(() => {
    if (!competitor || typed.current) return;
    setEditingName(false);
  }, [competitor]);

  // The round on air owns the live banner, so "the next race" is the one after
  // it - otherwise the minute before the lights shows the same Grand Prix twice,
  // once as a countdown to enter and once as a broadcast to watch.
  const upcoming = airingRound(now) + 1;

  // The table of the season on screen only: a new season starts from zero.
  const season = displaySeason(now);
  const standings = useMemo(
    () =>
      state
        ? buildStandings({
            cards: seasonCards(state.cards, season),
            results: settledResults(state.cards, state.results, now),
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, season],
  );

  // The champions of the season that just ended, for a few days after it.
  const lastHonours = useMemo(() => {
    if (!state) return null;
    const settled = settledResults(state.cards, state.results, now);
    return hallOfFame(state.cards, settled, now)[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, season]);

  const liveCard = useMemo(() => {
    if (!state) return null;
    return state.cards.find((c) => dayState(c, now, state.results.get(c.id)) === 'live') ?? null;
  }, [state, now]);

  const lastFinished = useMemo(() => {
    if (!state) return null;
    const done = state.cards.filter(
      (c) => state.results.has(c.id) && dayState(c, now, state.results.get(c.id)) === 'done',
    );
    return done.length ? done[done.length - 1] : null;
  }, [state, now]);

  // Recomputed when the season reloads, and when the clock settles a race day
  // that was still on air - keyed on the round, not the second, because building
  // the table twice is not free.
  const lastRound = lastFinished?.round ?? 0;
  const recaps = useMemo(() => {
    if (!state || !lastFinished) return [];
    const settled = settledResults(state.cards, state.results, now);
    // The table move is within the race's own season.
    return carRecaps(lastFinished, seasonCards(state.cards, seasonNumber(lastFinished.round)), settled, state.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, lastRound]);

  // A car is either on the grid or it is not: an entry left retired under the
  // old withdrawal rules is filtered out here, so its model reads as
  // unregistered everywhere instead of wearing a badge it cannot shed.
  const myEntries = useMemo(
    () => (state ? state.entries.filter((e) => e.uid === state.uid && !e.retired) : []),
    [state],
  );

  const nextField = state ? eligibleEntries(state.entries, upcoming) : [];
  const myModels = useMyModels();

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">{c.eyebrow(season)}</div>
        <h1 className="display">
          {t.signin.headline1}
          <br />
          {t.signin.headline2}
        </h1>
        <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
          {c.intro}
        </p>
      </div>

      {/* Not while on the way to the broadcast: the name form flashing past
          for a moment, unexplained, was the first thing a watcher saw. */}
      {editingName || nameTaken ? (
        <div className="card notched" style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{c.whoAreYou}</div>
          {nameTaken && (
            <div className="small" style={{ marginBottom: 10, color: 'var(--warn)' }}>
              {c.nameTaken(competitor)}
            </div>
          )}
          <TeamNameForm
            autoFocus
            onTyping={() => (typed.current = true)}
            onSaved={() => {
              setEditingName(false);
              reload();
            }}
            onCancel={competitor && !nameTaken ? () => setEditingName(false) : undefined}
            wrap={(field) => (
              <CoachAnchor
                step={coach === 'name' ? coach : null}
                className="field-anchor"
                text={c.coachName}
              >
                {field}
              </CoachAnchor>
            )}
          />
          <div className="small muted" style={{ marginTop: 8 }}>
            {c.nameNote}
          </div>
        </div>
      ) : null}

      {progress && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <span className="pill hot">{c.computing}</span>
            <span className="muted small">{progress}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <span className="pill warn">{c.error}</span>
            <span className="small">{error}</span>
            <div style={{ flex: 1 }} />
            <button className="small" onClick={reload}>
              {c.retry}
            </button>
          </div>
        </div>
      )}

      {liveCard && (
        <LiveBanner
          card={liveCard}
          now={now}
          onWatch={() => openRace(liveCard.id, 'broadcast')}
          onReport={() => openRace(liveCard.id, 'report')}
        />
      )}

      {/* The way to see what this is about without building anything first.
          It used to be a second door on the sign-in screen; one door is
          enough, and the race is one tap from here. Not while one is on air -
          the live banner above already offers that. */}
      {!liveCard && lastFinished && (
        <button className="wide last-race-link" onClick={() => openRace(lastFinished.id, 'broadcast')}>
          <span aria-hidden="true">🎬</span> {c.watchLast(grandPrixTitle(lastFinished.trackId))}
        </button>
      )}

      {lastHonours && now < startsAtForRound(lastHonours.last) + 3 * DAY_MS && (
        <ChampionsBanner honours={lastHonours} onOpen={() => go('standings')} />
      )}


      {lastFinished && recaps.length > 0 && (
        <MyRaceCard
          card={lastFinished}
          result={state?.results.get(lastFinished.id) ?? null}
          recaps={recaps}
          onOpen={() => openRace(lastFinished.id, 'report')}
        />
      )}

      <StaleCarNotice entries={myEntries} models={myModels} now={now} round={upcoming} onFix={() => go('library')} />

      {/* Until the season has loaded there is nothing true to say about the next
          race - its field, its format - so the shape of it stands in. */}
      {!state && <PageSkeleton variant="race" />}

      {state && (
      <div className="split" style={{ marginBottom: 14 }}>
        <NextRace
          round={upcoming}
          now={now}
          field={nextField}
          mine={myEntries.length}
          onEnter={() => go('library')}
        />
        <div className="grid">
          <MyTeam
            entries={myEntries}
            models={myModels}
            onManage={() => go('library')}
            onRename={() => setEditingName(true)}
            onChanged={reload}
          />
          {lastFinished && state && (
            <LastRace
              card={lastFinished}
              now={now}
              onOpen={() => openRace(lastFinished.id, 'report')}
              onRewatch={() => openRace(lastFinished.id, 'broadcast')}
            />
          )}
        </div>
      </div>
      )}

      {standings && standings.drivers.length > 0 && (
        <div className="split">
          <div className="card notched">
            <div className="head">
              <div className="eyebrow">{c.drivers}</div>
              <div className="fill" />
              <button className="ghost small" onClick={() => go('standings')}>
                {c.fullTable}
              </button>
            </div>
            <table className="timing">
              <tbody>
                {standings.drivers.slice(0, 6).map((d) => (
                  <tr key={d.entryId} className={d.entryIds.some((id) => myEntries.some((e) => e.id === id)) ? 'me' : ''}>
                    <td style={{ width: 40 }}>
                      <span className={posClass(d.position)}>{d.position}</span>
                    </td>
                    <td>
                      <DriverCell driver={driverName({ id: d.entryId, driver: d.driver })} team={teamName(d.team)} tag={d.tag} />
                    </td>
                    <td className="mono num" style={{ width: 60, fontWeight: 700 }}>
                      {d.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card notched">
            <div className="head">
              <div className="eyebrow">{c.teams}</div>
            </div>
            <table className="timing">
              <tbody>
                {standings.teams.slice(0, 6).map((team) => (
                  <tr key={team.uid || team.team}>
                    <td style={{ width: 40 }}>
                      <span className={posClass(team.position)}>{team.position}</span>
                    </td>
                    <td>
                      <div className="driver">
                        <span className="livery" style={{ background: teamColor(team.team) }} />
                        <div className="names">
                          <span className="who">
                            <Name>{teamName(team.team)}</Name>
                          </span>
                          <span className="team">
                            {c.models(team.entries.length)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="mono num" style={{ width: 60, fontWeight: 700 }}>
                      {team.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {state && state.cards.length === 0 && !progress && (
        <div className="empty">
          <h2 style={{ marginBottom: 8 }}>
            {nextField.length >= MIN_ENTRIES ? c.firstNotYet : c.notStarted}
          </h2>
          <p style={{ margin: '0 0 14px' }}>
            {nextField.length >= MIN_ENTRIES
              ? c.tablesAfter
              : upcoming >= HOUSE_FROM_ROUND
                ? c.houseFills(teamName(HOUSE_TEAM), HOUSE_GRID)
                : c.needEntries(MIN_ENTRIES)}
          </p>
          <button className="primary" onClick={() => go('library')}>
            {c.toGarage}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * "Your car is running yesterday's brain."
 *
 * Entering a model copies its weights; training it further does not push them.
 * That is on purpose - a bad experiment should not reach the grid by itself -
 * but it means the failure mode is silent, and the moment it costs something is
 * the moment nobody is looking at the garage. So the warning lives here, on the
 * screen people open before a race, and it stops nagging once the grid is locked
 * and there is nothing left to do about it.
 */
function StaleCarNotice({
  entries,
  models,
  now,
  round,
  onFix,
}: {
  entries: ArenaEntry[];
  models: ModelMeta[];
  now: number;
  round: number;
  onFix(): void;
}) {
  const c = useT().championship;
  const stale = useMemo(() => {
    const byId = new Map(models.map((m) => [m.id, m]));
    return entries
      .filter((e) => {
        const model = byId.get(e.modelId);
        return model !== undefined && entryDrift(e, model) !== 'none';
      })
      .map((e) => e.driver);
  }, [entries, models]);

  const lockAt = lockAtForRound(round);
  if (stale.length === 0 || now >= lockAt) return null;

  return (
    <div className="card notched" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
      <div className="row wrap">
        <span className="pill warn">{c.stale}</span>
        <span style={{ minWidth: 0 }}>
          {stale.length === 1 ? c.staleOne(stale[0]) : c.staleMany(stale.length)} {c.staleBody}
        </span>
        <div style={{ flex: 1 }} />
        <span className="dim tiny">{c.until(timeText(lockAt))}</span>
        <button className="primary" onClick={onFix}>
          {c.update}
        </button>
      </div>
    </div>
  );
}

/**
 * The strip at the top of a race day.
 *
 * While a session is running it says how far into it we are. The moment the flag
 * falls it becomes a countdown to the next one instead - the three-minute slot is
 * longer than the racing, and "142 seconds since the start" of a race that ended
 * a minute ago is not information.
 */
function LiveBanner({
  card,
  now,
  onWatch,
  onReport,
}: {
  card: RaceCard;
  now: number;
  onWatch(): void;
  onReport(): void;
}) {
  const c = useT().championship;
  const { state } = useChampionship();
  const status = dayStatus(card, state?.results.get(card.id), now);
  const racing = status.phase === 'racing';
  // The feed is open and the lights have not gone out: the way in has to be on
  // screen *before* the start, which is the whole point of opening it early.
  const preStart = status.phase === 'upcoming';
  const elapsed = status.current ? now - status.current.startsAt : 0;

  return (
    <div className="hero" style={{ marginBottom: 14 }}>
      <div className="row wrap" style={{ position: 'relative' }}>
        <span className={`pill ${racing ? 'live' : preStart ? 'hot' : ''}`}>
          {racing ? (
            <>
              <span className="blip" /> {c.live}
            </>
          ) : preStart ? (
            c.goingLive
          ) : (
            c.between
          )}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20 }}>{grandPrixTitle(card.trackId)}</h2>
          <div className="small muted">
            {racing ? (
              <>
                {c.sinceStart(status.current?.session.name ?? '', Math.floor(elapsed / 1000))}
              </>
            ) : preStart && status.next ? (
              <>
                {c.startIn(status.next.session.name)}{' '}
                <span className="mono">{untilText(status.next.startsAt - now)}</span>
              </>
            ) : status.next ? (
              <>
                {c.endedNext(status.current?.session.name ?? '', status.next.session.name)}{' '}
                <span className="mono">{untilText(status.next.startsAt - now)}</span>
              </>
            ) : (
              c.dayOver
            )}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!racing && status.current && (
          <button onClick={onReport}>{c.sessionResults(status.current.session.name)}</button>
        )}
        <button className="primary" onClick={onWatch}>
          {racing ? c.watchNow : preStart ? c.watchFromStart : c.toBroadcast}
        </button>
      </div>
    </div>
  );
}

function NextRace({
  round,
  now,
  field,
  mine,
  onEnter,
}: {
  round: number;
  now: number;
  field: ArenaEntry[];
  /** How many of the field are this team's cars. */
  mine: number;
  onEnter(): void;
}) {
  const startsAt = startsAtForRound(round);
  const lockAt = lockAtForRound(round);
  const c = useT().championship;
  const trackId = trackForRound(round);
  const locked = now >= lockAt;
  const sessions = planSessions(field.map((e) => e.id));
  const heats = sessions.filter((s) => s.kind === 'heat').length;

  return (
    <div className="hero">
      <div style={{ position: 'relative' }}>
        <div className="eyebrow">
          {c.round(round)}
          {seasonNumber(round) > 1 && c.inSeason(roundInSeason(round).index, roundInSeason(round).of, seasonNumber(round))}{' '}
          {c.nextRace}
        </div>
        <h1 className="display" style={{ margin: '8px 0 4px' }}>
          {grandPrixTitle(trackId)}
        </h1>
        <div className="muted small" style={{ marginBottom: 8 }}>
          {dateTimeText(startsAt)} · {c.track(trackName(trackId))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <SeasonTracks season={seasonNumber(round)} round={round} />
        </div>

        <div className="dim small" style={{ marginBottom: 2 }}>
          {c.lightsOut}
        </div>
        <div className="countdown-big" style={{ marginBottom: 18 }}>
          {untilWords(startsAt - now)}
        </div>

        <div className="cols-3" style={{ gap: 10, marginBottom: 16 }}>
          <div className="stat">
            <div className="k">{c.entered}</div>
            <div className="v">
              {field.filter((e) => !isHouse(e)).length}
              {field.some(isHouse) && (
                <span className="dim" style={{ fontSize: 13 }} title={teamName(HOUSE_TEAM)}>
                  {c.house(field.filter(isHouse).length)}
                </span>
              )}
            </div>
          </div>
          <div className="stat">
            <div className="k">{c.format}</div>
            <div className="v" style={{ fontSize: 15 }}>
              {heats ? c.heats(heats) : c.single}
            </div>
          </div>
          <div className="stat">
            <div className="k">{c.closes}</div>
            <div className="v" style={{ fontSize: 15 }}>
              {timeText(lockAt)}
            </div>
          </div>
        </div>

        <div className="small muted" style={{ marginBottom: 14 }}>
          {field.length === 0 && round >= HOUSE_FROM_ROUND
            ? c.oneEnough(teamName(HOUSE_TEAM), HOUSE_GRID)
            : field.length < MIN_ENTRIES
            ? c.needForRace(MIN_ENTRIES)
            : field.length <= GRID_SIZE
              ? c.allTogether(field.length)
              : c.splitHeats(GRID_SIZE, heats)}
          {locked && c.lockedNote}
        </div>

        {field.length >= MIN_ENTRIES && (
          <div className="timetable">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{c.timetable}</div>
            {sessions.map((s) => {
              const at = startsAt + s.offsetMs;
              const over = now >= at + SESSION_GAP_MS;
              const live = now >= at && !over;
              return (
                <div className={`row tt-row ${live ? 'live' : ''}`} key={s.id}>
                  <span className="mono">{timeText(at)}</span>
                  <span>{s.name}</span>
                  <span className="dim tiny">
                    {s.kind === 'heat' ? c.heatInfo(lapsFor(s), s.advance) : c.laps(lapsFor(s))}
                  </span>
                  <div style={{ flex: 1 }} />
                  {live && <span className="pill good small">{c.onAir}</span>}
                  {over && <span className="dim tiny">{c.ended}</span>}
                </div>
              );
            })}
            <div className="small muted" style={{ marginTop: 6 }}>
              {c.slots(SESSION_GAP_MS / 60000)}
            </div>
          </div>
        )}

        <div className="row wrap">
          <button className="primary" onClick={onEnter}>
            {mine > 0 ? c.myCars : c.enterModel}
          </button>
          <AddToCalendar round={round} />
        </div>
      </div>
    </div>
  );
}

/**
 * The race is the reason to come back, and nothing reminds anybody of it. One
 * daily event, a reminder before the lights, a link back here - no server and
 * no permission to ask for.
 */
function AddToCalendar({ round }: { round: number }) {
  // A Google Calendar event rather than a downloaded .ics: a file lands in the
  // downloads folder on most phones and has to be found and opened, where the
  // link opens the calendar with the event filled in, one tap from saved.
  const c = useT().championship;
  const site = window.location.origin;
  return (
    <button
      onClick={() => window.open(googleCalendarUrl(round, site), '_blank', 'noopener')}
      title={c.calendarTitle(timeText(startsAtForRound(round)))}
    >
      {c.addCalendar}
    </button>
  );
}

/**
 * The cars this person has on the grid, and the only place they can be removed
 * directly. That matters for a car whose model has since been deleted: the
 * garage row it would otherwise be managed from no longer exists, and without
 * this the entry would be stuck on the grid for the rest of the season.
 */
function MyTeam({
  entries,
  models,
  onManage,
  onRename,
  onChanged,
}: {
  entries: ArenaEntry[];
  models: ModelMeta[];
  onManage(): void;
  onRename(): void;
  onChanged(): void;
}) {
  const team = useApp((s) => s.competitor);
  const showToast = useApp((s) => s.showToast);
  const [confirming, setConfirming] = useState<string | null>(null);
  const c = useT().championship;
  const known = useMemo(() => new Set(models.map((m) => m.id)), [models]);

  /**
   * Entries that are the same driver twice.
   *
   * Registering used to be able to hand one driver a second car - after a
   * delete and a re-entry, or a model imported under a new id - and the two
   * then split the season's points between them. The table puts them back
   * together, but the grid does not: seniority decides which two cars of a team
   * race, so the *older* of the pair is the one that keeps lining up while the
   * one being updated sits out. Saying which is which is what makes that
   * fixable, and the newest is kept because it is the one being updated.
   */
  const duplicates = useMemo(() => {
    const newest = new Map<string, ArenaEntry>();
    for (const e of entries) {
      const key = `${e.uid}\u0000${e.driver}`;
      const best = newest.get(key);
      if (!best || e.createdAt > best.createdAt) newest.set(key, e);
    }
    return new Set(entries.filter((e) => newest.get(`${e.uid}\u0000${e.driver}`)?.id !== e.id).map((e) => e.id));
  }, [entries]);

  const drop = async (entry: ArenaEntry) => {
    setConfirming(null);
    try {
      await removeEntry(entry);
      showToast(c.removed(entry.driver));
      onChanged();
    } catch {
      showToast(c.removeFailed);
    }
  };

  return (
    <div className="card notched">
      <div className="head">
        <div className="eyebrow">{c.myTeam}</div>
        <div className="fill" />
        {team && (
          <button className="ghost small" onClick={onRename}>
            {c.rename}
          </button>
        )}
        <button className="ghost small" onClick={onManage}>
          {c.manage}
        </button>
      </div>
      {!team && <div className="muted small">{c.noName}</div>}
      {team && entries.length === 0 && (
        <div className="muted small">
          {c.noEntries(team)}
        </div>
      )}
      {entries.map((e) => {
        const orphan = !known.has(e.modelId);
        return (
          <div className="row wrap" key={e.id} style={{ padding: '7px 0' }}>
            <DriverCell driver={e.driver} team={e.team} tag={e.tag} />
            <div style={{ flex: 1 }} />
            {orphan && (
              <span className="pill warn small" title={c.orphanTitle}>
                {c.orphan}
              </span>
            )}
            {duplicates.has(e.id) && (
              <span
                className="pill warn small"
                title={c.dupTitle}
              >
                {c.dup}
              </span>
            )}
            <span className="mono small muted">{c.attempts(e.episodes.toLocaleString(locale()))}</span>
            {/* Kept together: a lone "remove" orphaned onto its own line reads
                as if it belonged to the row below it. */}
            <div className="row" style={{ gap: 6, flex: '0 0 auto' }}>
              {confirming === e.id ? (
                <>
                  <button className="danger small" onClick={() => void drop(e)}>
                    {c.removeForever}
                  </button>
                  <button className="ghost small" onClick={() => setConfirming(null)}>
                    {c.cancel}
                  </button>
                </>
              ) : (
                <button className="ghost small" onClick={() => setConfirming(e.id)} title={c.removeTitle}>
                  {c.remove}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LastRace({
  card,
  now,
  onOpen,
  onRewatch,
}: {
  card: RaceCard;
  now: number;
  onOpen(): void;
  onRewatch(): void;
}) {
  const c = useT().championship;
  const { state } = useChampionship();
  const result = state?.results.get(card.id) ?? null;
  const visible = resultsVisible(card, now, result);
  const entries = new Map(card.entries.map((e) => [e.id, e]));
  const podium = result ? result.places.slice(0, 3) : [];
  const pole = result?.pole ? entries.get(result.pole) : null;
  const quali = qualifyingOrder(card.qualifying);

  return (
    <div className="card notched">
      <div className="checkers" style={{ margin: '-16px -16px 12px' }} />
      <div className="head">
        <div className="eyebrow">{c.lastResult}</div>
        <div className="fill" />
        <span className="muted tiny">{dateTimeText(card.startsAt)}</span>
      </div>
      <h2 style={{ marginBottom: 10 }}>{grandPrixTitle(card.trackId)}</h2>

      {!visible && <div className="muted small">{c.afterBroadcast}</div>}

      {visible &&
        podium.map((p) => {
          const e = entries.get(p.entryId);
          return (
            <div className="row" key={p.entryId} style={{ padding: '5px 0' }}>
              <span className={posClass(p.position, p.status === 'dnf')}>{p.position}</span>
              <DriverCell driver={driverOf(e) ?? '-'} team={teamOf(e) ?? '-'} tag={e?.tag} />
              <div style={{ flex: 1 }} />
              <span className="mono small" style={{ fontWeight: 700 }}>
                {p.points}
              </span>
            </div>
          );
        })}

      {visible && (
        <div className="small muted" style={{ marginTop: 10 }}>
          {c.pole(driverOf(pole ?? undefined) ?? '-')}
          {result?.fastestLap && c.fastLap(lapTime(result.fastestLap.ms))}
          {quali.length > 0 && c.entrants(quali.length)}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="small" onClick={onOpen} disabled={!visible}>
          {c.fullReport}
        </button>
        <button className="small cyan" onClick={onRewatch}>
          {c.replay}
        </button>
      </div>
    </div>
  );
}

/**
 * How the last race went for this team's own cars, one line each.
 *
 * The podium below is the race as everybody saw it; this is the race as the
 * team cares about it - seventh is not on any podium. Shown only when one of
 * their cars was in the latest race, so it never repeats old news.
 */
function MyRaceCard({
  card,
  result,
  recaps,
  onOpen,
}: {
  card: RaceCard;
  result: RaceResult | null;
  recaps: CarRecap[];
  onOpen(): void;
}) {
  const c = useT().championship;
  return (
    <div className="card notched" style={{ marginBottom: 14 }}>
      <div className="head">
        <div className="eyebrow">{c.whatHappened(grandPrixTitle(card.trackId))}</div>
        <div className="fill" />
        <button className="ghost small" onClick={onOpen}>
          {c.reportArrow}
        </button>
      </div>
      {recaps.map((r) => (
        <div className="row wrap" key={r.entryId} style={{ padding: '6px 0' }}>
          <span className={posClass(r.position, r.status === 'dnf')}>{r.position}</span>
          <DriverCell driver={driverName({ id: r.entryId, driver: r.driver })} team={teamName(r.team)} tag={r.tag} />
          <div style={{ flex: 1 }} />
          {(r.status === 'dnf' || !r.classified) && (
            <span className="pill warn small">{r.status === 'dnf' ? c.retired : c.unclassified}</span>
          )}
          <span className="mono small" style={{ fontWeight: 700 }} title={c.pointsTitle}>
            +{r.points}
          </span>
          {r.gained !== null && (
            <span
              className="mono small"
              style={{ color: r.gained > 0 ? 'var(--good)' : r.gained < 0 ? 'var(--warn)' : undefined }}
              title={c.startedFrom(r.startPos ?? 0)}
            >
              {r.gained > 0 ? `▲${r.gained}` : r.gained < 0 ? `▼${-r.gained}` : '＝'} {c.fromStart}
            </span>
          )}
          {r.bestLapMs !== null && (
            <span
              className="mono small"
              style={r.fastestOfDay ? { color: 'var(--purple)' } : undefined}
              title={r.fastestOfDay ? c.fastestOfDay : c.ownFastest}
            >
              {lapTime(r.bestLapMs)}
            </span>
          )}
          {r.standing !== null && <StandingMove now={r.standing} before={r.standingBefore} />}
          <ShareButton card={card} recap={r} />
          {result && r.position > 1 && (() => {
            // The first thing to fix, right under the line it explains.
            const first = diagnoseCar(card, result, r.entryId)[0];
            return first ? (
              <div style={{ flexBasis: '100%' }}>
                <AdviceLine advice={first} />
              </div>
            ) : null;
          })()}
        </div>
      ))}
    </div>
  );
}

function StandingMove({ now, before }: { now: number; before: number | null }) {
  const c = useT().championship;
  const moved = before === null ? null : before - now;
  return (
    <span className="small muted" title={c.standingTitle}>
      {c.inTable} <span className="mono">{now}</span>
      {moved === null ? c.isNew : moved > 0 ? ` ▲${moved}` : moved < 0 ? ` ▼${-moved}` : ''}
    </span>
  );
}

/**
 * A season is over: say who won it, on the screen everybody opens, for a few
 * days. The table underneath has already started again from zero, and without
 * this the only trace of the champions would be a tab nobody visits.
 */
function ChampionsBanner({ honours, onOpen }: { honours: SeasonHonours; onOpen(): void }) {
  const c = useT().championship;
  const { driver, team, runnerUp } = honours;
  if (!driver) return null;
  return (
    <div className="card notched" style={{ marginBottom: 14, borderColor: 'var(--p1)' }}>
      <div className="row wrap">
        <span className="pill" style={{ color: 'var(--p1)', borderColor: 'var(--p1)' }}>
          {c.champions(honours.season)}
        </span>
        <span style={{ minWidth: 0, flex: '1 1 260px' }}>
          <b>
            <Name>{driverName({ id: driver.entryId, driver: driver.driver })}</Name>
          </b>{' '}
          (<Name>{teamName(driver.team)}</Name>)
          {c.champion(driver.points)}
          {runnerUp ? c.ahead(driver.points - runnerUp.points, isolated(driverName({ id: runnerUp.entryId, driver: runnerUp.driver }))) : ''}.
          {team && (
            <>
              {' '}
              {c.teamsTitle}{' '}
              <b>
                <Name>{teamName(team.team)}</Name>
              </b>
              .
            </>
          )}{' '}
          {c.fresh(honours.season + 1)}
        </span>
        <button className="ghost small" onClick={onOpen}>
          {c.toTables}
        </button>
      </div>
    </div>
  );
}

/** One tap to a picture of this car's race, for a group chat. */
function ShareButton({ card, recap }: { card: RaceCard; recap: CarRecap }) {
  const c = useT().championship;
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const outcome = await shareResult({
        driver: driverName({ id: recap.entryId, driver: recap.driver }),
        team: teamName(recap.team),
        color: teamColor(recap.team),
        position: recap.position,
        dnf: recap.status === 'dnf',
        points: recap.points,
        raceName: grandPrixTitle(card.trackId),
        trackName: trackName(card.trackId),
        date: dateText(card.startsAt),
        bestLap: recap.bestLapMs !== null ? lapTime(recap.bestLapMs) : null,
        gained: recap.gained,
        site: window.location.origin,
      });
      if (outcome === 'downloaded') showToast(c.downloaded);
    } catch {
      showToast(c.shareFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="ghost small" onClick={() => void share()} disabled={busy} title={c.shareTitle}>
      {busy ? '…' : c.share}
    </button>
  );
}

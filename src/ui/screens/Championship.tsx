import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { buildStandings } from '../../core/champ/points';
import { teamColor } from '../../core/champ/livery';
import { GRID_SIZE, MIN_ENTRIES, SESSION_GAP_MS, lapsFor, planSessions } from '../../core/champ/format';
import {
  airingRound,
  grandPrixName,
  lockAtForRound,
  raceIdForRound,
  startsAtForRound,
  trackForRound,
} from '../../core/champ/schedule';
import { eligibleEntries } from '../../core/champ/card';
import { dayState, dayStatus, resultsVisible, settledResults } from '../../core/champ/timing';
import { qualifyingOrder } from '../../core/champ/sim';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import type { ArenaEntry, RaceCard } from '../../core/champ/types';
import { DriverCell } from '../components/Livery';
import { CoachAnchor, useCoachStep } from '../coach';
import { getStore, type ModelMeta } from '../../storage';
import { removeEntry, entryDrift } from '../enterChampionship';
import { dateTimeText, lapTime, posClass, timeText, untilText } from '../format';

/**
 * The models in this browser's garage. Two panels below need to line the grid up
 * against them — one to spot a car running old weights, one to spot a car whose
 * model is gone entirely — and they should not each read the database.
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
  const { go, openRace, competitor, setCompetitor } = useApp();
  const { state, progress, error, reload } = useChampionship();
  const now = useNow();
  const [name, setName] = useState(competitor);
  const [editingName, setEditingName] = useState(!competitor);
  const coach = useCoachStep();

  // The round on air owns the live banner, so "the next race" is the one after
  // it — otherwise the minute before the lights shows the same Grand Prix twice,
  // once as a countdown to enter and once as a broadcast to watch.
  const upcoming = airingRound(now) + 1;

  const standings = useMemo(
    () => (state ? buildStandings({ cards: state.cards, results: settledResults(state.cards, state.results, now) }) : null),
    [state],
  );

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

  // A car is either on the grid or it is not: an entry left retired under the
  // old withdrawal rules is filtered out here, so its model reads as
  // unregistered everywhere instead of wearing a badge it cannot shed.
  const myEntries = useMemo(
    () => (state ? state.entries.filter((e) => e.uid === state.uid && !e.retired) : []),
    [state],
  );

  const nextField = state ? eligibleEntries(state.entries, upcoming) : [];
  const myModels = useMyModels();

  const saveName = () => {
    setCompetitor(name);
    setEditingName(false);
    reload();
  };

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">עונה 1 · אליפות המודלים</div>
        <h1 className="display">
          מרוץ אחד ביום.
          <br />
          המודלים נוהגים, אתם בונים אותם.
        </h1>
        <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
          כל אחד מאמן מודל, רושם אותו לאליפות ומקבל שם קבוצה משלו. פעם ביום נערך גרנד פרי —
          מוקדמות קובעות את רשת הזינוק, המרוץ משודר בשידור חי במהירות רגילה, והניקוד בשיטה המקובלת במרוצי מכוניות.
        </p>
      </div>

      {editingName ? (
        <div className="card notched" style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>מי אתם</div>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <CoachAnchor
              on={coach === 'name'}
              className="field-anchor"
              text="מתחילים כאן: כתבו שם ולחצו שמור. אחר כך נאמן מודל שינהג בשבילכם ונרשום אותו לאליפות."
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <label>שם המתחרה — זה יהיה שם הקבוצה שלכם בטבלה</label>
                <input
                  type="text"
                  value={name}
                  autoFocus
                  placeholder="לדוגמה: גיא"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && saveName()}
                />
              </div>
            </CoachAnchor>
            <button className="primary" disabled={!name.trim()} onClick={saveName}>
              שמור
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            כל המודלים שתאמנו ירוצו תחת השם הזה, והנקודות שלהם יצטברו לטבלת הקבוצות.
          </div>
        </div>
      ) : null}

      {progress && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <span className="pill hot">מחשב</span>
            <span className="muted small">{progress}</span>
          </div>
        </div>
      )}
      {error && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <span className="pill warn">שגיאה</span>
            <span className="small">{error}</span>
            <div style={{ flex: 1 }} />
            <button className="small" onClick={reload}>
              נסה שוב
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

      <StaleCarNotice entries={myEntries} models={myModels} now={now} round={upcoming} onFix={() => go('library')} />

      <div className="split" style={{ marginBottom: 14 }}>
        <NextRace
          round={upcoming}
          now={now}
          field={nextField}
          onEnter={() => go('library')}
        />
        <div className="grid">
          <MyTeam entries={myEntries} models={myModels} onManage={() => go('library')} onChanged={reload} />
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

      {standings && standings.drivers.length > 0 && (
        <div className="split">
          <div className="card notched">
            <div className="head">
              <div className="eyebrow">אליפות הנהגים</div>
              <div className="fill" />
              <button className="ghost small" onClick={() => go('standings')}>
                הטבלה המלאה →
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
                      <DriverCell driver={d.driver} team={d.team} tag={d.tag} />
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
              <div className="eyebrow">אליפות הקבוצות</div>
            </div>
            <table className="timing">
              <tbody>
                {standings.teams.slice(0, 6).map((t) => (
                  <tr key={t.team}>
                    <td style={{ width: 40 }}>
                      <span className={posClass(t.position)}>{t.position}</span>
                    </td>
                    <td>
                      <div className="driver">
                        <span className="livery" style={{ background: teamColor(t.team) }} />
                        <div className="names">
                          <span className="who">{t.team}</span>
                          <span className="team">
                            {t.entries.length} {t.entries.length === 1 ? 'מודל' : 'מודלים'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="mono num" style={{ width: 60, fontWeight: 700 }}>
                      {t.points}
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
            {nextField.length >= MIN_ENTRIES ? 'הגרנד פרי הראשון עוד לא נערך' : 'האליפות עוד לא התחילה'}
          </h2>
          <p style={{ margin: '0 0 14px' }}>
            {nextField.length >= MIN_ENTRIES
              ? 'הטבלאות ייבנו מיד אחרי שהאורות ייכבו.'
              : `צריך לפחות ${MIN_ENTRIES} מודלים רשומים כדי שייערך גרנד פרי. אמנו מודל ורשמו אותו.`}
          </p>
          <button className="primary" onClick={() => go('library')}>
            למוסך
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
 * That is on purpose — a bad experiment should not reach the grid by itself —
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
        <span className="pill warn">לא מעודכן על המסלול</span>
        <span style={{ minWidth: 0 }}>
          {stale.length === 1 ? `"${stale[0]}" השתנה` : `${stale.length} מהרכבים שלך השתנו`} במוסך
          מאז הרישום האחרון — שם, משקולות או שניהם. בלי עדכון, הגרסה הישנה היא זו שתתחרה.
        </span>
        <div style={{ flex: 1 }} />
        <span className="dim tiny">עד {timeText(lockAt)}</span>
        <button className="primary" onClick={onFix}>
          עדכן רכב
        </button>
      </div>
    </div>
  );
}

/**
 * The strip at the top of a race day.
 *
 * While a session is running it says how far into it we are. The moment the flag
 * falls it becomes a countdown to the next one instead — the three-minute slot is
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
              <span className="blip" /> שידור חי
            </>
          ) : preStart ? (
            'עולה לאוויר'
          ) : (
            'בין מקצים'
          )}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20 }}>{card.name}</h2>
          <div className="small muted">
            {racing ? (
              <>
                {status.current?.session.name} · {Math.floor(elapsed / 1000)} שניות מהזינוק
              </>
            ) : preStart && status.next ? (
              <>
                {status.next.session.name} · הזינוק בעוד{' '}
                <span className="mono">{untilText(status.next.startsAt - now)}</span>
              </>
            ) : status.next ? (
              <>
                {status.current?.session.name} הסתיים · {status.next.session.name} מתחיל בעוד{' '}
                <span className="mono">{untilText(status.next.startsAt - now)}</span>
              </>
            ) : (
              'היום הסתיים'
            )}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!racing && status.current && (
          <button onClick={onReport}>תוצאות {status.current.session.name}</button>
        )}
        <button className="primary" onClick={onWatch}>
          {racing ? 'צפה עכשיו' : preStart ? 'צפייה מהזינוק' : 'לשידור'}
        </button>
      </div>
    </div>
  );
}

function NextRace({
  round,
  now,
  field,
  onEnter,
}: {
  round: number;
  now: number;
  field: ArenaEntry[];
  onEnter(): void;
}) {
  const startsAt = startsAtForRound(round);
  const lockAt = lockAtForRound(round);
  const track = TRACK_DEFS.find((t) => t.id === trackForRound(round));
  const locked = now >= lockAt;
  const sessions = planSessions(field.map((e) => e.id));
  const heats = sessions.filter((s) => s.kind === 'heat').length;

  return (
    <div className="hero">
      <div style={{ position: 'relative' }}>
        <div className="eyebrow">סבב {round} · המרוץ הבא</div>
        <h1 className="display" style={{ margin: '8px 0 4px' }}>
          {grandPrixName(round)}
        </h1>
        <div className="muted small" style={{ marginBottom: 16 }}>
          {dateTimeText(startsAt)} · מסלול {track?.name ?? '—'} · {raceIdForRound(round)}
        </div>

        <div className="countdown-big" style={{ marginBottom: 4 }}>
          {untilText(startsAt - now)}
        </div>
        <div className="dim tiny" style={{ marginBottom: 18, letterSpacing: '0.1em' }}>
          עד כיבוי האורות
        </div>

        <div className="cols-3" style={{ gap: 10, marginBottom: 16 }}>
          <div className="stat">
            <div className="k">רשומים</div>
            <div className="v">{field.length}</div>
          </div>
          <div className="stat">
            <div className="k">פורמט</div>
            <div className="v" style={{ fontSize: 15 }}>
              {heats ? `${heats} מקצים + גמר` : 'מרוץ יחיד'}
            </div>
          </div>
          <div className="stat">
            <div className="k">סגירת רישום</div>
            <div className="v" style={{ fontSize: 15 }}>
              {timeText(lockAt)}
            </div>
          </div>
        </div>

        <div className="small muted" style={{ marginBottom: 14 }}>
          {field.length < MIN_ENTRIES
            ? `צריך לפחות ${MIN_ENTRIES} מודלים רשומים כדי שהמרוץ ייערך.`
            : field.length <= GRID_SIZE
              ? `כל ${field.length} המודלים מזניקים יחד. המוקדמות קובעות את סדר הזינוק.`
              : `יותר מ-${GRID_SIZE} רשומים, ולכן היום מתחלק ל-${heats} מקצים והמובילים עולים לגמר.`}
          {locked && ' הרישום לסבב הזה כבר נסגר — מודל שיירשם עכשיו יתחרה בסבב הבא.'}
        </div>

        {field.length >= MIN_ENTRIES && (
          <div className="timetable">
            <div className="eyebrow" style={{ marginBottom: 6 }}>לוח הזמנים של היום</div>
            {sessions.map((s) => {
              const at = startsAt + s.offsetMs;
              const over = now >= at + SESSION_GAP_MS;
              const live = now >= at && !over;
              return (
                <div className={`row tt-row ${live ? 'live' : ''}`} key={s.id}>
                  <span className="mono">{timeText(at)}</span>
                  <span>{s.name}</span>
                  <span className="dim tiny">
                    {s.kind === 'heat' ? `${lapsFor(s)} הקפות · ${s.advance} הראשונים עולים` : `${lapsFor(s)} הקפות`}
                  </span>
                  <div style={{ flex: 1 }} />
                  {live && <span className="pill good small">משודר עכשיו</span>}
                  {over && <span className="dim tiny">הסתיים</span>}
                </div>
              );
            })}
            <div className="small muted" style={{ marginTop: 6 }}>
              כל מקצה משודר בשידור חי במשבצת שלו, {SESSION_GAP_MS / 60000} דקות אחרי הקודם.
            </div>
          </div>
        )}

        <button className="primary" onClick={onEnter}>
          {field.length ? 'רשום עוד מודל' : 'רשום מודל לאליפות'}
        </button>
      </div>
    </div>
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
  onChanged,
}: {
  entries: ArenaEntry[];
  models: ModelMeta[];
  onManage(): void;
  onChanged(): void;
}) {
  const team = useApp((s) => s.competitor);
  const showToast = useApp((s) => s.showToast);
  const [confirming, setConfirming] = useState<string | null>(null);
  const known = useMemo(() => new Set(models.map((m) => m.id)), [models]);

  /**
   * Entries that are the same driver twice.
   *
   * Registering used to be able to hand one driver a second car — after a
   * delete and a re-entry, or a model imported under a new id — and the two
   * then split the season's points between them. The table puts them back
   * together, but the grid does not: seniority decides which two cars of a team
   * race, so the *older* of the pair is the one that keeps lining up while the
   * one being updated sits out. Saying which is which is what makes that
   * fixable, and the newest is kept because it is the one being updated.
   */
  const duplicates = useMemo(() => {
    const newest = new Map<string, ArenaEntry>();
    for (const e of entries) {
      const key = `${e.team}\u0000${e.driver}`;
      const best = newest.get(key);
      if (!best || e.createdAt > best.createdAt) newest.set(key, e);
    }
    return new Set(entries.filter((e) => newest.get(`${e.team}\u0000${e.driver}`)?.id !== e.id).map((e) => e.id));
  }, [entries]);

  const drop = async (entry: ArenaEntry) => {
    setConfirming(null);
    try {
      await removeEntry(entry);
      showToast(`${entry.driver} הוסר מהאליפות`);
      onChanged();
    } catch {
      showToast('ההסרה נכשלה');
    }
  };

  return (
    <div className="card notched">
      <div className="head">
        <div className="eyebrow">הקבוצה שלי</div>
        <div className="fill" />
        <button className="ghost small" onClick={onManage}>
          ניהול
        </button>
      </div>
      {!team && <div className="muted small">עדיין לא הגדרתם שם מתחרה.</div>}
      {team && entries.length === 0 && (
        <div className="muted small">
          {team} — עוד אין מודלים רשומים. אמנו מודל במוסך ורשמו אותו לאליפות.
        </div>
      )}
      {entries.map((e) => {
        const orphan = !known.has(e.modelId);
        return (
          <div className="row wrap" key={e.id} style={{ padding: '7px 0' }}>
            <DriverCell driver={e.driver} team={e.team} tag={e.tag} />
            <div style={{ flex: 1 }} />
            {orphan && (
              <span className="pill warn small" title="המודל שממנו נרשם הרכב כבר לא במוסך">
                אין מודל
              </span>
            )}
            {duplicates.has(e.id) && (
              <span
                className="pill warn small"
                title="אותו נהג רשום פעמיים. הרשומה הישנה היא זו שעולה לגריד — כדאי להסיר אותה. הנקודות והתוצאות שלה נשארות בטבלה, מאוחדות תחת אותו נהג"
              >
                רישום כפול
              </span>
            )}
            <span className="mono small muted">{e.episodes.toLocaleString('he-IL')} אפ׳</span>
            {/* Kept together: a lone "remove" orphaned onto its own line reads
                as if it belonged to the row below it. */}
            <div className="row" style={{ gap: 6, flex: '0 0 auto' }}>
              {confirming === e.id ? (
                <>
                  <button className="danger small" onClick={() => void drop(e)}>
                    להסיר לצמיתות?
                  </button>
                  <button className="ghost small" onClick={() => setConfirming(null)}>
                    ביטול
                  </button>
                </>
              ) : (
                <button className="ghost small" onClick={() => setConfirming(e.id)} title="הסרה מהאליפות">
                  הסר
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
        <div className="eyebrow">התוצאה האחרונה</div>
        <div className="fill" />
        <span className="muted tiny">{dateTimeText(card.startsAt)}</span>
      </div>
      <h2 style={{ marginBottom: 10 }}>{card.name}</h2>

      {!visible && <div className="muted small">התוצאות יפורסמו בתום השידור.</div>}

      {visible &&
        podium.map((p) => {
          const e = entries.get(p.entryId);
          return (
            <div className="row" key={p.entryId} style={{ padding: '5px 0' }}>
              <span className={posClass(p.position, p.status === 'dnf')}>{p.position}</span>
              <DriverCell driver={e?.driver ?? '—'} team={e?.team ?? '—'} tag={e?.tag} />
              <div style={{ flex: 1 }} />
              <span className="mono small" style={{ fontWeight: 700 }}>
                {p.points}
              </span>
            </div>
          );
        })}

      {visible && (
        <div className="small muted" style={{ marginTop: 10 }}>
          עמדת זינוק ראשונה: {pole?.driver ?? '—'}
          {result?.fastestLap && ` · הקפה מהירה ${lapTime(result.fastestLap.ms)}`}
          {quali.length > 0 && ` · ${quali.length} משתתפים`}
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="small" onClick={onOpen} disabled={!visible}>
          דוח מרוץ מלא
        </button>
        <button className="small cyan" onClick={onRewatch}>
          צפייה חוזרת
        </button>
      </div>
    </div>
  );
}

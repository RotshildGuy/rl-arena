import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { LineChart } from '../components/LineChart';
import { DriverCell } from '../components/Livery';
import { getStore, newModelId, type ModelMeta } from '../../storage';
import { ALGORITHMS } from '../../core/rl/algorithms';
import { useChampionship } from '../useChampionship';
import {
  enterChampionship,
  renameEntry,
  removeEntry,
  entryDrift,
  DRIFT_LABEL,
  EntryError,
  MAX_ENTRIES_PER_TEAM,
} from '../enterChampionship';
import { teamColor } from '../../core/champ/livery';
import { REWARD_LEVELS, channelDefault, levelOf } from '../../core/games/types';
import type { ArenaEntry } from '../../core/champ/types';
import {
  lockAtForRound,
  currentRound,
  startsAtForRound,
  trackForRound,
  grandPrixName,
} from '../../core/champ/schedule';
import { eligibleEntries } from '../../core/champ/card';
import { RACE_LAPS } from '../../core/champ/format';
import { Modal } from '../components/Modal';
import { durationText, lapTime, raceTime, timeText } from '../format';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import { TrainingPrimer, hasSeenPrimer, markPrimerSeen } from '../components/TrainingPrimer';
import { exportModel, importModel, ModelFileError } from '../modelFile';

export function Garage() {
  const { gameId, go, newDraft, draftFromModel, patchRace, showToast, competitor: team } = useApp();
  const game = getGame(gameId);
  const champ = useChampionship();
  const [models, setModels] = useState<ModelMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  // The model waiting for a place on a full grid — the swap dialog is open for it.
  const [swapFor, setSwapFor] = useState<ModelMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Shown once per device on the first visit here, and reopenable from the header.
  const [primer, setPrimer] = useState(() => !hasSeenPrimer());
  const detailRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const store = await getStore();
    setModels(await store.list(gameId));
  }, [gameId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Opening a car brings its panel to the middle of the screen. Without this the
  // settings can open below the fold and it looks as if nothing happened.
  useEffect(() => {
    if (!selected) return;
    const id = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return () => clearTimeout(id);
  }, [selected]);

  /**
   * Entries I own, keyed by the model they were uploaded from.
   *
   * This can still hold an entry left retired under the old withdrawal rules;
   * keeping it here is what lets a re-registration reuse its id and its points.
   * Everything the screen *shows* goes through `carOf` instead: a retired entry
   * is not a car on the grid, and reads as an unregistered model.
   */
  const myEntries = useMemo(() => {
    const st = champ.state;
    if (!st) return new Map<string, ArenaEntry>();
    return new Map(st.entries.filter((e) => e.uid === st.uid).map((e) => [e.modelId, e]));
  }, [champ.state]);

  /** The car this model has on the grid, or null if it is not registered. */
  const carOf = useCallback(
    (modelId: string): ArenaEntry | null => {
      const e = myEntries.get(modelId);
      return e && !e.retired ? e : null;
    },
    [myEntries],
  );

  /** Cars of mine already on the grid — the limit is per team, not per model. */
  const myCars = useMemo(() => [...myEntries.values()].filter((e) => !e.retired), [myEntries]);
  const gridFull = myCars.length >= MAX_ENTRIES_PER_TEAM;

  const startNew = () => {
    newDraft();
    go('trainSetup');
  };

  const continueTraining = (m: ModelMeta, restart: boolean) => {
    draftFromModel(m, restart);
    go('trainSetup');
  };

  const duplicate = async (m: ModelMeta) => {
    const store = await getStore();
    const rec = await store.load(m.id);
    if (!rec) return;
    await store.save({ ...rec, id: newModelId(), name: m.name + ' (עותק)', createdAt: Date.now(), updatedAt: Date.now() });
    showToast('המודל שוכפל');
    void refresh();
  };

  const commitRename = async (m: ModelMeta) => {
    const name = renameText.trim();
    setRenaming(null);
    if (!name || name === m.name) return;

    // A registered model's name is public, so the rename has to satisfy the
    // public rules — otherwise the garage and the grid would drift apart again.
    const entry = myEntries.get(m.id);
    try {
      if (entry) await renameEntry(entry, name);
    } catch (e) {
      showToast(e instanceof EntryError ? e.message : 'שינוי השם באליפות נכשל');
      return;
    }

    const store = await getStore();
    const rec = await store.load(m.id);
    if (!rec) return;
    await store.save({ ...rec, name, updatedAt: Date.now() });
    showToast(entry ? 'השם עודכן, גם על המסלול' : 'השם עודכן');
    if (entry) champ.reload();
    void refresh();
  };

  const remove = async (m: ModelMeta) => {
    // Deleting the model takes its car off the grid too. Leaving the entry would
    // strand a car nothing can reach: the garage row it was managed from is gone.
    const entry = myEntries.get(m.id);
    if (entry) await removeEntry(entry);

    const store = await getStore();
    await store.remove(m.id);
    setConfirmDelete(null);
    setSelected(null);
    showToast(entry ? 'המודל נמחק והוסר מהאליפות' : 'המודל נמחק');
    if (entry) champ.reload();
    void refresh();
  };

  const race = (m: ModelMeta) => {
    patchRace({ config: { ...m.config }, opponents: [m.id] });
    go('raceSetup');
  };

  const enter = async (m: ModelMeta) => {
    setEntering(m.id);
    try {
      const wasEntered = carOf(m.id) !== null;
      await enterChampionship(m);
      showToast(wasEntered ? 'המשקולות עודכנו — הרכב ישתתף עם הגרסה החדשה' : `${m.name} נרשם לאליפות`);
      champ.reload();
    } catch (e) {
      showToast(e instanceof EntryError ? e.message : 'הרישום נכשל');
    } finally {
      setEntering(null);
    }
  };

  const unregister = async (modelId: string) => {
    const entry = carOf(modelId);
    if (!entry) return;
    await removeEntry(entry);
    showToast(`${entry.driver} הוסר מהאליפות`);
    champ.reload();
  };

  /**
   * Put a model on a full grid by taking one of my own cars off it.
   *
   * The limit used to be a dead end: the button was simply disabled and the
   * only way through was to find the right model and remove it yourself. Here
   * the choice of who steps aside is the whole dialog, and the swap is one act.
   */
  const swap = async (out: ArenaEntry, m: ModelMeta) => {
    setSwapFor(null);
    setEntering(m.id);
    try {
      await removeEntry(out);
      await enterChampionship(m);
      showToast(`${out.driver} הוסר, ${m.name} נרשם במקומו`);
    } catch (e) {
      // The old car is already off the grid by now, so a bare "it failed" would
      // leave the team one down and none the wiser. The slot is free: say what
      // happened and the second half can simply be tried again.
      const why = e instanceof EntryError ? e.message : 'הרישום נכשל';
      showToast(`${out.driver} הוסר, אבל ${m.name} לא נרשם — ${why}`);
    } finally {
      setEntering(null);
      champ.reload();
    }
  };

  const save = async (m: ModelMeta) => {
    try {
      showToast(`נשמר הקובץ ${await exportModel(m.id)}`);
    } catch (e) {
      showToast(e instanceof ModelFileError ? e.message : 'הייצוא נכשל');
    }
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const rec = await importModel(file);
      showToast(`${rec.name} יובא`);
      void refresh();
    } catch (e) {
      showToast(e instanceof ModelFileError ? e.message : 'הייבוא נכשל');
    }
  };

  const nextRound = currentRound() + 1;
  const locked = Date.now() >= lockAtForRound(nextRound);
  // The circuit the next Grand Prix runs on. Every car's headline time is its
  // time *there*: a record set on the oval says nothing about a mountain race,
  // and this is the one number that predicts how the next round will go.
  const gpTrackId = trackForRound(nextRound);
  const gpTrack = TRACK_DEFS.find((t) => t.id === gpTrackId);
  // Exactly the field the next round will be built from, so a car that is over
  // the team limit is told here rather than discovering it on race day.
  const onGrid = new Set(champ.state ? eligibleEntries(champ.state.entries, nextRound).map((e) => e.id) : []);

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">המוסך</div>
          <h1 className="display">המודלים שלי</h1>
        </div>
        <div className="actions">
          {/* Distinct from the footer's "איך זה עובד", which opens the rules of
              the championship. This one is about training specifically. */}
          <button className="ghost" onClick={() => setPrimer(true)} title="מה המודל בעצם לומד">
            הסבר על אימון
          </button>
          <button onClick={() => fileInput.current?.click()}>ייבוא מקובץ</button>
          <button className="primary" onClick={startNew}>
            אמן מודל חדש
          </button>
        </div>
      </div>

      {swapFor && (
        <SwapDialog
          model={swapFor}
          cars={myCars}
          models={models ?? []}
          gpTrackId={gpTrackId}
          onPick={(out) => void swap(out, swapFor)}
          onClose={() => setSwapFor(null)}
        />
      )}

      {primer && (
        <TrainingPrimer
          onClose={() => {
            markPrimerSeen();
            setPrimer(false);
          }}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void load(e.target.files?.[0]);
          // Reset, or picking the same file twice does nothing the second time.
          e.target.value = '';
        }}
      />

      <div className="card" style={{ marginBottom: 14 }}>
          <div className="row wrap small">
            {team ? (
              <>
                <span className="pill">
                  <span className="livery" style={{ background: teamColor(team), width: 4, height: 12 }} />
                  קבוצה: {team}
                </span>
                <span className={gridFull ? 'pill warn' : 'muted'}>
                  {myCars.length} מתוך {MAX_ENTRIES_PER_TEAM} רכבים על המסלול
                </span>
                <span className="muted">
                  {gridFull
                    ? 'הגריד מלא — רישום מודל נוסף יבקש לבחור איזה רכב יורד במקומו.'
                    : 'מודל שנרשם לאליפות מתחרה בכל גרנד פרי יומי תחת השם הזה.'}
                </span>
              </>
            ) : (
              <>
                <span className="pill warn">אין שם מתחרה</span>
                <span className="muted">בלי שם מתחרה אי אפשר להירשם לאליפות.</span>
                <button className="small" onClick={() => go('championship')}>
                  הגדר שם
                </button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <span className="dim tiny">{grandPrixName(nextRound)}</span>
            <span className="dim tiny">
              {locked
                ? `הרישום לסבב ${nextRound} סגור · הסבב הבא ב-${timeText(startsAtForRound(nextRound + 1))}`
                : `הרישום לסבב ${nextRound} נסגר ב-${timeText(lockAtForRound(nextRound))}`}
            </span>
        </div>
      </div>

      {models === null && <div className="empty">טוען…</div>}

      {models !== null && models.length === 0 && (
        <div className="empty">
          <h2 style={{ marginBottom: 6 }}>אין עדיין מודלים</h2>
          <p style={{ margin: '0 0 6px' }}>{game.blurb}</p>
          <p className="small" style={{ margin: '0 0 14px' }}>
            אימון ראשון לוקח בערך שתי דקות עד שהרכב משלים הקפה.
          </p>
          <button className="primary" onClick={startNew}>
            אמן מודל חדש
          </button>
        </div>
      )}

      {models !== null && models.length > 0 && (
        <div className="model-list">
          {models.map((m) => {
            const entry = carOf(m.id);
            const drift = entry ? entryDrift(entry, m) : 'none';
            const open = selected === m.id;
            const gp = gpRecord(m, gpTrackId);
            return (
              // The panel belongs directly under the car it describes, not at the
              // bottom of the list: on a phone the old layout put the settings of
              // the first model below the last one.
              <div className="model-slot" key={m.id} ref={open ? detailRef : undefined}>
                <div className={`model-card ${open ? 'sel' : ''}`} onClick={() => setSelected(open ? null : m.id)}>
                  <div className="row">
                    <DriverCell
                      driver={m.name}
                      team={m.owner || team || 'ללא שם'}
                      note={ALGORITHMS[m.algorithm]?.name ?? m.algorithm}
                    />
                    <div style={{ flex: 1 }} />
                    {gameId === 'racing' &&
                      (!entry ? (
                        <span className="dim tiny">לא רשום</span>
                      ) : !onGrid.has(entry.id) ? (
                        <span className="pill warn small" title={`לכל קבוצה ${MAX_ENTRIES_PER_TEAM} רכבים במרוץ`}>
                          מחוץ למכסת הקבוצה
                        </span>
                      ) : drift !== 'none' ? (
                        <span className="pill warn small">{DRIFT_LABEL[drift]}</span>
                      ) : (
                        <span className="pill good small">רשום</span>
                      ))}
                  </div>

                  <div className="stats">
                    <span>
                      {ALGORITHMS[m.algorithm]?.episodesLabel ?? 'סבבים'}{' '}
                      <b>{m.training.episodes.toLocaleString('he-IL')}</b>
                    </span>
                    <span>
                      {game.spec.scoreLabel} <b>{m.training.bestScore.toFixed(2)}</b>
                    </span>
                    {/* The circuit that matters is the one the next Grand Prix
                        runs on, not whichever the model happened to train on
                        last — so that is the time on the card, and a model that
                        has never been there is told so plainly. */}
                    <span title={`השיא של המודל במסלול של ${grandPrixName(nextRound)}`}>
                      הקפה מהירה ב{gpTrack?.name ?? gpTrackId}{' '}
                      {gp.lapMs != null ? (
                        <b>{lapTime(gp.lapMs)}</b>
                      ) : (
                        <b style={{ color: 'var(--warn)' }}>טרם התאמן</b>
                      )}
                    </span>
                    {gp.raceMs != null && (
                      <span title={`${RACE_LAPS} הקפות, מרחק הגרנד פרי`}>
                        מרוץ מלא <b>{raceTime(gp.raceMs)}</b>
                      </span>
                    )}
                    <span>
                      אימון אחרון ב <b>{trackName(m.config) || '—'}</b>
                    </span>
                    <span>
                      זמן אימון <b>{durationText(m.training.trainedMs)}</b>
                    </span>
                  </div>

                  <div className="acts">
                    {gameId === 'racing' && (
                      <button
                        className={entry && drift === 'none' ? 'small' : 'small primary'}
                        disabled={entering === m.id || !(m.owner || team)}
                        title={
                          gridFull && !entry
                            ? `לכל קבוצה ${MAX_ENTRIES_PER_TEAM} רכבים על המסלול — תתבקשו לבחור מי יורד`
                            : undefined
                        }
                        onClick={(ev) => {
                          ev.stopPropagation();
                          // A full grid asks which car steps aside instead of
                          // refusing; registering is never a dead end.
                          if (gridFull && !entry) setSwapFor(m);
                          else void enter(m);
                        }}
                      >
                        {entering === m.id ? 'רושם…' : entry ? 'עדכן רכב' : 'רשום לאליפות'}
                      </button>
                    )}
                    <button
                      className="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        continueTraining(m, false);
                      }}
                    >
                      המשך אימון
                    </button>
                    <button
                      className="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        race(m);
                      }}
                    >
                      התחרה מולו
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="card notched model-detail">
                    <div className="head">
                      {renaming === m.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => void commitRename(m)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRename(m);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                        />
                      ) : (
                        <h2>{m.name}</h2>
                      )}
                      <div className="fill" />
                      <button className="ghost small" onClick={() => setSelected(null)}>
                        סגור
                      </button>
                    </div>

                    <div className="row wrap" style={{ marginBottom: 14 }}>
                      <button onClick={() => continueTraining(m, false)}>המשך אימון</button>
                      <button onClick={() => continueTraining(m, true)}>אימון מחדש</button>
                      <button onClick={() => race(m)}>התחרה מולו</button>
                      <button
                        onClick={() => {
                          setRenameText(m.name);
                          setRenaming(m.id);
                        }}
                      >
                        שנה שם
                      </button>
                      <button onClick={() => duplicate(m)}>שכפל</button>
                      <button onClick={() => void save(m)} title="שומר קובץ גיבוי שאפשר לייבא בחזרה">
                        ייצוא לקובץ
                      </button>
                      {entry && <button onClick={() => void unregister(m.id)}>הסר מהאליפות</button>}
                      {confirmDelete === m.id ? (
                        <>
                          <button className="danger" onClick={() => void remove(m)}>
                            {entry ? 'למחוק ולהסיר מהאליפות?' : 'למחוק לצמיתות?'}
                          </button>
                          <button className="ghost" onClick={() => setConfirmDelete(null)}>
                            ביטול
                          </button>
                        </>
                      ) : (
                        <button className="danger" onClick={() => setConfirmDelete(m.id)}>
                          מחק
                        </button>
                      )}
                    </div>

                    <h3 style={{ margin: '0 0 6px' }}>השיאים שלו</h3>
                    <RecordTable model={m} />

                    <h3 style={{ margin: '14px 0 6px' }}>עקומת הלמידה</h3>
                    <LineChart
                      height={110}
                      series={[{ label: 'reward', color: '#00e0ff', values: m.training.history.map((p) => p.reward) }]}
                    />

                    <h3 style={{ margin: '14px 0 6px' }}>המחוונים שעיצבו אותו</h3>
                    <div className="small">
                      {game.spec.rewardChannels.map((c) => {
                        // The same 1-10 notch the slider showed, not the raw weight —
                        // otherwise the garage speaks a different language than setup.
                        const level = levelOf(c, m.rewards[c.key] ?? channelDefault(c));
                        const changed = level !== c.defaultLevel;
                        return (
                          <div className="row" key={c.key} style={{ justifyContent: 'space-between', padding: '2px 0' }}>
                            <span className={changed ? '' : 'muted'}>{c.label}</span>
                            <span className="mono" style={{ color: changed ? 'var(--accent-2)' : 'var(--muted)' }}>
                              {level} / {REWARD_LEVELS}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <h3 style={{ margin: '14px 0 6px' }}>פרטים</h3>
                    <div className="small muted">
                      {ALGORITHMS[m.algorithm]?.name} · {ALGORITHMS[m.algorithm]?.technical}
                    </div>
                    <div className="small muted">אומן על {game.describeConfig(m.config)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The circuit a model last trained on, for the one-line summary on its card. */
function trackName(config: Record<string, unknown>): string {
  return TRACK_DEFS.find((t) => t.id === config.trackId)?.name ?? '';
}

/**
 * What a model has done on one circuit, across every distance it ran there.
 *
 * Lap times compare across distances — a lap is a lap — so the quickest lap of
 * any session on that circuit is the honest headline. A race time does not: six
 * laps and ten are different races, so only the Grand Prix distance counts.
 */
function gpRecord(model: ModelMeta, trackId: string): { lapMs: number | null; raceMs: number | null } {
  let lapMs: number | null = null;
  let raceMs: number | null = null;
  for (const r of Object.values(model.training.records ?? {})) {
    if (r.trackId !== trackId) continue;
    if (r.bestLapMs != null && (lapMs === null || r.bestLapMs < lapMs)) lapMs = r.bestLapMs;
    if (r.laps === RACE_LAPS && r.bestRaceMs != null && (raceMs === null || r.bestRaceMs < raceMs)) {
      raceMs = r.bestRaceMs;
    }
  }
  return { lapMs, raceMs };
}

/**
 * Who steps aside so another model can race.
 *
 * Shown instead of a disabled button when a team is already fielding its two
 * cars. It lists the cars that are out there with the one thing that decides
 * between them — how quick each is on the circuit the next Grand Prix uses —
 * and picking one is the whole swap: that car comes off, this model goes on.
 */
function SwapDialog({
  model,
  cars,
  models,
  gpTrackId,
  onPick,
  onClose,
}: {
  model: ModelMeta;
  cars: ArenaEntry[];
  models: ModelMeta[];
  gpTrackId: string;
  onPick(out: ArenaEntry): void;
  onClose(): void;
}) {
  const byId = new Map(models.map((m) => [m.id, m]));
  const trackLabel = TRACK_DEFS.find((t) => t.id === gpTrackId)?.name ?? gpTrackId;
  return (
    <Modal eyebrow="הגריד מלא" title={`מי יורד כדי ש"${model.name}" יעלה?`} onClose={onClose}>
      <p className="small muted">
        לכל קבוצה {MAX_ENTRIES_PER_TEAM} רכבים על המסלול. הרכב שתבחרו יוסר מהאליפות — הנקודות שצבר
        בעונה נשארות ברשומות, אבל הוא לא ייקח חלק בסבבים הבאים. אפשר לרשום אותו שוב בכל רגע.
      </p>
      {cars.map((e) => {
        const m = byId.get(e.modelId);
        const gp = m ? gpRecord(m, gpTrackId) : { lapMs: null, raceMs: null };
        return (
          <div className="row wrap" key={e.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
            <DriverCell driver={e.driver} team={e.team} tag={e.tag} />
            <div style={{ flex: 1 }} />
            <span className="small muted">
              הקפה מהירה ב{trackLabel}{' '}
              <span className="mono" style={{ color: gp.lapMs != null ? 'var(--accent-2)' : 'var(--muted)' }}>
                {gp.lapMs != null ? lapTime(gp.lapMs) : '—'}
              </span>
            </span>
            <span className="mono small muted">{e.episodes.toLocaleString('he-IL')} אפ׳</span>
            <button className="danger small" onClick={() => onPick(e)}>
              הורד את {e.driver}
            </button>
          </div>
        );
      })}
    </Modal>
  );
}

/**
 * Every setup this model has a record on.
 *
 * Kept per track and per distance on purpose: a lap around the oval and a lap
 * around the mountain circuit are not comparable, and neither is a three-lap run
 * to a ten-lap one, so one global "best" would always belong to the easiest
 * setup the model ever touched.
 */
function RecordTable({ model }: { model: ModelMeta }) {
  const rows = Object.values(model.training.records ?? {}).sort((a, b) => b.at - a.at);
  if (rows.length === 0) {
    return <div className="small muted">עוד לא נקבע שיא. שיא נשמר בנפרד לכל מפה ולכל מספר הקפות.</div>;
  }
  return (
    <div className="small">
      <div className="row dim tiny" style={{ justifyContent: 'space-between' }}>
        <span>מסלול</span>
        <span>הקפה מהירה · מרוץ מלא</span>
      </div>
      {rows.map((r) => (
        <div className="row" key={r.trackId + r.laps} style={{ justifyContent: 'space-between', padding: '3px 0' }}>
          <span>
            {TRACK_DEFS.find((t) => t.id === r.trackId)?.name ?? r.trackId}
            <span className="dim"> · {r.laps} הקפות</span>
          </span>
          <span className="mono">
            <span style={{ color: 'var(--accent-2)' }}>{lapTime(r.bestLapMs)}</span>
            <span className="dim"> · {raceTime(r.bestRaceMs)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { Modal } from '../components/Modal';
import { useTrainer } from '../useTrainer';
import { Canvas } from '../components/Canvas';
import { LineChart } from '../components/LineChart';
import { RewardEditor } from '../components/RewardEditor';
import { drawPlaceholder, renderGame } from '../gameRenderers';
import { CAR_COLORS } from '../../core/games/racing/render';
import { saveModel } from '../saveModel';
import { getStore, recordKey, type SetupRecord, type TrainingPoint } from '../../storage';
import type { SpeedMode, TrainInit, TrainSlotInit } from '../../workers/protocol';
import { getArena } from '../../storage/arena';
import { ALGORITHMS } from '../../core/rl/algorithms';
import { useWakeLock } from '../device';
import { durationText, lapTime, raceTime } from '../format';
import { PHYSICS_VERSION, type RacingSnapshot } from '../../core/games/racing/env';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import { CoachAnchor, useCoachStep } from '../coach';
import { track } from '../../storage/metrics';
import { useChampionship } from '../useChampionship';
import { trainingTarget, type TrainingTarget } from '../../core/champ/records';

/** Finish and go, a checkpoint from the button, or one taken because the page was hidden. */
type SaveMode = 'leave' | 'checkpoint' | 'quiet';

const SPEEDS: Array<{ id: SpeedMode; label: string; hint: string }> = [
  { id: 'watch', label: '×1', hint: 'זמן אמת - לראות מה המודל עושה' },
  { id: 'fast', label: '×4', hint: 'מואץ פי ארבעה, עדיין מצויר' },
  { id: 'turbo', label: 'טורבו', hint: 'ללא ציור וללא הגבלת קצב - מהיר ככל שהמעבד מרשה' },
];

/** What the boot step recovered about one model before training started. */
interface SlotBoot {
  savedId: string | null;
  createdAt?: number;
  baseTrainedMs: number;
  /** Points inherited from earlier runs; only later ones may set a record. */
  resumeLength: number;
  records: Record<string, SetupRecord>;
}

export function TrainDashboard() {
  const { gameId, draft, patchSlot, showToast } = useApp();
  const coach = useCoachStep();
  const game = getGame(gameId);
  const trainer = useTrainer();
  const { status, slots: live, seats, error, speed, snapRef } = trainer;

  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  /** History length at the last save, per model: anything past it is unsaved. */
  const savedLen = useRef<number[]>([]);
  const dirtyRef = useRef(false);
  const [tab, setTab] = useState(0);
  /** Per model, where on the chart its sliders last changed - the points are counted differently from there. */
  const [retuned, setRetuned] = useState<Record<number, number>>({});
  const boot = useRef<SlotBoot[]>([]);
  const started = useRef(false);

  const models = draft.slots;
  const multi = models.length > 1;
  const slotIndex = Math.min(tab, models.length - 1);

  // Boot: when continuing, pull the saved weights in before starting the worker.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const store = await getStore();
      const inits: TrainSlotInit[] = [];
      const histories: TrainingPoint[][] = [];

      for (const slot of models) {
        const state: SlotBoot = { savedId: null, baseTrainedMs: 0, resumeLength: 0, records: {} };
        const init: TrainSlotInit = {
          algorithm: slot.algorithm,
          rewards: slot.rewards,
          hyper: draft.hyper,
          gaHyper: draft.gaHyper,
        };
        let history: TrainingPoint[] = [];

        if (slot.modelId) {
          state.savedId = slot.modelId;
          const rec = await store.load(slot.modelId);
          if (rec && !slot.restart) {
            if (rec.obsVersion !== game.spec.obsVersion || rec.arch.obsSize !== game.spec.obsSize) {
              showToast(`${rec.name} אומן על גרסת תצפית ישנה - מתחילים מאפס`);
            } else {
              init.weightsB64 = rec.weightsB64;
              init.envSteps = rec.training.envSteps;
              init.gradSteps = rec.training.gradSteps;
              init.episode = rec.training.episodes;
              history = rec.training.history;
              state.createdAt = rec.createdAt;
              state.baseTrainedMs = rec.training.trainedMs;
            }
          }
          // Records survive a restart from scratch: they say what this model has
          // ever done on a setup, and wiping the weights does not undo that.
          if (rec) state.records = rec.training.records ?? {};
        }

        state.resumeLength = history.length;
        savedLen.current.push(history.length);
        boot.current.push(state);
        inits.push(init);
        histories.push(history);
      }

      // A championship car to race against: its weights, frozen, in the last
      // seat. One more car on the grid so it never takes a learner's place.
      let rivals: TrainInit['rivals'] = [];
      let config = draft.config;
      if (draft.rival && gameId === 'racing') {
        try {
          const arena = await getArena();
          const w = await arena.loadEntryWeights(draft.rival.entryId);
          if (w) {
            rivals = [{ ...draft.rival.arch, weightsB64: w }];
            const cars = Number(config.nCars ?? 1);
            config = { ...config, nCars: Math.max(cars, models.length + 1) };
          } else {
            showToast('לא הצלחתי לטעון את היריב - מתאמנים בלעדיו');
          }
        } catch {
          showToast('לא הצלחתי לטעון את היריב - מתאמנים בלעדיו');
        }
      }

      trainer.init(
        {
          gameId,
          config,
          seed: Math.floor(Math.random() * 1e9),
          slots: inits,
          speed: 'fast',
          rivals,
        },
        histories,
      );
      setBooting(false);
      trainer.play();
      track('train');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = status === 'running';
  // A sleeping phone throttles the worker to a halt mid-run.
  useWakeLock(running);

  // The time limit chosen in setup: when it runs out, stop and save, and stay
  // here so "continue" is one tap away. Checked once a second; the save is the
  // same one the button does.
  const limitMs = (draft.timeLimitMin ?? 0) * 60_000;
  const limitHit = useRef(false);
  // The latest `save`, so the timer saves today's history and not the first render's.
  const saveRef = useRef<(mode: SaveMode) => Promise<void>>(async () => {});
  const [, tick] = useState(0);
  useEffect(() => {
    if (!limitMs) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (limitHit.current || status !== 'running' || trainer.elapsedMs() < limitMs) return;
      limitHit.current = true;
      trainer.pause();
      void saveRef.current('checkpoint').then(() => showToast(`${draft.timeLimitMin} דקות הסתיימו - המודל נשמר. אפשר להמשיך או לסיים.`));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitMs, status]);
  const remainingMs = limitMs ? Math.max(0, limitMs - trainer.elapsedMs()) : null;

  const save = async (mode: SaveMode) => {
    const thenLeave = mode === 'leave';
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = await trainer.requestWeights();
      const saved: string[] = [];
      for (let i = 0; i < models.length; i++) {
        const slot = models[i];
        const w = payload[i];
        const state = boot.current[i];
        if (!w || !state) continue;
        const rec = await saveModel({
          id: state.savedId,
          name: slot.name,
          owner: draft.owner,
          gameId,
          algorithm: slot.algorithm,
          config: draft.config,
          rewards: slot.rewards,
          hyper: slot.algorithm === 'ga' ? draft.gaHyper : draft.hyper,
          history: live[i]?.history ?? [],
          sessionStart: state.resumeLength,
          priorRecords: state.records,
          weightsB64: w.weightsB64,
          envSteps: w.envSteps,
          gradSteps: w.gradSteps,
          episodes: w.episode,
          trainedMs: state.baseTrainedMs + trainer.elapsedMs(),
          createdAt: state.createdAt,
        });
        state.savedId = rec.id;
        state.createdAt = rec.createdAt;
        state.records = rec.training.records ?? {};
        savedLen.current[i] = live[i]?.history.length ?? 0;
        patchSlot(i, { modelId: rec.id, restart: false });
        saved.push(rec.name);
      }
      dirtyRef.current = false;
      track('save');
      showToast(
        thenLeave
          ? `נשמר: ${saved.join(' · ')}`
          : mode === 'quiet'
            ? 'האימון נשמר אוטומטית'
            : saved.length > 1
              ? `${saved.length} המודלים נשמרו - האימון ממשיך`
              : 'נשמר - האימון ממשיך',
      );
      if (thenLeave) leaveNow(leaveTo?.run ?? (() => useApp.getState().go('library')));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'השמירה נכשלה');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  saveRef.current = save;

  /**
   * Leaving with progress nobody saved.
   *
   * Training lives in a worker that dies with this screen, so a tap on another
   * tab used to throw the run away without a word. Now every way out asks
   * first - save and go, go anyway, or stay - and a page that is hidden (the
   * phone locked, another app opened, another browser tab) saves by itself,
   * because a hidden page is one the browser may kill without asking anybody.
   */
  const dirty = !booting && live.some((sl, i) => sl.history.length > (savedLen.current[i] ?? 0));
  dirtyRef.current = dirty;
  /** The navigation waiting on the "save before leaving?" question. */
  const [leaveTo, setLeaveTo] = useState<{ run: () => void } | null>(null);
  const setLeaveGuard = useApp((st) => st.setLeaveGuard);
  const leaveNow = (proceed: () => void) => {
    setLeaveGuard(null);
    setLeaveTo(null);
    proceed();
  };
  useEffect(() => {
    setLeaveGuard((proceed) => {
      if (!dirtyRef.current) return true;
      setLeaveTo({ run: proceed });
      return false;
    });
    return () => setLeaveGuard(null);
  }, [setLeaveGuard]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void saveRef.current('quiet');
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  /** Colour every car by the model driving it, so interference is visible. */
  const carColors = useMemo(() => {
    const out: string[] = [];
    seats.forEach((group, slot) => {
      for (const seat of group) out[seat] = CAR_COLORS[slot % CAR_COLORS.length];
    });
    return out;
  }, [seats]);

  const hasLaps = gameId === 'racing';
  const slot = models[slotIndex];
  const slotLive = live[slotIndex];
  const history = slotLive?.history ?? [];
  const algo = ALGORITHMS[slot.algorithm];

  const charts = useMemo(
    () => ({
      rewards: history.map((p) => p.reward),
      // Missing laps break the line rather than drawing a zero, which would look
      // like an impossibly fast lap.
      laps: history.map((p) => (p.bestLapMs ?? NaN) / 1000),
    }),
    [history],
  );

  /**
   * Records for the setup being driven right now, merged with what this model
   * already held on the same track and distance. A lap on another circuit is a
   * different record and never shows up here.
   */
  const records = useMemo(() => {
    const prior = boot.current[slotIndex]?.records?.[recordKey(String(draft.config.trackId ?? ''), Number(draft.config.laps ?? 0))];
    let lap: number | null = prior?.bestLapMs ?? null;
    let race: number | null = prior?.bestRaceMs ?? null;
    const from = boot.current[slotIndex]?.resumeLength ?? 0;
    for (let i = from; i < history.length; i++) {
      const p = history[i];
      if (p.bestLapMs != null && (lap === null || p.bestLapMs < lap)) lap = p.bestLapMs;
      if (p.bestRaceMs != null && (race === null || p.bestRaceMs < race)) race = p.bestRaceMs;
    }
    return { lap, race };
  }, [history, slotIndex, draft.config]);

  /**
   * Milestones, said once each as they happen. Watching a curve creep is
   * abstract; "first full lap" is the moment people tell somebody about.
   */
  const told = useRef(new Map<number, { lap: boolean; race: boolean; target: boolean }>());
  const announce = useRef<(lap: number | null, race: number | null, targetMs: number | null) => void>(() => {});
  announce.current = (lap, race, targetMs) => {
    const was = told.current.get(slotIndex);
    const now = { lap: lap !== null, race: race !== null, target: lap !== null && targetMs !== null && lap <= targetMs };
    told.current.set(slotIndex, now);
    // The first look at a model only records where it already is.
    if (!was) return;
    const who = slot.name || `מודל ${slotIndex + 1}`;
    if (now.target && !was.target) showToast(`⚡ ${who} מהיר מהיעד!`);
    else if (now.race && !was.race) showToast(`🏁 ${who} סיים מרוץ מלא!`);
    else if (now.lap && !was.lap) showToast(`🎉 ההקפה השלמה הראשונה של ${who}!`);
  };

  // The season is usually already loaded by the time anybody trains - the app
  // opens on the championship - so this costs nothing in the common case.
  const champ = useChampionship().state;
  const target = useMemo(() => {
    if (!hasLaps || !champ) return null;
    const physics = Number(draft.config.physics ?? PHYSICS_VERSION);
    return trainingTarget(champ.cards, champ.results, String(draft.config.trackId ?? ''), physics, Date.now());
  }, [champ, hasLaps, draft.config]);

  useEffect(() => {
    if (hasLaps && !booting) announce.current(records.lap, records.race, target?.ms ?? null);
  }, [records.lap, records.race, target, hasLaps, booting]);

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">
            אימון · {game.describeConfig(draft.config)}
            {draft.owner ? ` · ${draft.owner}` : ''}
          </div>
          <h1 className="display">{multi ? `${models.length} מודלים יחד` : slot.name || 'אימון'}</h1>
          <div className="row wrap small muted">
            {status === 'error' && <span className="pill warn">שגיאה: {error}</span>}
            {booting && <span className="pill">מאתחל…</span>}
            {draft.rival && (
              <span className="pill" title="רכב מהאליפות, קפוא, במושב האחרון">
                🏁 יריב: {draft.rival.driver} · {draft.rival.team}
              </span>
            )}
            {remainingMs !== null && !limitHit.current && (
              <span className="pill" title="עצירה ושמירה אוטומטית">
                ⏱ <span className="mono">{durationText(remainingMs)}</span> עד שמירה
              </span>
            )}
            {limitHit.current && <span className="pill good">הזמן נגמר - נשמר</span>}
          </div>
        </div>
        <div className="actions">
          <div className="segmented">
            {SPEEDS.map((s) => (
              <button
                key={s.id}
                title={s.hint}
                className={speed === s.id ? 'on' : ''}
                onClick={() => trainer.setSpeed(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button onClick={() => (running ? trainer.pause() : trainer.play())} disabled={booting || status === 'error'}>
            {running ? '⏸ השהה' : '▶ המשך'}
          </button>
          <button onClick={() => save('checkpoint')} disabled={saving || booting}>
            שמירה באמצע
          </button>
          <CoachAnchor
            step={coach === 'save' ? coach : null}
            text="הרכב מתאמן מול העיניים - אפשר לצפות, להזיז מחוונים ולתת לו זמן. כשאתם מרוצים מהנהג, לחצו סיים ושמור."
          >
            <button className="primary" onClick={() => save('leave')} disabled={saving || booting}>
              {saving ? 'שומר…' : 'סיים ושמור'}
            </button>
          </CoachAnchor>
        </div>
      </div>

      {leaveTo && (
        <Modal
          eyebrow="האימון עדיין רץ"
          title="לשמור לפני שיוצאים?"
          onClose={() => setLeaveTo(null)}
          footer={
            <>
              <button className="ghost" onClick={() => setLeaveTo(null)}>
                להמשיך לאמן
              </button>
              <button onClick={() => leaveNow(leaveTo.run)}>לצאת בלי לשמור</button>
              <button className="primary" disabled={saving} onClick={() => void save('leave')}>
                {saving ? 'שומר…' : 'לשמור ולצאת'}
              </button>
            </>
          }
        >
          <p className="small" style={{ margin: 0 }}>
            האימון רץ רק כשהמסך הזה פתוח. יציאה עוצרת אותו, ומה שהמודל למד מאז השמירה האחרונה יאבד אם לא
            תשמרו.
          </p>
        </Modal>
      )}

      <div className="split-main">
        <div className="grid">
          <div style={{ position: 'relative' }}>
            <Canvas
              aspect={16 / 10}
              draw={(ctx) => {
                const snap = snapRef.current;
                if (speed === 'turbo' && !snap) {
                  drawPlaceholder(ctx, ['מצב טורבו - מאמן הכי מהר', 'תמונה מהמסלול פעם בשנייה.']);
                  return;
                }
                if (!snap) {
                  drawPlaceholder(ctx, ['ממתין לסימולציה…']);
                  return;
                }
                renderGame(gameId, ctx, snap, { showSensors: true, dimDone: true, colors: carColors });
              }}
            />
            {hasLaps && speed !== 'turbo' && <LiveTiming snapRef={snapRef} />}
            {speed === 'turbo' && (
              <div className="stage-overlay-end">
                <span className="pill">⚡ טורבו · תמונה פעם בשנייה</span>
              </div>
            )}
          </div>

          {multi && (
            <div className="card notched">
              <div className="eyebrow" style={{ marginBottom: 8 }}>מי נוהג במה</div>
              <div className="row wrap">
                {models.map((m, i) => (
                  <span key={i} className="pill small">
                    <span
                      className="livery"
                      style={{ background: CAR_COLORS[i % CAR_COLORS.length], width: 4, height: 12 }}
                    />
                    {m.name || `מודל ${i + 1}`}
                    <span className="dim"> · {(seats[i] ?? []).map((s) => s + 1).join(', ') || '-'}</span>
                  </span>
                ))}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                הרכבים מחולקים בין המודלים. מה שקורה ביניהם על המסלול הוא חלק מהאימון של כולם.
              </div>
            </div>
          )}

          <div className="card notched">
            {multi && <ModelTabs models={models} current={slotIndex} onPick={setTab} />}
            <div className="head">
              <div className="eyebrow">ההתקדמות של {slot.name || `מודל ${slotIndex + 1}`}</div>
            </div>
            <div className="small muted" style={{ marginBottom: 4 }}>
              נקודות ל{algo.episodeLabel} - כמה הוא צובר לפי המחוונים שלו
            </div>
            <LineChart
              height={140}
              marker={retuned[slotIndex]}
              series={[{ label: 'reward', color: '--accent-2', values: charts.rewards }]}
            />
            {retuned[slotIndex] !== undefined && (
              <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                הקו המקווקו: כאן שיניתם מחוונים. מאז הנקודות נספרות אחרת, אז קפיצה
                בקו הזה לא אומרת שהנהיגה השתנתה - את זה מראה גרף ההקפה.
              </div>
            )}

            {hasLaps && (
              <>
                <div className="small muted" style={{ marginTop: 10 }}>
                  ההקפה המהירה שלו ל{algo.episodeLabel} (שניות) - זה מה שהאליפות מודדת
                </div>
                <LineChart
                  height={110}
                  nonNegative
                  emptyText="עוד אין הקפה שלמה - הקו יופיע אחרי ההקפה הראשונה"
                  series={[{ label: 'lap', color: '--purple', values: charts.laps }]}
                />
              </>
            )}
          </div>
        </div>

        <div className="grid">
          {multi && (
            <div className="card notched" style={{ paddingBottom: 6 }}>
              <ModelTabs models={models} current={slotIndex} onPick={setTab} />
            </div>
          )}

          {hasLaps && (
            <div className="card notched">
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                השיאים שלו על {setupLabel(draft.config)}
              </div>
              <div className="cols-2">
                <Stat k="הקפה מהירה" v={lapTime(records.lap)} accent />
                <Stat k="מרוץ מלא" v={raceTime(records.race)} />
              </div>
              {target && <TargetLine target={target} lap={records.lap} />}
              <div className="small muted" style={{ marginTop: 8 }}>
                {records.race === null
                  ? `עוד לא הושלמו ${String(draft.config.laps ?? 3)} הקפות ברצף. השיא ייקבע ברגע שהרכב יראה את הדגל המשובץ.`
                  : `שיא נשמר בנפרד לכל מפה ולכל מספר הקפות - מסלול אחר הוא שיא אחר.`}
              </div>
            </div>
          )}

          {/* Only numbers somebody can act on. Exploration rate, steps per second
              and the best reward ever scored describe the machinery, not the
              driver - none of them says whether to keep training or what to
              change, and the README promises a screen without them. */}
          <div className="card notched">
            <div className="cols-3">
              <Stat k={algo.episodesLabel} v={(slotLive?.live.episode ?? 0).toLocaleString('he-IL')} />
              <Stat k={`${game.spec.scoreLabel} בניסיון האחרון`} v={history.length ? history[history.length - 1].score.toFixed(1) : '-'} />
              <Stat k="זמן אימון" v={durationText((boot.current[slotIndex]?.baseTrainedMs ?? 0) + trainer.elapsedMs())} />
            </div>
          </div>

          <UnderTheHood
            algorithm={slot.algorithm}
            hidden={slot.algorithm === 'ga' ? draft.gaHyper.hidden : draft.hyper.hidden}
            obsSize={game.spec.obsSize}
            actions={game.spec.actions}
            extra={
              slot.algorithm === 'ga'
                ? [
                    ['גודל אוכלוסייה', String(draft.gaHyper.populationSize)],
                    ['שורדים בכל דור', `${Math.round(draft.gaHyper.eliteFraction * 100)}%`],
                    ['עוצמת מוטציה', String(draft.gaHyper.mutationScale)],
                  ]
                : [
                    ['קצב למידה', String(draft.hyper.lr)],
                    ['gamma', String(draft.hyper.gamma)],
                    ['batch', String(draft.hyper.batchSize)],
                    ['זיכרון חוויות', draft.hyper.bufferSize.toLocaleString('he-IL')],
                    ['epsilon', `${draft.hyper.epsStart} עד ${draft.hyper.epsEnd}`],
                  ]
            }
          />

          <div className="card notched">
            {multi && (
              <div className="small" style={{ marginBottom: 8 }}>
                המחוונים של <b>{slot.name || `מודל ${slotIndex + 1}`}</b> בלבד - שינוי כאן לא נוגע במודלים האחרים
              </div>
            )}
            <RewardEditor
              key={slotIndex}
              spec={game.spec}
              value={slot.rewards}
              live
              onChange={(rewards) => {
                setRetuned((r) => ({ ...r, [slotIndex]: live[slotIndex]?.history.length ?? 0 }));
                patchSlot(slotIndex, { rewards });
                trainer.setRewards(slotIndex, rewards);
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function ModelTabs({
  models,
  current,
  onPick,
}: {
  models: Array<{ name: string }>;
  current: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="segmented" style={{ width: '100%', marginBottom: 10 }}>
      {models.map((m, i) => (
        <button key={i} style={{ flex: 1 }} className={i === current ? 'on' : ''} onClick={() => onPick(i)}>
          <span
            className="livery"
            style={{ background: CAR_COLORS[i % CAR_COLORS.length], width: 4, height: 10, marginInlineEnd: 6 }}
          />
          {m.name || `מודל ${i + 1}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Live lap timing over the training canvas.
 *
 * Reward curves say whether a model is improving; a lap time says how fast it
 * actually is, in the same unit the championship will judge it in. Reads the
 * snapshot ref directly rather than subscribing, because snapshots arrive far
 * faster than this needs to redraw.
 */
function LiveTiming({ snapRef }: { snapRef: React.RefObject<unknown> }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);

  const snap = snapRef.current as RacingSnapshot | null;
  if (!snap || !snap.cars?.length) return null;
  const leader = snap.cars[snap.order[0]];
  if (!leader) return null;

  return (
    <div className="stage-overlay-end train-timing">
      <div className="pill mono" title="זמן הניסיון הנוכחי">
        {raceTime(snap.raceMs)}
      </div>
      <div className="pill" title="ההקפה שהמוביל נוסע עכשיו">
        הקפה <span className="mono">{leader.lap + 1}</span>/{snap.laps} ·{' '}
        <span className="mono">{lapTime(leader.currentLapMs)}</span>
      </div>
      {snap.fastestLap && (
        <div className="pill" style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }}>
          מהירה בניסיון · <span className="mono">{lapTime(snap.fastestLap.ms)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * What a record belongs to: the circuit and the distance, and nothing else. The
 * number of cars or whether contact is on changes the traffic, not the yardstick.
 */
function setupLabel(config: Record<string, unknown>): string {
  const track = TRACK_DEFS.find((t) => t.id === config.trackId)?.name ?? String(config.trackId ?? '');
  return `${track} · ${String(config.laps ?? '?')} הקפות`;
}

/**
 * The one number that says when a model is good enough: how far its best lap is
 * from the pole of the last Grand Prix on this circuit.
 */
function TargetLine({ target, lap }: { target: TrainingTarget; lap: number | null }) {
  const gap = lap === null ? null : (lap - target.ms) / 1000;
  const label =
    target.kind === 'pole' ? `ההקפה הכי מהירה במוקדמות של ${target.raceName} (סבב ${target.round})` : 'שיא ההקפה במסלול';
  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div>
        {label}: <span className="mono" style={{ color: 'var(--purple)' }}>{lapTime(target.ms)}</span>
        <span className="dim"> · {target.driver}</span>
        {' · '}שלכם: <span className="mono">{lapTime(lap)}</span>
        {gap !== null && (
          <>
            {' · '}
            <b className="mono" style={{ color: gap <= 0 ? 'var(--good)' : 'var(--warn)' }}>
              {gap <= 0 ? `מהיר ב-${(-gap).toFixed(1)} שנ׳` : `+${gap.toFixed(1)} שנ׳`}
            </b>
          </>
        )}
      </div>
      {!target.samePhysics && (
        <div className="dim tiny" style={{ marginTop: 2 }}>
          נקבע לפני שינוי בהתנהגות הרכבים, אז היעד האמיתי כנראה קצת איטי יותר.
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v" style={accent ? { color: 'var(--accent-2)' } : undefined}>
        {v}
      </div>
    </div>
  );
}

/**
 * For whoever wants to know what is actually running. Folded by default: the
 * screen is built around the sliders, and none of this is a setting - but a
 * student who knows what a Q-network is asked where it was.
 */
function UnderTheHood({
  algorithm,
  hidden,
  obsSize,
  actions,
  extra,
}: {
  algorithm: keyof typeof ALGORITHMS;
  hidden: number[];
  obsSize: number;
  actions: readonly string[];
  extra: Array<[string, string]>;
}) {
  const algo = ALGORITHMS[algorithm];
  return (
    <details className="card notched under-hood">
      <summary className="eyebrow">מאחורי הקלעים</summary>
      <div className="small" style={{ display: 'grid', gap: 4, marginTop: 10 }}>
        <div>
          שיטה: <b>{algo.name}</b> <span className="muted">({algo.technical})</span>
        </div>
        <div>
          רשת: <span className="mono" dir="ltr">{[obsSize, ...hidden, actions.length].join(' → ')}</span>
        </div>
        <div>
          קלט: <span className="mono">{obsSize}</span> מספרים - חיישני מרחק לקיר, מהירות, כיוון והרכבים הקרובים
        </div>
        <div>
          פעולות ({actions.length}): <span className="muted">{actions.join(' · ')}</span>
        </div>
        {extra.map(([k, v]) => (
          <div key={k}>
            {k}: <span className="mono">{v}</span>
          </div>
        ))}
        <div className="muted">
          הנקודות בכל צעד הן סכום המחוונים כפול מה שקרה בצעד הזה (התקדמות, מהירות, פגיעות וכו׳). המשקל
          של כל דרגה במחוון קבוע בקוד.
        </div>
      </div>
    </details>
  );
}

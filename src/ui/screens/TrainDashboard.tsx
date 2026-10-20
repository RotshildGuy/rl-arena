import { useEffect, useMemo, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { useApp } from '../store';
import { useTrainer } from '../useTrainer';
import { Canvas } from '../components/Canvas';
import { LineChart } from '../components/LineChart';
import { RewardEditor } from '../components/RewardEditor';
import { drawPlaceholder, renderGame } from '../gameRenderers';
import { CAR_COLORS } from '../../core/games/racing/render';
import { saveModel } from '../saveModel';
import { getStore, recordKey, type SetupRecord, type TrainingPoint } from '../../storage';
import type { SpeedMode, TrainSlotInit } from '../../workers/protocol';
import { ALGORITHMS } from '../../core/rl/algorithms';
import { useWakeLock } from '../device';
import { durationText, lapTime, raceTime } from '../format';
import { PHYSICS_VERSION, type RacingSnapshot } from '../../core/games/racing/env';
import { TRACK_DEFS } from '../../core/games/racing/tracks';
import { CoachAnchor, useCoachStep } from '../coach';
import { track } from '../../storage/metrics';
import { useChampionship } from '../useChampionship';
import { trainingTarget, type TrainingTarget } from '../../core/champ/records';

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
  const { gameId, draft, patchSlot, go, showToast } = useApp();
  const coach = useCoachStep();
  const game = getGame(gameId);
  const trainer = useTrainer();
  const { status, slots: live, seats, error, speed, snapRef } = trainer;

  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(0);
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
        boot.current.push(state);
        inits.push(init);
        histories.push(history);
      }

      trainer.init(
        {
          gameId,
          config: draft.config,
          seed: Math.floor(Math.random() * 1e9),
          slots: inits,
          speed: 'fast',
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

  const save = async (thenLeave: boolean) => {
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
        patchSlot(i, { modelId: rec.id, restart: false });
        saved.push(rec.name);
      }
      track('save');
      showToast(thenLeave ? `נשמר: ${saved.join(' · ')}` : `נקודת שמירה נוצרה ל-${saved.length} מודלים`);
      if (thenLeave) go('library');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

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

  // The season is usually already loaded by the time anybody trains - the app
  // opens on the championship - so this costs nothing in the common case.
  const champ = useChampionship().state;
  const target = useMemo(() => {
    if (!hasLaps || !champ) return null;
    const physics = Number(draft.config.physics ?? PHYSICS_VERSION);
    return trainingTarget(champ.cards, champ.results, String(draft.config.trackId ?? ''), physics, Date.now());
  }, [champ, hasLaps, draft.config]);

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
          <button onClick={() => save(false)} disabled={saving || booting}>
            נקודת שמירה
          </button>
          <CoachAnchor
            on={coach === 'save'}
            text="הרכב לומד תוך כדי נסיעה - אפשר לצפות, להזיז מחוונים ולתת לו זמן. כשאתם מרוצים מהנהג, לחצו סיים ושמור."
          >
            <button className="primary" onClick={() => save(true)} disabled={saving || booting}>
              {saving ? 'שומר…' : 'סיים ושמור'}
            </button>
          </CoachAnchor>
        </div>
      </div>

      <div className="split-main">
        <div className="grid">
          <div style={{ position: 'relative' }}>
            <Canvas
              aspect={16 / 10}
              draw={(ctx) => {
                if (speed === 'turbo') {
                  drawPlaceholder(ctx, ['מצב טורבו', 'הציור כבוי כדי לפנות את המעבד לאימון']);
                  return;
                }
                const snap = snapRef.current;
                if (!snap) {
                  drawPlaceholder(ctx, ['ממתין לסימולציה…']);
                  return;
                }
                renderGame(gameId, ctx, snap, { showSensors: true, dimDone: true, colors: carColors });
              }}
            />
            {hasLaps && speed !== 'turbo' && <LiveTiming snapRef={snapRef} />}
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
            <LineChart height={140} series={[{ label: 'reward', color: '--accent-2', values: charts.rewards }]} />

            {hasLaps && (
              <>
                <div className="small muted" style={{ marginTop: 10 }}>
                  ההקפה המהירה שלו ל{algo.episodeLabel} (שניות) - זה מה שהאליפות מודדת
                </div>
                <LineChart height={110} series={[{ label: 'lap', color: '--purple', values: charts.laps }]} />
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
              <Stat k={game.spec.scoreLabel} v={history.length ? history[history.length - 1].score.toFixed(2) : '-'} />
              <Stat k="זמן אימון" v={durationText((boot.current[slotIndex]?.baseTrainedMs ?? 0) + trainer.elapsedMs())} />
            </div>
          </div>

          <div className="card notched">
            <RewardEditor
              spec={game.spec}
              value={slot.rewards}
              live
              onChange={(rewards) => {
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
    <div className="stage-overlay-end" style={{ display: 'grid', gap: 5, justifyItems: 'end' }}>
      <div className="pill mono" title="זמן האפיזודה">
        {raceTime(snap.raceMs)}
      </div>
      <div className="pill" title="ההקפה שהמוביל נוסע עכשיו">
        הקפה <span className="mono">{leader.lap + 1}</span>/{snap.laps} ·{' '}
        <span className="mono">{lapTime(leader.currentLapMs)}</span>
      </div>
      {snap.fastestLap && (
        <div className="pill" style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }}>
          מהירה באפיזודה · <span className="mono">{lapTime(snap.fastestLap.ms)}</span>
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
  const label = target.kind === 'pole' ? `הפול של ${target.raceName} (סבב ${target.round})` : 'שיא ההקפה במסלול';
  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div>
        {label}: <span className="mono" style={{ color: 'var(--purple)' }}>{lapTime(target.ms)}</span>
        <span className="dim"> · {target.driver}</span>
        {' · '}אתה: <span className="mono">{lapTime(lap)}</span>
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
          נקבע בפיזיקה הקודמת, כשהצמיגים לא החליקו - היעד האמיתי כנראה איטי יותר.
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

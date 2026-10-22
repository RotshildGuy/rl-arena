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
import { locale, t as words, useT } from '../../i18n';
import { driverName, grandPrixTitle, teamName, trackName } from '../../i18n/names';
import { isolated, Ltr, Name } from '../components/Name';

/** Finish and go, a checkpoint from the button, or one taken because the page was hidden. */
type SaveMode = 'leave' | 'checkpoint' | 'quiet';

/** In the order they are shown; labels and hints are in the dictionary (`dashboard.speeds`). */
const SPEEDS: SpeedMode[] = ['watch', 'fast', 'turbo'];

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
  const d = useT().dashboard;
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
              showToast(words().dashboard.oldObs(rec.name));
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
            showToast(words().dashboard.noRival);
          }
        } catch {
          showToast(words().dashboard.noRival);
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
      void saveRef.current('checkpoint').then(() => showToast(words().dashboard.timeUp(draft.timeLimitMin)));
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
          ? words().dashboard.savedList(saved.join(' · '))
          : mode === 'quiet'
            ? words().dashboard.autoSaved
            : saved.length > 1
              ? words().dashboard.savedMany(saved.length)
              : words().dashboard.savedOne,
      );
      if (thenLeave) leaveNow(leaveTo?.run ?? (() => useApp.getState().go('library')));
    } catch (e) {
      showToast(e instanceof Error ? e.message : words().dashboard.saveFailed);
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
    const w = words().dashboard;
    const who = slot.name || w.model(slotIndex + 1);
    if (now.target && !was.target) showToast(w.beatTarget(who));
    else if (now.race && !was.race) showToast(w.fullRace(who));
    else if (now.lap && !was.lap) showToast(w.firstLap(who));
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
            {d.training} · {game.describeConfig(draft.config)}
            {draft.owner ? ` · ${draft.owner}` : ''}
          </div>
          <h1 className="display">{multi ? d.together(models.length) : slot.name || d.training}</h1>
          <div className="row wrap small muted">
            {status === 'error' && <span className="pill warn">{d.error(error ?? '')}</span>}
            {booting && <span className="pill">{d.booting}</span>}
            {draft.rival && (
              <span className="pill" title={d.rivalTitle}>
                {d.rival(isolated(draft.rival.driver), isolated(teamName(draft.rival.team)))}
              </span>
            )}
            {remainingMs !== null && !limitHit.current && (
              <span className="pill" title={d.autoStop}>
                ⏱ <span className="mono">{durationText(remainingMs)}</span> {d.untilSave}
              </span>
            )}
            {limitHit.current && <span className="pill good">{d.timeUpSaved}</span>}
          </div>
        </div>
        <div className="actions">
          <div className="segmented">
            {SPEEDS.map((id) => (
              <button
                key={id}
                title={d.speeds[id].hint}
                className={speed === id ? 'on' : ''}
                onClick={() => trainer.setSpeed(id)}
              >
                {d.speeds[id].label}
              </button>
            ))}
          </div>
          <button onClick={() => (running ? trainer.pause() : trainer.play())} disabled={booting || status === 'error'}>
            {running ? d.pause : d.resume}
          </button>
          <button onClick={() => save('checkpoint')} disabled={saving || booting}>
            {d.checkpoint}
          </button>
          <CoachAnchor
            step={coach === 'save' ? coach : null}
            text={d.coach}
          >
            <button className="primary" onClick={() => save('leave')} disabled={saving || booting}>
              {saving ? d.saving : d.finish}
            </button>
          </CoachAnchor>
        </div>
      </div>

      {leaveTo && (
        <Modal
          eyebrow={d.stillRunning}
          title={d.saveFirst}
          onClose={() => setLeaveTo(null)}
          footer={
            <>
              <button className="ghost" onClick={() => setLeaveTo(null)}>
                {d.keepTraining}
              </button>
              <button onClick={() => leaveNow(leaveTo.run)}>{d.leaveNoSave}</button>
              <button className="primary" disabled={saving} onClick={() => void save('leave')}>
                {saving ? d.saving : d.saveLeave}
              </button>
            </>
          }
        >
          <p className="small" style={{ margin: 0 }}>
            {d.leaveWarning}
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
                  drawPlaceholder(ctx, [words().dashboard.turboTitle, words().dashboard.turboNote]);
                  return;
                }
                if (!snap) {
                  drawPlaceholder(ctx, [words().dashboard.waiting]);
                  return;
                }
                renderGame(gameId, ctx, snap, { showSensors: true, dimDone: true, colors: carColors });
              }}
            />
            {hasLaps && speed !== 'turbo' && <LiveTiming snapRef={snapRef} />}
            {speed === 'turbo' && (
              <div className="stage-overlay-end">
                <span className="pill">{d.turboPill}</span>
              </div>
            )}
          </div>

          {multi && (
            <div className="card notched">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{d.whoDrives}</div>
              <div className="row wrap">
                {models.map((m, i) => (
                  <span key={i} className="pill small">
                    <span
                      className="livery"
                      style={{ background: CAR_COLORS[i % CAR_COLORS.length], width: 4, height: 12 }}
                    />
                    {m.name || d.model(i + 1)}
                    <span className="dim"> · {(seats[i] ?? []).map((s) => s + 1).join(', ') || '-'}</span>
                  </span>
                ))}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {d.shared}
              </div>
            </div>
          )}

          <div className="card notched">
            {multi && <ModelTabs models={models} current={slotIndex} onPick={setTab} />}
            <div className="head">
              <div className="eyebrow">{d.progressOf(slot.name || d.model(slotIndex + 1))}</div>
            </div>
            <div className="small muted" style={{ marginBottom: 4 }}>
              {d.pointsPer(algo.episodeLabel)}
            </div>
            <LineChart
              height={140}
              marker={retuned[slotIndex]}
              series={[{ label: 'reward', color: '--accent-2', values: charts.rewards }]}
            />
            {retuned[slotIndex] !== undefined && (
              <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
                {d.retuned}
              </div>
            )}

            {hasLaps && (
              <>
                <div className="small muted" style={{ marginTop: 10 }}>
                  {d.lapPer(algo.episodeLabel)}
                </div>
                <LineChart
                  height={110}
                  nonNegative
                  emptyText={d.noLapYet}
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
                {d.recordsOn(setupLabel(draft.config))}
              </div>
              <div className="cols-2">
                <Stat k={d.fastLap} v={lapTime(records.lap)} accent />
                <Stat k={d.fullRaceStat} v={raceTime(records.race)} />
              </div>
              {target && <TargetLine target={target} trackId={String(draft.config.trackId)} lap={records.lap} />}
              <div className="small muted" style={{ marginTop: 8 }}>
                {records.race === null
                  ? d.noRaceYet(String(draft.config.laps ?? 3))
                  : d.perSetup}
              </div>
            </div>
          )}

          {/* Only numbers somebody can act on. Exploration rate, steps per second
              and the best reward ever scored describe the machinery, not the
              driver - none of them says whether to keep training or what to
              change, and the README promises a screen without them. */}
          <div className="card notched">
            <div className="cols-3">
              <Stat k={algo.episodesLabel} v={(slotLive?.live.episode ?? 0).toLocaleString(locale())} />
              <Stat k={d.lastScore(game.spec.scoreLabel)} v={history.length ? history[history.length - 1].score.toFixed(1) : '-'} />
              <Stat k={d.trainTime} v={durationText((boot.current[slotIndex]?.baseTrainedMs ?? 0) + trainer.elapsedMs())} />
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
                    [d.population, String(draft.gaHyper.populationSize)],
                    [d.survivors, `${Math.round(draft.gaHyper.eliteFraction * 100)}%`],
                    [d.mutation, String(draft.gaHyper.mutationScale)],
                  ]
                : [
                    [d.learningRate, String(draft.hyper.lr)],
                    ['gamma', String(draft.hyper.gamma)],
                    ['batch', String(draft.hyper.batchSize)],
                    [d.replay, draft.hyper.bufferSize.toLocaleString(locale())],
                    ['epsilon', d.epsRange(draft.hyper.epsStart, draft.hyper.epsEnd)],
                  ]
            }
          />

          <div className="card notched">
            {multi && (
              <div className="small" style={{ marginBottom: 8 }}>
                {d.slidersOf} <b>{slot.name || d.model(slotIndex + 1)}</b> {d.slidersOnly}
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
  const d = useT().dashboard;
  return (
    <div className="segmented" style={{ width: '100%', marginBottom: 10 }}>
      {models.map((m, i) => (
        <button key={i} style={{ flex: 1 }} className={i === current ? 'on' : ''} onClick={() => onPick(i)}>
          <span
            className="livery"
            style={{ background: CAR_COLORS[i % CAR_COLORS.length], width: 4, height: 10, marginInlineEnd: 6 }}
          />
          {m.name || d.model(i + 1)}
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
  const d = useT().dashboard;
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
      <div className="pill mono" title={d.attemptTime}>
        {raceTime(snap.raceMs)}
      </div>
      <div className="pill" title={d.leaderLap}>
        {d.lap}{' '}
        <Ltr className="mono">
          {leader.lap + 1}/{snap.laps}
        </Ltr>{' '}
        ·{' '}
        <span className="mono">{lapTime(leader.currentLapMs)}</span>
      </div>
      {snap.fastestLap && (
        <div className="pill" style={{ borderColor: 'var(--purple)', color: 'var(--purple)' }}>
          {d.fastestInAttempt} <span className="mono">{lapTime(snap.fastestLap.ms)}</span>
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
  const known = TRACK_DEFS.some((def) => def.id === config.trackId);
  const track = known ? trackName(String(config.trackId)) : String(config.trackId ?? '');
  return words().dashboard.setup(track, String(config.laps ?? '?'));
}

/**
 * The one number that says when a model is good enough: how far its best lap is
 * from the pole of the last Grand Prix on this circuit.
 */
function TargetLine({ target, trackId, lap }: { target: TrainingTarget; trackId: string; lap: number | null }) {
  const d = useT().dashboard;
  const gap = lap === null ? null : (lap - target.ms) / 1000;
  const label = target.kind === 'pole' ? d.poleOf(grandPrixTitle(trackId), target.round) : d.trackRecord;
  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div>
        {label}: <span className="mono" style={{ color: 'var(--purple)' }}>{lapTime(target.ms)}</span>
        <span className="dim">
          {' · '}
          <Name>{driverName({ id: target.entryId, driver: target.driver })}</Name>
        </span>
        {' · '}
        {d.yours} <span className="mono">{lapTime(lap)}</span>
        {gap !== null && (
          <>
            {' · '}
            <b className="mono" style={{ color: gap <= 0 ? 'var(--good)' : 'var(--warn)' }}>
              {gap <= 0 ? d.fasterBy((-gap).toFixed(1)) : d.slowerBy(gap.toFixed(1))}
            </b>
          </>
        )}
      </div>
      {!target.samePhysics && (
        <div className="dim tiny" style={{ marginTop: 2 }}>
          {d.oldPhysics}
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
  const d = useT().dashboard;
  return (
    <details className="card notched under-hood">
      <summary className="eyebrow">{d.underHood}</summary>
      <div className="small" style={{ display: 'grid', gap: 4, marginTop: 10 }}>
        <div>
          {d.method} <b>{algo.name}</b> <span className="muted">({algo.technical})</span>
        </div>
        <div>
          {d.network} <Ltr className="mono">{[obsSize, ...hidden, actions.length].join(' → ')}</Ltr>
        </div>
        <div>
          {d.input} <span className="mono">{obsSize}</span> {d.inputBody}
        </div>
        <div>
          {d.actions(actions.length)} <span className="muted">{actions.join(' · ')}</span>
        </div>
        {extra.map(([k, v]) => (
          <div key={k}>
            {k}: <span className="mono">{v}</span>
          </div>
        ))}
        <div className="muted">
          {d.rewardSum}
        </div>
      </div>
    </details>
  );
}

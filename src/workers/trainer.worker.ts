/// <reference lib="webworker" />
import { DqnLearner } from '../core/rl/trainer';
import { GaLearner } from '../core/rl/ga';
import { TrainingSession } from '../core/rl/session';
import { decodeWeights, encodeWeights } from '../core/nn/serialize';
import type { FromTrainer, SlotLive, SpeedMode, ToTrainer } from './protocol';

/** Wall-clock budget per tick. Keeps the worker responsive to control messages. */
const TICK_BUDGET_MS = 25;
const SNAPSHOT_INTERVAL_MS = 33;
const LIVE_STATS_INTERVAL_MS = 400;

/**
 * Simulation steps per second per mode. 60 is real time; turbo is uncapped and
 * lands wherever the gradient step allows (a few hundred per second for the
 * default 64-64 network), which is what makes it visibly faster than 'fast'.
 */
const TARGET_SPS: Record<SpeedMode, number> = {
  watch: 60,
  fast: 240,
  turbo: Infinity,
};

let session: TrainingSession | null = null;
let running = false;
let speed: SpeedMode = 'fast';
let scheduled = false;

/**
 * setTimeout(0) is clamped to ~4 ms once nested, which would idle the worker for
 * a sixth of every tick. A MessageChannel round-trip is a true zero-delay yield
 * that still lets control messages through.
 */
const yieldChannel = new MessageChannel();
yieldChannel.port1.onmessage = () => {
  scheduled = false;
  tick();
};

let lastSnapshotAt = 0;
let lastLiveAt = 0;
let spsWindowStart = 0;
let spsWindowSteps = 0;
let stepsPerSec = 0;
/** Fractional step budget carried between ticks so pacing does not drift. */
let stepCredit = 0;
let lastTickAt = 0;
/** Last reported loss / fitness spread per slot, kept for the throttled live tick. */
let lastLoss: number[] = [];

function post(msg: FromTrainer): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  yieldChannel.port2.postMessage(null);
}

function tick(): void {
  if (!running || !session) return;
  const now = performance.now();
  const dt = lastTickAt === 0 ? 16 : Math.min(200, now - lastTickAt);
  lastTickAt = now;

  const target = TARGET_SPS[speed];
  let allowed = Infinity;
  if (target !== Infinity) {
    stepCredit += (dt / 1000) * target;
    allowed = Math.floor(stepCredit);
    stepCredit -= allowed;
  }

  const deadline = now + TICK_BUDGET_MS;
  let done = 0;
  while (done < allowed && performance.now() < deadline) {
    const finished = session.step();
    done++;
    for (const { slot, stats } of finished) {
      lastLoss[slot] = stats.loss;
      post({ type: 'episode', slot, stats });
    }
  }
  spsWindowSteps += done;

  const t = performance.now();
  if (speed !== 'turbo' && t - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = t;
    post({ type: 'snapshot', snap: session.snapshot() });
  }
  if (t - lastLiveAt >= LIVE_STATS_INTERVAL_MS) {
    const elapsed = (t - spsWindowStart) / 1000;
    if (elapsed > 0) stepsPerSec = Math.round(spsWindowSteps / elapsed);
    spsWindowStart = t;
    spsWindowSteps = 0;
    lastLiveAt = t;
    post({ type: 'live', stepsPerSec, slots: liveSlots() });
  }

  schedule();
}

function liveSlots(): SlotLive[] {
  if (!session) return [];
  return session.learners.map((l, slot) => ({
    episode: l.episode,
    envSteps: l.envSteps,
    gradSteps: l.gradSteps,
    epsilon: l.epsilon,
    loss: lastLoss[slot] ?? 0,
    note: l.progressNote(session!.episodeSteps),
  }));
}

self.onmessage = (ev: MessageEvent<ToTrainer>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        const i = msg.init;
        session = new TrainingSession({
          gameId: i.gameId,
          config: i.config,
          rewards: i.slots.map((s) => s.rewards),
          seed: i.seed,
          makeLearner: (slot, seats) => {
            const cfg = i.slots[slot];
            const weights = cfg.weightsB64 ? decodeWeights(cfg.weightsB64) : undefined;
            return cfg.algorithm === 'ga'
              ? new GaLearner({
                  gameId: i.gameId,
                  hyper: cfg.gaHyper,
                  seed: i.seed + slot * 104_729,
                  seatCount: seats.length,
                  weights,
                  envSteps: cfg.envSteps,
                  episode: cfg.episode,
                })
              : new DqnLearner({
                  gameId: i.gameId,
                  hyper: cfg.hyper,
                  seed: i.seed + slot * 104_729,
                  seatCount: seats.length,
                  weights,
                  envSteps: cfg.envSteps,
                  gradSteps: cfg.gradSteps,
                  episode: cfg.episode,
                });
          },
        });
        lastLoss = session.learners.map(() => 0);
        speed = i.speed;
        running = false;
        lastTickAt = 0;
        stepCredit = 0;
        spsWindowStart = performance.now();
        spsWindowSteps = 0;
        post({ type: 'ready', seats: session.seats });
        post({ type: 'snapshot', snap: session.snapshot() });
        break;
      }
      case 'play':
        if (!session) return;
        running = true;
        lastTickAt = 0;
        stepCredit = 0;
        schedule();
        break;
      case 'pause':
        running = false;
        break;
      case 'setSpeed':
        speed = msg.speed;
        stepCredit = 0;
        lastTickAt = 0;
        break;
      case 'setRewards':
        session?.setRewards(msg.slot, msg.rewards);
        break;
      case 'requestWeights': {
        if (!session) return;
        post({
          type: 'weights',
          tag: msg.tag,
          slots: session.learners.map((l) => ({
            weightsB64: encodeWeights(l.getWeights()),
            envSteps: l.envSteps,
            gradSteps: l.gradSteps,
            episode: l.episode,
          })),
        });
        break;
      }
      case 'dispose':
        running = false;
        session = null;
        break;
    }
  } catch (err) {
    running = false;
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FromTrainer, SlotWeights, SpeedMode, ToTrainer, TrainInit } from '../workers/protocol';
import type { RewardConfig } from '../core/games/types';
import type { TrainingPoint } from '../storage';

export interface LiveStats {
  episode: number;
  envSteps: number;
  gradSteps: number;
  epsilon: number;
  loss: number;
  note: string;
}

/** Everything the dashboard shows about one model in the session. */
export interface SlotState {
  history: TrainingPoint[];
  live: LiveStats;
  best: { reward: number; score: number };
}

export type TrainerStatus = 'idle' | 'ready' | 'running' | 'paused' | 'error';

const EMPTY_LIVE: LiveStats = { episode: 0, envSteps: 0, gradSteps: 0, epsilon: 1, loss: 0, note: '' };

function freshSlot(history: TrainingPoint[] = []): SlotState {
  return { history, live: EMPTY_LIVE, best: { reward: -Infinity, score: 0 } };
}

/**
 * Owns the training Web Worker.
 *
 * State is per model: one training session can hold several models racing each
 * other on one grid, and each of them has its own curve, its own records and its
 * own weights to save.
 *
 * Snapshots land in a ref rather than React state — they arrive ~30 times a
 * second and only the canvas loop needs them, so re-rendering the dashboard for
 * each one would be wasted work.
 */
export function useTrainer() {
  const workerRef = useRef<Worker | null>(null);
  const snapRef = useRef<unknown>(null);
  const pending = useRef(new Map<string, (p: SlotWeights[]) => void>());
  const tagSeq = useRef(0);
  const startedAt = useRef(0);
  const elapsedRef = useRef(0);

  const [status, setStatus] = useState<TrainerStatus>('idle');
  const [slots, setSlots] = useState<SlotState[]>([freshSlot()]);
  const [seats, setSeats] = useState<number[][]>([]);
  const [stepsPerSec, setStepsPerSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<SpeedMode>('fast');

  const send = useCallback((msg: ToTrainer) => workerRef.current?.postMessage(msg), []);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/trainer.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<FromTrainer>) => {
      const msg = ev.data;
      switch (msg.type) {
        case 'ready':
          setSeats(msg.seats);
          // init and play are posted back to back, so this can land after play()
          // already set 'running' — never downgrade a live session.
          setStatus((prev) => (prev === 'idle' ? 'ready' : prev));
          break;
        case 'snapshot':
          snapRef.current = msg.snap;
          break;
        case 'episode': {
          const s = msg.stats;
          setSlots((prev) =>
            prev.map((slot, i) =>
              i !== msg.slot
                ? slot
                : {
                    history: [
                      ...slot.history,
                      {
                        episode: s.episode,
                        reward: s.reward,
                        score: s.score,
                        epsilon: s.epsilon,
                        loss: s.loss,
                        bestLapMs: s.bestLapMs ?? null,
                        bestRaceMs: s.bestRaceMs ?? null,
                      },
                    ],
                    live: slot.live,
                    best: s.reward > slot.best.reward ? { reward: s.reward, score: s.score } : slot.best,
                  },
            ),
          );
          break;
        }
        case 'live':
          setStepsPerSec(msg.stepsPerSec);
          setSlots((prev) => prev.map((slot, i) => (msg.slots[i] ? { ...slot, live: msg.slots[i] } : slot)));
          break;
        case 'weights': {
          const resolve = pending.current.get(msg.tag);
          if (resolve) {
            pending.current.delete(msg.tag);
            resolve(msg.slots);
          }
          break;
        }
        case 'error':
          setError(msg.message);
          setStatus('error');
          break;
      }
    };

    return () => {
      worker.postMessage({ type: 'dispose' } satisfies ToTrainer);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const init = useCallback(
    (cfg: TrainInit, resumeHistories: TrainingPoint[][] = []) => {
      setSlots(cfg.slots.map((_, i) => freshSlot(resumeHistories[i] ?? [])));
      setSeats([]);
      setStepsPerSec(0);
      setError(null);
      setStatus('idle');
      setSpeedState(cfg.speed);
      elapsedRef.current = 0;
      send({ type: 'init', init: cfg });
    },
    [send],
  );

  const play = useCallback(() => {
    startedAt.current = performance.now();
    setStatus('running');
    send({ type: 'play' });
  }, [send]);

  const pause = useCallback(() => {
    if (startedAt.current) elapsedRef.current += performance.now() - startedAt.current;
    startedAt.current = 0;
    setStatus('paused');
    send({ type: 'pause' });
  }, [send]);

  const setSpeed = useCallback(
    (s: SpeedMode) => {
      setSpeedState(s);
      send({ type: 'setSpeed', speed: s });
    },
    [send],
  );

  const setRewards = useCallback(
    (slot: number, rewards: RewardConfig) => send({ type: 'setRewards', slot, rewards }),
    [send],
  );

  const requestWeights = useCallback(
    () =>
      new Promise<SlotWeights[]>((resolve, reject) => {
        const tag = `w${tagSeq.current++}`;
        pending.current.set(tag, resolve);
        send({ type: 'requestWeights', tag });
        setTimeout(() => {
          if (pending.current.delete(tag)) reject(new Error('הבקשה למשקולות לא נענתה'));
        }, 10_000);
      }),
    [send],
  );

  const elapsedMs = useCallback(
    () => elapsedRef.current + (startedAt.current ? performance.now() - startedAt.current : 0),
    [],
  );

  return {
    status,
    slots,
    seats,
    stepsPerSec,
    error,
    speed,
    snapRef,
    init,
    play,
    pause,
    setSpeed,
    setRewards,
    requestWeights,
    elapsedMs,
  };
}

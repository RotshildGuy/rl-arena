import { getGame } from '../games/registry';
import type { Env, RewardConfig } from '../games/types';
import type { Learner } from './learner';
import type { EpisodeStats } from './trainerTypes';

export interface SlotStats {
  /** Which learner this belongs to, in the order they were created. */
  slot: number;
  stats: EpisodeStats;
}

export interface SessionInit {
  gameId: string;
  config: Record<string, unknown>;
  /** One reward table per learner — each model can be shaped differently. */
  rewards: RewardConfig[];
  seed: number;
  /** Builds the learner for a slot once its seats are known. */
  makeLearner: (slot: number, seats: number[]) => Learner;
}

const NO_STATS: SlotStats[] = [];

/**
 * One environment, several learners.
 *
 * The seats of the environment are dealt out round-robin, so with four cars and
 * two models each model drives two of them and they race each other for real:
 * the traffic a model has to get past is another model that is learning at the
 * same time, which is the whole point of training together.
 *
 * The session owns the environment, the observation buffers and the episode
 * boundary; it owns no timing at all, so the worker can drive it at 1x or flat
 * out with the same loop.
 */
export class TrainingSession {
  readonly env: Env<unknown>;
  readonly learners: Learner[];
  /** Environment seat indices held by each learner. */
  readonly seats: number[][];
  readonly gameId: string;

  /** Steps taken in the episode now running. */
  episodeSteps = 0;

  private readonly cur: Float32Array[] = [];
  private readonly nxt: Float32Array[] = [];
  private readonly actions: Int32Array;
  private readonly active: Uint8Array;
  private readonly seatReward: Float32Array;
  private readonly slotOfSeat: Int32Array;
  private readonly indexInSlot: Int32Array;
  private readonly outcomes: Array<{ seatRewards: Float32Array; seatScores: Float32Array }> = [];
  private readonly seed: number;
  private episodeIndex = 0;

  constructor(init: SessionInit) {
    const game = getGame(init.gameId);
    this.gameId = init.gameId;
    this.seed = init.seed;
    this.env = game.createEnv(init.config, init.rewards[0]);

    const nSeats = this.env.nAgents;
    const nSlots = Math.max(1, Math.min(init.rewards.length, nSeats));
    this.seats = Array.from({ length: nSlots }, () => [] as number[]);
    this.slotOfSeat = new Int32Array(nSeats);
    this.indexInSlot = new Int32Array(nSeats);
    for (let s = 0; s < nSeats; s++) {
      const slot = s % nSlots;
      this.indexInSlot[s] = this.seats[slot].length;
      this.slotOfSeat[s] = slot;
      this.seats[slot].push(s);
    }

    // Each model races under its own reward table. The environment scores every
    // car with the weights of whoever is driving it, so an aggressive model and
    // a careful one can share a grid without sharing a personality.
    for (let slot = 0; slot < nSlots; slot++) {
      for (const seat of this.seats[slot]) this.env.setAgentRewards?.(seat, init.rewards[slot]);
    }

    this.learners = this.seats.map((seats, slot) => init.makeLearner(slot, seats));
    for (let i = 0; i < nSeats; i++) {
      this.cur.push(new Float32Array(game.spec.obsSize));
      this.nxt.push(new Float32Array(game.spec.obsSize));
    }
    this.actions = new Int32Array(nSeats);
    this.active = new Uint8Array(nSeats);
    this.seatReward = new Float32Array(nSeats);
    for (const seats of this.seats) {
      this.outcomes.push({
        seatRewards: new Float32Array(seats.length),
        seatScores: new Float32Array(seats.length),
      });
    }

    this.beginEpisode();
  }

  get slotCount(): number {
    return this.learners.length;
  }

  /** Live reward editing, per model. */
  setRewards(slot: number, rewards: RewardConfig): void {
    const seats = this.seats[slot];
    if (!seats) return;
    if (this.env.setAgentRewards) {
      for (const seat of seats) this.env.setAgentRewards(seat, rewards);
    } else {
      // Single-table environment: mutate in place so the model and its replay
      // buffer survive the edit.
      Object.assign(this.env.rewards, rewards);
    }
  }

  snapshot(): unknown {
    return this.env.snapshot();
  }

  /** Advance one environment step. Returns the stats of every learner that finished a unit of progress. */
  step(): SlotStats[] {
    const n = this.env.nAgents;
    for (let seat = 0; seat < n; seat++) {
      this.active[seat] = this.env.isAgentDone(seat) ? 0 : 1;
      this.actions[seat] = this.active[seat]
        ? this.learners[this.slotOfSeat[seat]].act(this.indexInSlot[seat], this.cur[seat])
        : 0;
    }

    const res = this.env.step(this.actions);
    for (let seat = 0; seat < n; seat++) {
      if (!this.active[seat]) continue;
      this.env.observe(seat, this.nxt[seat]);
      this.learners[this.slotOfSeat[seat]].observe(
        this.indexInSlot[seat],
        this.cur[seat],
        this.actions[seat],
        res.rewards[seat],
        this.nxt[seat],
        res.done[seat] === 1,
      );
      this.cur[seat].set(this.nxt[seat]);
      this.seatReward[seat] += res.rewards[seat];
    }
    for (const learner of this.learners) learner.afterStep();
    this.episodeSteps++;

    if (!res.allDone) return NO_STATS;

    const out: SlotStats[] = [];
    for (let slot = 0; slot < this.learners.length; slot++) {
      const seats = this.seats[slot];
      const acc = this.outcomes[slot];
      let bestLapMs: number | null = null;
      let bestRaceMs: number | null = null;
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i];
        acc.seatRewards[i] = this.seatReward[seat];
        acc.seatScores[i] = this.env.score(seat);
        const t = this.env.raceStats?.(seat);
        if (t) {
          if (t.bestLapMs !== null && (bestLapMs === null || t.bestLapMs < bestLapMs)) bestLapMs = t.bestLapMs;
          if (t.totalMs !== null && (bestRaceMs === null || t.totalMs < bestRaceMs)) bestRaceMs = t.totalMs;
        }
      }
      const stats = this.learners[slot].endEpisode({
        seatRewards: acc.seatRewards,
        seatScores: acc.seatScores,
        bestLapMs,
        bestRaceMs,
        steps: this.episodeSteps,
      });
      if (stats) out.push({ slot, stats });
    }

    this.beginEpisode();
    return out;
  }

  private beginEpisode(): void {
    this.env.reset(this.seed + this.episodeIndex * 7919);
    this.episodeIndex++;
    this.episodeSteps = 0;
    this.seatReward.fill(0);
    for (let seat = 0; seat < this.env.nAgents; seat++) this.env.observe(seat, this.cur[seat]);
    for (const learner of this.learners) learner.beginEpisode();
  }
}

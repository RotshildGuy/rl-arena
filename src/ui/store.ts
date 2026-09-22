import { create } from 'zustand';
import { getGame, GAME_IDS, type GameId } from '../core/games/registry';
import { defaultRewards, levelValue, type RewardConfig } from '../core/games/types';
import { DEFAULT_HYPER, type DqnHyper } from '../core/rl/dqn';
import { DEFAULT_GA_HYPER, type GaHyper } from '../core/rl/ga';
import type { AlgorithmId } from '../core/rl/algorithms';
import type { ModelMeta } from '../storage';
import { isMobileClass } from './device';
import { getCompetitor, pushCompetitor, setCompetitor as persistCompetitor } from './identity';

/**
 * The app has two halves. The championship half — standings, race days, the
 * broadcast — is what most people open it for; the garage half is where models
 * are made. Playing against a model yourself is a third, deliberately smaller
 * corner.
 */
export type Screen =
  | 'championship'
  | 'standings'
  | 'broadcast'
  | 'report'
  | 'library'
  | 'trainSetup'
  | 'training'
  | 'raceSetup'
  | 'race'
  | 'info';

export type InfoTab = 'how' | 'terms' | 'privacy' | 'notices';

/** One model in a training session. Several of them can share one grid. */
export interface TrainSlot {
  /** Set when continuing an existing model. */
  modelId: string | null;
  name: string;
  algorithm: AlgorithmId;
  /** This model's own reward table — its personality. */
  rewards: RewardConfig;
  /** Wipe the weights and start over, keeping the name and settings. */
  restart: boolean;
}

/**
 * What the training-setup screen is holding before a run starts.
 *
 * The environment is shared — one track, one grid — and every model in `slots`
 * drives part of it. Training two models together is how you find out whether a
 * model is actually fast or only fast when the road is empty.
 */
export interface TrainDraft {
  /** Competitor name — the team every model here races for. */
  owner: string;
  config: Record<string, unknown>;
  slots: TrainSlot[];
  hyper: DqnHyper;
  gaHyper: GaHyper;
}

/** More than this and a single phone cannot keep up with the grid. */
export const MAX_TRAIN_SLOTS = 4;

export interface RaceSetup {
  config: Record<string, unknown>;
  /** Model ids of the opponents, in grid order. */
  opponents: string[];
}

interface AppState {
  screen: Screen;
  gameId: GameId;
  toast: string | null;
  draft: TrainDraft;
  race: RaceSetup;
  /** Which race day the broadcast and report screens are looking at. */
  viewRaceId: string | null;
  /**
   * The competitor (team) name. Mirrored into the store rather than read from
   * localStorage at each render, so every header, table and form updates the
   * moment it changes instead of on the next reload.
   */
  competitor: string;
  /** Which section of the information screen is open. */
  infoTab: InfoTab;

  go(screen: Screen): void;
  openRace(raceId: string, screen: 'broadcast' | 'report'): void;
  setCompetitor(name: string): void;
  /** The same, for a name that came *from* the account — so it is not sent back. */
  adoptCompetitor(name: string): void;
  openInfo(tab: InfoTab): void;
  selectGame(id: GameId): void;
  showToast(msg: string): void;
  newDraft(): void;
  draftFromModel(m: ModelMeta, restart: boolean): void;
  patchDraft(p: Partial<TrainDraft>): void;
  patchSlot(index: number, p: Partial<TrainSlot>): void;
  addSlot(): void;
  removeSlot(index: number): void;
  /** Point a slot at a saved model to continue, or back at a brand new one. */
  slotFromModel(index: number, m: ModelMeta | null): void;
  patchRace(p: Partial<RaceSetup>): void;
}

/**
 * Phone-class devices get lighter defaults.
 *
 * The genetic algorithm needs no gradients at all, which is exactly the operation
 * a mobile CPU is worst at — it runs roughly 25x more environment steps per second
 * than DQN on the same hardware, so it is the sane default where most of the
 * training will happen. A smaller network cuts the per-step cost further.
 * Nothing here is locked: the user can still pick DQN and a larger net.
 */
function freshSlot(gameId: GameId, index = 0): TrainSlot {
  return {
    modelId: null,
    name: '',
    algorithm: isMobileClass ? 'ga' : 'dqn',
    // A second model on the grid is only interesting if it drives differently,
    // so every one after the first starts braver than the house defaults.
    rewards: index > 0 ? braverRewards(gameId) : defaultRewards(getGame(gameId).spec),
    restart: false,
  };
}

/**
 * A sparring partner's table: the same defaults, nudged two notches towards
 * speed and aggression. It gives a second model a reason to exist instead of
 * being a copy of the first with a different seed.
 */
function braverRewards(gameId: GameId): RewardConfig {
  const spec = getGame(gameId).spec;
  const out = defaultRewards(spec);
  for (const c of spec.rewardChannels) {
    if (c.key !== 'speed' && c.key !== 'carHit' && c.key !== 'overtake') continue;
    out[c.key] = levelValue(c, Math.min(10, c.defaultLevel + 2));
  }
  return out;
}

function freshDraft(gameId: GameId): TrainDraft {
  const game = getGame(gameId);
  const hidden = isMobileClass ? [48, 48] : DEFAULT_HYPER.hidden;
  return {
    owner: getCompetitor(),
    config: game.defaultConfig(),
    slots: [freshSlot(gameId)],
    hyper: { ...DEFAULT_HYPER, hidden },
    gaHyper: {
      ...DEFAULT_GA_HYPER,
      hidden,
      // Smaller population means a generation completes sooner, so the progress
      // chart actually moves while someone is watching it on a phone.
      populationSize: isMobileClass ? 20 : DEFAULT_GA_HYPER.populationSize,
    },
  };
}

/** The grid has to be at least as big as the number of models racing on it. */
function withSeats(config: Record<string, unknown>, slots: number): Record<string, unknown> {
  const nCars = Number(config.nCars ?? slots);
  return nCars >= slots ? config : { ...config, nCars: slots };
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'championship',
  gameId: GAME_IDS[0],
  toast: null,
  viewRaceId: null,
  competitor: getCompetitor(),
  infoTab: 'how',
  draft: freshDraft(GAME_IDS[0]),
  race: { config: getGame(GAME_IDS[0]).defaultConfig(), opponents: [] },

  go: (screen) => set({ screen }),

  openRace: (viewRaceId, screen) => set({ viewRaceId, screen }),

  openInfo: (infoTab) => set({ infoTab, screen: 'info' }),

  setCompetitor: (name) => {
    persistCompetitor(name);
    pushCompetitor(name);
    set({ competitor: name, draft: { ...get().draft, owner: name } });
  },

  adoptCompetitor: (name) => {
    persistCompetitor(name);
    set({ competitor: name, draft: { ...get().draft, owner: name } });
  },

  selectGame: (gameId) =>
    set({
      gameId,
      draft: freshDraft(gameId),
      race: { config: getGame(gameId).defaultConfig(), opponents: [] },
    }),

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 2600);
  },

  newDraft: () => set({ draft: freshDraft(get().gameId) }),

  draftFromModel: (m, restart) => {
    const base = freshDraft(get().gameId);
    set({
      draft: {
        ...base,
        owner: m.owner || getCompetitor(),
        config: { ...m.config },
        slots: [
          { modelId: m.id, name: m.name, algorithm: m.algorithm, rewards: { ...m.rewards }, restart },
        ],
        ...(m.algorithm === 'ga'
          ? { gaHyper: { ...DEFAULT_GA_HYPER, ...(m.hyper as Partial<GaHyper>) } }
          : { hyper: { ...DEFAULT_HYPER, ...(m.hyper as Partial<DqnHyper>) } }),
      },
    });
  },

  patchDraft: (p) => set({ draft: { ...get().draft, ...p } }),

  patchSlot: (index, p) => {
    const draft = get().draft;
    set({ draft: { ...draft, slots: draft.slots.map((s, i) => (i === index ? { ...s, ...p } : s)) } });
  },

  addSlot: () => {
    const draft = get().draft;
    if (draft.slots.length >= MAX_TRAIN_SLOTS) return;
    const slots = [...draft.slots, freshSlot(get().gameId, draft.slots.length)];
    set({ draft: { ...draft, slots, config: withSeats(draft.config, slots.length) } });
  },

  removeSlot: (index) => {
    const draft = get().draft;
    if (draft.slots.length <= 1) return;
    set({ draft: { ...draft, slots: draft.slots.filter((_, i) => i !== index) } });
  },

  slotFromModel: (index, m) => {
    const draft = get().draft;
    const slot: TrainSlot = m
      ? { modelId: m.id, name: m.name, algorithm: m.algorithm, rewards: { ...m.rewards }, restart: false }
      : freshSlot(get().gameId, index);
    set({ draft: { ...draft, slots: draft.slots.map((s, i) => (i === index ? slot : s)) } });
  },
  patchRace: (p) => set({ race: { ...get().race, ...p } }),
}));

export type { DqnHyper };

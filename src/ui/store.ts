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
 * The app has two halves. The championship half - standings, race days, the
 * broadcast - is what most people open it for; the garage half is where models
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
  | 'info'
  | 'feedback'
  | 'shop';

export type InfoTab = 'how' | 'terms' | 'privacy' | 'notices';

/** One model in a training session. Several of them can share one grid. */
export interface TrainSlot {
  /** Set when continuing an existing model. */
  modelId: string | null;
  name: string;
  algorithm: AlgorithmId;
  /** This model's own reward table - its personality. */
  rewards: RewardConfig;
  /** Wipe the weights and start over, keeping the name and settings. */
  restart: boolean;
}

/**
 * What the training-setup screen is holding before a run starts.
 *
 * The environment is shared - one track, one grid - and every model in `slots`
 * drives part of it. Training two models together is how you find out whether a
 * model is actually fast or only fast when the road is empty.
 */
export interface TrainDraft {
  /** Competitor name - the team every model here races for. */
  owner: string;
  config: Record<string, unknown>;
  slots: TrainSlot[];
  hyper: DqnHyper;
  gaHyper: GaHyper;
  /**
   * Stop and save by itself after this many minutes; 0 for no limit. A phone
   * only trains while the tab is open and the screen is on, so a short run
   * that ends with a saved model beats a long one that ends in a pocket.
   */
  timeLimitMin: number;
  /** A championship car to train against: it drives, frozen, in the last seat. */
  rival: RivalPick | null;
}

export interface RivalPick {
  entryId: string;
  driver: string;
  team: string;
  arch: { obsSize: number; hidden: number[]; nActions: number };
}

export const TIME_LIMITS = [0, 5, 15, 30];

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
  /**
   * The team name turned out to belong to another account - a name chosen
   * before names were unique. The championship screen asks for a new one.
   */
  nameTaken: boolean;
  /** Which section of the information screen is open. */
  infoTab: InfoTab;

  go(screen: Screen): void;
  /**
   * A screen that must not be left silently - training, with progress nobody
   * saved - registers this. It is asked before every navigation and returns
   * false to keep the screen where it is (and ask the person itself).
   */
  leaveGuard: ((to: Screen) => boolean) | null;
  setLeaveGuard(guard: ((to: Screen) => boolean) | null): void;
  /** The screen the feedback form was opened from: it goes with the report. */
  feedbackFrom: Screen;
  openFeedback(): void;
  /** The friends' league the tables are filtered to, or null for everybody. */
  leagueId: string | null;
  setLeague(id: string | null): void;
  /** Came in through "watch the last race first": open a broadcast once there is one. */
  watchFirst: boolean;
  setWatchFirst(on: boolean): void;
  openRace(raceId: string, screen: 'broadcast' | 'report'): void;
  setCompetitor(name: string): void;
  /** The same, for a name that came *from* the account - so it is not sent back. */
  adoptCompetitor(name: string): void;
  setNameTaken(taken: boolean): void;
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
 * a mobile CPU is worst at - it runs roughly 25x more environment steps per second
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
    config: withTrainingDefaults(gameId, game.defaultConfig()),
    slots: [freshSlot(gameId)],
    hyper: { ...DEFAULT_HYPER, hidden },
    gaHyper: {
      ...DEFAULT_GA_HYPER,
      hidden,
      // Smaller population means a generation completes sooner, so the progress
      // chart actually moves while someone is watching it on a phone.
      populationSize: isMobileClass ? 20 : DEFAULT_GA_HYPER.populationSize,
    },
    timeLimitMin: isMobileClass ? 5 : 0,
    rival: null,
  };
}

/** The grid has to be at least as big as the number of models racing on it. */
/**
 * Training always runs the hardest setup the championship can throw at a car:
 * the full grid, the full distance, and contact on. A model trained on three
 * laps alone with cars that pass through each other has learned a different
 * game from the one it will race, and these three were the settings people
 * got wrong without knowing it - so they are no longer settings. The episode
 * gets as long as a championship session allows, or ten laps would be cut off.
 */
export const TRAINING_GRID = 8;
export const TRAINING_LAPS = 10;
export const TRAINING_HIDDEN_OPTIONS = ['nCars', 'laps', 'carCollisions'];

export function withTrainingDefaults(gameId: GameId, config: Record<string, unknown>): Record<string, unknown> {
  if (gameId !== 'racing') return config;
  return {
    ...config,
    nCars: TRAINING_GRID,
    laps: TRAINING_LAPS,
    carCollisions: true,
    maxSteps: TRAINING_LAPS * 900 + 600,
  };
}

function withSeats(config: Record<string, unknown>, slots: number): Record<string, unknown> {
  const nCars = Number(config.nCars ?? slots);
  return nCars >= slots ? config : { ...config, nCars: slots };
}

function mayLeave(state: AppState, to: Screen): boolean {
  if (to === state.screen || !state.leaveGuard) return true;
  return state.leaveGuard(to);
}

export const useApp = create<AppState>((set, get) => ({
  screen: 'championship',
  gameId: GAME_IDS[0],
  toast: null,
  viewRaceId: null,
  competitor: getCompetitor(),
  nameTaken: false,
  infoTab: 'how',
  draft: freshDraft(GAME_IDS[0]),
  race: { config: getGame(GAME_IDS[0]).defaultConfig(), opponents: [] },

  go: (screen) => {
    if (!mayLeave(get(), screen)) return;
    set({ screen });
  },
  leaveGuard: null,
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
  feedbackFrom: 'championship',
  leagueId: null,
  setLeague: (leagueId) => set({ leagueId }),
  watchFirst: false,
  setWatchFirst: (watchFirst) => set({ watchFirst }),
  openFeedback: () => {
    if (!mayLeave(get(), 'feedback')) return;
    set((s) => ({ feedbackFrom: s.screen === 'feedback' ? s.feedbackFrom : s.screen, screen: 'feedback' }));
  },

  openRace: (viewRaceId, screen) => {
    if (!mayLeave(get(), screen)) return;
    set({ viewRaceId, screen });
  },

  openInfo: (infoTab) => {
    if (!mayLeave(get(), 'info')) return;
    set({ infoTab, screen: 'info' });
  },

  setCompetitor: (name) => {
    persistCompetitor(name);
    pushCompetitor(name);
    set({ competitor: name, nameTaken: false, draft: { ...get().draft, owner: name } });
  },

  setNameTaken: (nameTaken) => set({ nameTaken }),

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
        config: withTrainingDefaults(get().gameId, { ...m.config }),
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

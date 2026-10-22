import type { Env, EnvSpec, RewardConfig } from './types';
import { RACING_SPEC } from './racing/rewards';
import { DEFAULT_RACING_CONFIG, RacingEnv, type RacingConfig } from './racing/env';
import { TRACK_DEFS } from './racing/tracks';
import { t, translated } from '../../i18n/dict';
import { trackName } from '../../i18n/names';

export type GameId = 'racing';

export interface GameOption {
  key: string;
  label: string;
  /** 'select' renders a dropdown, 'toggle' a switch, 'number' a stepper. */
  kind: 'select' | 'toggle' | 'number';
  choices?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  hint?: string;
  /** Hidden in race setup - derived from the grid instead. */
  trainingOnly?: boolean;
}

export interface TouchKey {
  /** Fed into the same key set the keyboard fills, so humanAction stays the single source of truth. */
  code: string;
  glyph: string;
  caption: string;
}

export interface TouchLayout {
  /** Rendered on the physical left. */
  start: TouchKey[];
  /** Rendered on the physical right. */
  end: TouchKey[];
  startStacked?: boolean;
  endStacked?: boolean;
}

export interface GameModule {
  spec: EnvSpec;
  /** Short pitch shown on the game-picker card. */
  blurb: string;
  defaultConfig(): Record<string, unknown>;
  /** Config knobs the user sees before training or racing. */
  options: GameOption[];
  createEnv(config: Record<string, unknown>, rewards: RewardConfig): Env<unknown>;
  /** One-line summary of a config, for model cards. */
  describeConfig(config: Record<string, unknown>): string;
  /** Keyboard mapping for the human player; returns a discrete action index. */
  humanAction(keys: Set<string>): number;
  /** How many trained models can join one match against the player. */
  maxOpponents: number;
  /** Turn the race settings plus opponent count into a full env config. */
  raceConfig(config: Record<string, unknown>, nOpponents: number): Record<string, unknown>;
  /** Control hint shown during a match on a keyboard device. */
  controlsHint: string;
  /** The same, for touch. */
  touchHint: string;
  /** What one match is called, e.g. "race" or "game". */
  matchNoun: string;
  /** How the player's seat is described in the match setup. */
  seatHint: string;
  /** On-screen controls for touch devices. */
  touchControls: TouchLayout;
  /**
   * Roughly how much training the reference runs needed to reach competent play,
   * measured on this project's own benchmarks. Used only to turn a device speed
   * measurement into a time estimate, so approximate is fine.
   */
  effort: { dqnGradSteps: number; gaEnvSteps: number };
}

const words = () => t().racing;

/** The fields of a game that are words, read in the current language. */
type GameWords = 'blurb' | 'controlsHint' | 'touchHint' | 'matchNoun' | 'seatHint';

const racingBase: Omit<GameModule, GameWords> = {
  spec: RACING_SPEC,
  defaultConfig: () => ({ ...DEFAULT_RACING_CONFIG }),
  options: [
    translated({ key: 'trackId', kind: 'select' as const }, () => ({
      ...words().options.trackId,
      choices: TRACK_DEFS.map((d) => ({ value: d.id, label: trackName(d.id) })),
    })),
    translated({ key: 'nCars', kind: 'number' as const, min: 1, max: 8, trainingOnly: true }, () => words().options.nCars),
    translated({ key: 'laps', kind: 'number' as const, min: 1, max: 10 }, () => words().options.laps),
    translated({ key: 'carCollisions', kind: 'toggle' as const }, () => words().options.carCollisions),
  ],
  createEnv: (config, rewards) => new RacingEnv(config as unknown as RacingConfig, rewards),
  describeConfig: (config) => {
    const w = words();
    return [
      TRACK_DEFS.some((d) => d.id === config.trackId) ? trackName(String(config.trackId)) : String(config.trackId ?? ''),
      w.cars(String(config.nCars ?? '?')),
      w.laps(String(config.laps ?? '?')),
      config.carCollisions ? w.contact : w.noContact,
    ].join(' · ');
  },
  humanAction: (keys) => {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const gas = keys.has('ArrowUp') || keys.has('KeyW');
    const brake = keys.has('ArrowDown') || keys.has('KeyS');
    const throttle = gas ? 0 : brake ? 2 : 1;
    const steer = left ? 0 : right ? 2 : 1;
    return throttle * 3 + steer;
  },
  maxOpponents: 7,
  raceConfig: (config, nOpponents) => ({
    ...config,
    nCars: nOpponents + 1,
    // The models retire when they beach themselves, exactly as they do in the
    // championship; the player, car 0, never does. The race then ends when the
    // last car is accounted for instead of waiting on a wreck.
    stuckLimit: 480,
    neverStuck: 0,
    maxSteps: 60 * 60 * 6,
  }),
  // The genetic driver needs about a quarter longer since the tyres got a limit
  // (physics 2): braking for corners is one more thing to stumble on.
  effort: { dqnGradSteps: 65_000, gaEnvSteps: 1_500_000 },
  touchControls: {
    // Throttle left, steering right. `start` is the physical left edge whatever
    // the page's writing direction, and a stacked column reads top-down, so gas
    // sits above the brake - the pedal you hold under the one you tap.
    start: [
      translated({ code: 'ArrowUp', glyph: '▲' }, () => ({ caption: words().gas })),
      translated({ code: 'ArrowDown', glyph: '▼' }, () => ({ caption: words().brake })),
    ],
    end: [
      translated({ code: 'ArrowLeft', glyph: '◀' }, () => ({ caption: words().left })),
      translated({ code: 'ArrowRight', glyph: '▶' }, () => ({ caption: words().right })),
    ],
    startStacked: true,
  },
};

const racing: GameModule = translated(racingBase, (): Pick<GameModule, GameWords> => {
  const w = words();
  return { blurb: w.blurb, controlsHint: w.controlsHint, touchHint: w.touchHint, matchNoun: w.matchNoun, seatHint: w.seatHint };
});

export const GAMES: Record<GameId, GameModule> = { racing };

export const GAME_IDS = Object.keys(GAMES) as GameId[];

export function getGame(id: string): GameModule {
  const g = GAMES[id as GameId];
  if (!g) throw new Error(`unknown game: ${id}`);
  return g;
}

import type { Env, EnvSpec, RewardConfig } from './types';
import { RACING_SPEC } from './racing/rewards';
import { DEFAULT_RACING_CONFIG, RacingEnv, type RacingConfig } from './racing/env';
import { TRACK_DEFS } from './racing/tracks';

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
  /** Hidden in race setup — derived from the grid instead. */
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
  /** What one match is called, e.g. "מרוץ" or "משחק". */
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

const racing: GameModule = {
  spec: RACING_SPEC,
  blurb: 'מירוץ 2D על ארבע מפות. הרכב "רואה" דרך תשעה חיישני מרחק ובוחר גז, בלם והיגוי.',
  defaultConfig: () => ({ ...DEFAULT_RACING_CONFIG }),
  options: [
    {
      key: 'trackId',
      label: 'מפה',
      kind: 'select',
      choices: TRACK_DEFS.map((t) => ({ value: t.id, label: t.name })),
    },
    {
      key: 'nCars',
      label: 'מספר רכבים',
      kind: 'number',
      min: 1,
      max: 8,
      trainingOnly: true,
      hint: 'הרכבים מתחלקים בין המודלים שמתאמנים. יותר רכבים — יותר תנועה להתמודד איתה',
    },
    { key: 'laps', label: 'הקפות', kind: 'number', min: 1, max: 10 },
    { key: 'carCollisions', label: 'מגע בין רכבים', kind: 'toggle', hint: 'כשכבוי, הרכבים עוברים זה דרך זה' },
  ],
  createEnv: (config, rewards) => new RacingEnv(config as unknown as RacingConfig, rewards),
  describeConfig: (config) => {
    const track = TRACK_DEFS.find((t) => t.id === config.trackId);
    return [
      track?.name ?? String(config.trackId ?? ''),
      String(config.nCars ?? '?') + ' רכבים',
      String(config.laps ?? '?') + ' הקפות',
      config.carCollisions ? 'עם מגע' : 'ללא מגע',
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
  controlsHint: 'חיצים או WASD · ↑ גז · ↓ בלם',
  touchHint: 'גז ובלם משמאל · היגוי מימין',
  matchNoun: 'מרוץ',
  seatHint: 'אתה נוהג ברכב הראשון',
  effort: { dqnGradSteps: 65_000, gaEnvSteps: 1_200_000 },
  touchControls: {
    // Throttle left, steering right. `start` is the physical left edge whatever
    // the page's writing direction, and a stacked column reads top-down, so gas
    // sits above the brake — the pedal you hold under the one you tap.
    start: [
      { code: 'ArrowUp', glyph: '▲', caption: 'גז' },
      { code: 'ArrowDown', glyph: '▼', caption: 'בלם' },
    ],
    end: [
      { code: 'ArrowLeft', glyph: '◀', caption: 'שמאלה' },
      { code: 'ArrowRight', glyph: '▶', caption: 'ימינה' },
    ],
    startStacked: true,
  },
};

export const GAMES: Record<GameId, GameModule> = { racing };

export const GAME_IDS = Object.keys(GAMES) as GameId[];

export function getGame(id: string): GameModule {
  const g = GAMES[id as GameId];
  if (!g) throw new Error(`unknown game: ${id}`);
  return g;
}

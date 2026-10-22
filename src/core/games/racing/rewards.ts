import type { EnvSpec, RewardChannelDef, RewardPreset } from '../types';
import { t, translated } from '../../../i18n/dict';

/** Sensor rays fanned across the front of the car. */
export const SENSOR_COUNT = 9;
export const SENSOR_MAX = 220;
export const SENSOR_SPREAD = Math.PI * 0.75;

export const OBS_SIZE = 24;
export const OBS_VERSION = 1;

/**
 * throttle (gas / coast / brake) x steering (left / straight / right). The
 * words are in the dictionary (`racing.actions`); the count is what a model's
 * shape depends on.
 */
export const ACTION_COUNT = 9;

/**
 * Every channel is a ten-notch slider. The numbers below are the weights the
 * environment actually adds up; the user only ever sees the notch and the two
 * words at its ends.
 *
 * Every slider asks one question - how much does this matter to you - and 10 is
 * always "a lot". For a bonus that means a bigger bonus; for a penalty it means
 * a *harsher* penalty, so those channels list their weights from 0 down. Moving
 * any slider right always means "more of this", which is what anybody expects
 * without reading the labels. (Saved models store weights, not notches, and
 * `levelOf` maps a weight back to its notch, so the order is display only.)
 *
 * `defaultLevel` is chosen so a fresh model starts on exactly the weights that
 * were the defaults before the sliders existed - the balance that is known to
 * train a decent driver - with one exception, the wall, explained there.
 */
export const RACING_REWARDS: RewardChannelDef[] = [
  translated(
    {
      key: 'checkpoint',
      levels: [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8],
      defaultLevel: 5,
    },
    () => t().racing.channels.checkpoint,
  ),
  translated(
    {
      key: 'lap',
      levels: [1, 2, 4, 6, 8, 10, 14, 18, 24, 30],
      defaultLevel: 6,
    },
    () => t().racing.channels.lap,
  ),
  translated(
    {
      key: 'finish',
      levels: [2, 5, 8, 12, 16, 20, 30, 40, 60, 80],
      defaultLevel: 6,
    },
    () => t().racing.channels.finish,
  ),
  translated(
    {
      key: 'speed',
      levels: [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25],
      defaultLevel: 5,
    },
    () => t().racing.channels.speed,
  ),
  translated(
    {
      key: 'wallHit',
      levels: [0, -0.1, -0.3, -0.6, -1, -1.5, -2, -3, -4, -6],
      // -3, a harsher default than the -1 the table started with. Since the tyres
      // got a limit (physics 2) a crash costs real time, and a model charged -1
      // for one learned to corner on the wall; at -3 it learns to brake instead.
      defaultLevel: 8,
    },
    () => t().racing.channels.wallHit,
  ),
  translated(
    {
      // The only channel that crosses zero. At the top notches contact with another
      // car pays, and the model learns to lean on people instead of avoiding them.
      key: 'carHit',
      levels: [-4, -2.5, -1.5, -1, -0.5, -0.2, 0, 0.3, 0.8, 1.5],
      defaultLevel: 5,
    },
    () => t().racing.channels.carHit,
  ),
  translated(
    {
      key: 'reverse',
      levels: [0, -0.05, -0.1, -0.2, -0.3, -0.5, -0.8, -1.2, -2, -3],
      defaultLevel: 5,
    },
    () => t().racing.channels.reverse,
  ),
  translated(
    {
      key: 'idle',
      levels: [0, -0.02, -0.05, -0.1, -0.15, -0.3, -0.5, -0.8, -1.2, -2],
      defaultLevel: 5,
    },
    () => t().racing.channels.idle,
  ),
  translated(
    {
      key: 'timeStep',
      levels: [0, -0.001, -0.002, -0.003, -0.005, -0.01, -0.015, -0.02, -0.03, -0.05],
      defaultLevel: 5,
    },
    () => t().racing.channels.timeStep,
  ),
  translated(
    {
      key: 'overtake',
      levels: [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 1.8, 2.5, 4],
      defaultLevel: 5,
    },
    () => t().racing.channels.overtake,
  ),
];

/**
 * Three styles over the same table, for the first model of someone who does not
 * want to think about ten sliders yet. Balanced is the defaults themselves; the
 * other two move only the channels that decide character - speed, the wall,
 * contact, overtaking and the clock - and leave the ones that teach a car to
 * follow the road alone, because a style should change how it drives, not
 * whether it learns to drive at all.
 */
export const RACING_PRESETS: RewardPreset[] = [
  translated(
    {
      id: 'careful',
      levels: { speed: 4, wallHit: 10, carHit: 2, overtake: 3, timeStep: 4 },
    },
    () => t().racing.presets.careful,
  ),
  translated(
    {
      id: 'balanced',
      levels: {},
    },
    () => t().racing.presets.balanced,
  ),
  translated(
    {
      id: 'aggressive',
      levels: { speed: 8, wallHit: 6, carHit: 7, overtake: 8, timeStep: 7 },
    },
    () => t().racing.presets.aggressive,
  ),
];

export const RACING_SPEC: EnvSpec = translated(
  {
    id: 'racing',
    obsSize: OBS_SIZE,
    obsVersion: OBS_VERSION,
    rewardChannels: RACING_REWARDS,
    presets: RACING_PRESETS,
  },
  () => ({ name: t().racing.name, actions: t().racing.actions, scoreLabel: t().racing.scoreLabel }),
);

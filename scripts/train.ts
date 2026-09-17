/**
 * Headless training probe. Runs the exact loop the worker runs, so hyper-parameters
 * and reward tables can be tuned without touching the UI.
 *
 *   npx tsx scripts/train.ts [gameId] [episodes] [key=value ...]
 *   npx tsx scripts/train.ts racing 400 trackId=technical nCars=4
 */
import { getGame } from '../src/core/games/registry';
import { defaultRewards } from '../src/core/games/types';
import { Trainer } from '../src/core/rl/trainer';
import { GaTrainer } from '../src/core/rl/ga';
import type { TrainerLike } from '../src/core/rl/trainerTypes';

const gameId = process.argv[2] ?? 'racing';
const episodes = Number(process.argv[3] ?? 300);
const algorithm = process.argv.includes('--ga') ? 'ga' : 'dqn';

const game = getGame(gameId);
const config = game.defaultConfig();
for (const arg of process.argv.slice(4)) {
  if (arg.startsWith('--')) continue;
  const [k, v] = arg.split('=');
  if (!k || v === undefined) continue;
  config[k] = v === 'true' ? true : v === 'false' ? false : Number.isNaN(Number(v)) ? v : Number(v);
}

// Training episodes should be shorter than the defaults used for a real match.
if (gameId === 'racing') Object.assign(config, { laps: 2, maxSteps: 1500 });

console.log(`${game.spec.name} [${algorithm}]: ${game.describeConfig(config)}`);

const rewards = defaultRewards(game.spec);
const trainer: TrainerLike =
  algorithm === 'ga'
    ? new GaTrainer({ gameId, config, rewards, hyper: {}, seed: 17 })
    : new Trainer({ gameId, config, rewards, hyper: { warmup: 2000 }, seed: 17 });

const t0 = Date.now();
const rewardWindow: number[] = [];
const scoreWindow: number[] = [];

for (let done = 0; done < episodes; ) {
  const stats = trainer.stepOnce();
  if (!stats) continue;
  done++;
  rewardWindow.push(stats.reward);
  scoreWindow.push(stats.score);
  if (rewardWindow.length > 20) {
    rewardWindow.shift();
    scoreWindow.shift();
  }
  if (done % (algorithm === 'ga' ? 5 : 20) === 0) {
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const sps = Math.round(stats.envSteps / ((Date.now() - t0) / 1000));
    console.log(
      `${algorithm === 'ga' ? 'gen' : 'ep '} ${String(done).padStart(4)}  reward ${avg(rewardWindow).toFixed(1).padStart(9)}` +
        `  ${game.spec.scoreLabel} ${avg(scoreWindow).toFixed(2)}` +
        `  eps ${stats.epsilon.toFixed(3)}  loss ${stats.loss.toFixed(4)}  ${sps} envSteps/s`,
    );
  }
}

console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(1)}s, ${trainer.gradSteps} updates, ${trainer.envSteps} env steps`);

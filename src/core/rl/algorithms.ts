import { t, translated } from '../../i18n/dict';

export type AlgorithmId = 'dqn' | 'ga';

/**
 * How a model learns, in words anybody can choose between.
 *
 * The technical name is kept, but it is not what the button says: "DQN" tells a
 * newcomer nothing about what will happen to their car, while "learns as it
 * drives" does. The labels also keep the dashboard honest - a generation is not
 * an episode, and the two methods count progress differently.
 */
export interface AlgorithmInfo {
  id: AlgorithmId;
  /** What the picker shows. */
  name: string;
  /** The textbook name, shown quietly beside it. */
  technical: string;
  /** One line under the picker. */
  blurb: string;
  /** Unit of one entry on the progress chart. */
  episodeLabel: string;
  /** Plural of the same, for stat tiles. */
  episodesLabel: string;
  /** What "how hard it is still experimenting" is called here. */
  exploreLabel: string;
}

export const ALGORITHMS: Record<AlgorithmId, AlgorithmInfo> = {
  dqn: translated({ id: 'dqn' as const }, () => t().algorithms.dqn),
  // Its episode words are the same as the other method's on purpose: reviewers
  // met "episodes", "attempts" and "generations" on one screen and took them for
  // three things. Under the hood one entry here is a generation.
  ga: translated({ id: 'ga' as const }, () => t().algorithms.ga),
};

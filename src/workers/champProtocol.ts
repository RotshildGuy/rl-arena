import type { ArenaEntry, RaceCard, RaceResult } from '../core/champ/types';

/** Weights travel as pairs: plain arrays survive every serialisation boundary. */
export type WeightPairs = Array<[string, string]>;

export type ToChamp =
  | { type: 'buildCard'; tag: string; round: number; entries: ArenaEntry[]; weights: WeightPairs }
  | { type: 'runDay'; tag: string; card: RaceCard; weights: WeightPairs };

export type FromChamp =
  | { type: 'card'; tag: string; card: RaceCard }
  | { type: 'result'; tag: string; result: RaceResult }
  | { type: 'error'; tag: string; message: string };

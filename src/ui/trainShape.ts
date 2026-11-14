import type { DqnHyper } from '../core/rl/dqn';
import type { GaHyper } from '../core/rl/ga';

export interface SlotHyper {
  hyper: DqnHyper;
  gaHyper: GaHyper;
}

/**
 * The settings one model trains and saves with.
 *
 * The draft holds a single network shape for the whole run, but a saved model's
 * weights only fit the network they were saved from. Two models of different
 * sizes on one grid (one built on a phone at 48-48, one on a laptop at 64-64)
 * made the second one fail to load - "weight size mismatch" - and the save that
 * followed had no weights to save. So a model continuing from saved weights keeps
 * its own shape; everything else comes from the draft.
 */
export function slotHyper(draft: SlotHyper, savedHidden: readonly number[] | null | undefined): SlotHyper {
  if (!savedHidden || savedHidden.length === 0) return { hyper: draft.hyper, gaHyper: draft.gaHyper };
  const hidden = savedHidden.slice();
  return {
    hyper: { ...draft.hyper, hidden },
    gaHyper: { ...draft.gaHyper, hidden: hidden.slice() },
  };
}

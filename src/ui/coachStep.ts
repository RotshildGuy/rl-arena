import type { Screen } from './store';

/**
 * Which step of the first run somebody is on.
 *
 * Getting a car onto the grid takes four things — a team name, a model, a
 * training run, a registration — and none of them is guessable from the screen
 * the app opens on. So one bubble at a time sits next to the control that does
 * the next thing, and the walkthrough ends by itself the moment there is a car
 * on the grid.
 *
 * The decision is kept here, as a pure function of the account's state, for two
 * reasons. It is checked in `scripts/sanity.ts` rather than by clicking through
 * the app six times; and it makes explicit that there is no step counter and
 * nothing is remembered. Close the tab halfway through, come back on another
 * day or another device, and the guide is wherever the account actually is.
 */
export type CoachStep =
  /** No team name yet — the input on the championship screen. */
  | 'name'
  /** Name saved, nothing built: the way to the garage is the nav tab. */
  | 'garage'
  /** In the garage with nothing in it — the button that starts a new model. */
  | 'create'
  /** Setting a training run up — the button that starts it. */
  | 'setup'
  /** Training is running: stop when the driving is good enough. */
  | 'save'
  /** A saved model with no car on the grid — the register button on its card. */
  | 'enter'
  /** The same, from another screen: the garage is where that button lives. */
  | 'unregistered'
  | null;

export interface CoachState {
  screen: Screen;
  /** The team name, empty until it is saved. */
  competitor: string;
  /** How many models are in the library; null while it is still being read. */
  models: number | null;
  /** True once a model of theirs is on the grid. */
  registered: boolean;
}

export function coachStepFor({ screen, competitor, models, registered }: CoachState): CoachStep {
  // A car on the grid is the finish line: from here the app has nothing left to
  // explain, and the guide never appears again.
  if (registered) return null;

  // Reading the rules, watching a race or driving one: a nudge on top of any of
  // those is a nag rather than a guide.
  if (screen === 'info' || screen === 'broadcast' || screen === 'report' || screen === 'race') return null;

  if (!competitor.trim()) return 'name';

  // Until the library has actually been read, say nothing. A bubble that
  // guesses wrong and then swaps itself out reads as a glitch.
  if (models === null) return null;

  if (screen === 'training') return 'save';
  if (screen === 'trainSetup') return 'setup';
  if (models === 0) return screen === 'library' ? 'create' : 'garage';
  return screen === 'library' ? 'enter' : 'unregistered';
}

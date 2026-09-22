/**
 * Which team name wins when the browser and the account disagree.
 *
 * The account's, whenever it has one: it is the name every other device of this
 * person already races under, and the case this exists for is the second
 * device, where the browser knows nothing. A browser name only travels upwards
 * — into an account that has none yet, which is exactly what signing in for the
 * first time after typing a name looks like.
 *
 * On its own, free of storage and of the browser, so `npm run sanity` can check
 * it the way it checks the first-run guide: the rule is small, it decides what
 * every device of one person is called, and it is easier to reason about as a
 * function than as a sequence of reads and writes.
 */
export interface NameMerge {
  /** Take this name as mine, or null to keep what this browser has. */
  adopt: string | null;
  /** Send this name up to the account, or null to leave the account alone. */
  push: string | null;
}

export function resolveCompetitor(local: string, cloud: string): NameMerge {
  const mine = local.trim();
  const theirs = cloud.trim();
  if (theirs) return { adopt: theirs === mine ? null : theirs, push: null };
  return { adopt: null, push: mine || null };
}

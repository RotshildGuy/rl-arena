import { teamColor } from '../core/champ/livery';
import { loadProfile, saveProfile } from '../storage/profile';
import { resolveCompetitor } from './competitorMerge';

const KEY = 'rl-arena.competitor';

/**
 * Who you are in the championship.
 *
 * The competitor name is the *team*: every model you enter races under it, and
 * their points add up into the constructors' table. localStorage is the copy
 * every screen reads while it renders — a header that waits on the network to
 * know your name is a header that pops in — and the account keeps the one that
 * travels (`storage/profile.ts`).
 */
export function getCompetitor(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setCompetitor(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // Private mode. The name just will not survive a reload.
  }
}

export function hasCompetitor(): boolean {
  return getCompetitor().length > 0;
}

export function myColor(): string {
  return teamColor(getCompetitor() || 'אני');
}

export { resolveCompetitor } from './competitorMerge';

/**
 * Reconcile the name with the account, once, after signing in.
 *
 * Never throws and never blocks anything: a profile that cannot be read leaves
 * the browser's own name exactly as it was, which is how this worked before
 * there were accounts at all.
 */
export async function pullCompetitor(): Promise<string | null> {
  try {
    const profile = await loadProfile();
    const { adopt, push } = resolveCompetitor(getCompetitor(), profile?.competitor ?? '');
    if (adopt) setCompetitor(adopt);
    if (push) await saveProfile(push);
    return adopt;
  } catch {
    return null;
  }
}

/** Send a name the person just chose up to their account. Best effort. */
export function pushCompetitor(name: string): void {
  void saveProfile(name.trim()).catch(() => {
    // The name is already saved in this browser; the account catches up on the
    // next rename or the next visit.
  });
}

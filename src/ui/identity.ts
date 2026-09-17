import { teamColor } from '../core/champ/livery';

const KEY = 'rl-arena.competitor';

/**
 * Who you are in the championship.
 *
 * The competitor name is the *team*: every model you enter races under it, and
 * their points add up into the constructors' table. It lives in localStorage
 * because anonymous auth gives an id but no name, and asking once is friendlier
 * than a signup.
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

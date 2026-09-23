import { nameProblem, normalizeName } from '../core/champ/names';
import { getArena } from '../storage/arena';
import { claimName } from '../storage/teamNames';
import { getCompetitor } from './identity';
import { invalidateChampionship } from './useChampionship';

export { NameTakenError } from '../storage/teamNames';

export class TeamNameError extends Error {}

/**
 * Change this account's team name, everywhere it shows.
 *
 * The name is checked, then claimed — which is where a name somebody else
 * already uses is refused — and only then carried onto the cars this account
 * has on the grid. The cars are the same cars either way: the grid, the
 * drivers and the team table all belong to the account, and the name on an
 * entry is only what gets printed next to it.
 *
 * Returns the name as it will be shown. The caller stores it.
 */
export async function changeTeamName(raw: string): Promise<string> {
  const name = normalizeName(raw);
  const issue = nameProblem(name);
  if (issue) throw new TeamNameError(issue);

  await claimName(name, getCompetitor() || undefined);
  await relabelMyCars(name).catch(() => {
    // The name is claimed and saved; the cars pick it up at their next update.
  });
  return name;
}

/** Put the team name on every car of this account that still wears another. */
async function relabelMyCars(team: string): Promise<void> {
  const arena = await getArena();
  const uid = await arena.uid();
  const stale = (await arena.listEntries()).filter((e) => e.uid === uid && !e.retired && e.team !== team);
  for (const entry of stale) await arena.putEntry({ ...entry, team, updatedAt: Date.now() }, null);
  if (stale.length) invalidateChampionship();
}

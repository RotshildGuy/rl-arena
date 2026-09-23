import { getArena } from '../storage/arena';
import { getStore } from '../storage';
import { deleteProfile } from '../storage/profile';
import { releaseName } from '../storage/teamNames';
import { getCompetitor, setCompetitor } from './identity';
import { invalidateChampionship } from './useChampionship';

export interface DeletionReport {
  entries: number;
  models: number;
}

/**
 * Erase everything this person has here.
 *
 * Two things it deliberately does not touch, and the privacy notice says so:
 * results of races that already happened, because the championship record is
 * append-only and rewriting history would make every table meaningless; and
 * other people's data, obviously. What it does remove is every model, every
 * entry on the grid, and the name stored in this browser — so nothing of theirs
 * takes part in another race and nothing is left to load.
 */
export async function deleteMyData(): Promise<DeletionReport> {
  const [arena, store] = await Promise.all([getArena(), getStore()]);
  const uid = await arena.uid();

  const mine = (await arena.listEntries()).filter((e) => e.uid === uid);
  for (const entry of mine) await arena.removeEntry(entry.id);

  const models = await store.list();
  for (const model of models) await store.remove(model.id);

  // Including the copy in the account: a name that comes back from the cloud on
  // the next load is the one thing a delete button must never do.
  await deleteProfile().catch(() => {});
  await releaseName(getCompetitor());
  setCompetitor('');
  invalidateChampionship();
  return { entries: mine.length, models: models.length };
}

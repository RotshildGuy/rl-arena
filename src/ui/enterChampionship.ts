import { driverTag } from '../core/champ/livery';
import { nameProblem, normalizeName } from '../core/champ/names';
import type { ArenaEntry } from '../core/champ/types';
import { getArena } from '../storage/arena';
import { getStore, newModelId, type ModelMeta } from '../storage';
import { getCompetitor } from './identity';
import { claimName, NameTakenError } from '../storage/teamNames';
import { invalidateChampionship } from './useChampionship';

export class EntryError extends Error {}

/**
 * Cars one team may field at a time.
 *
 * Two is what a real constructor enters, and it is also what keeps a grid of ten
 * from being four of one person's models: the interesting question is whose
 * driver is quickest, not who trained the most of them. A team at the limit
 * swaps: the garage offers the choice of which car steps aside.
 */
export const MAX_ENTRIES_PER_TEAM = 2;

/**
 * Put a model on the grid, or update the one that is already there.
 *
 * Re-entering a model that already has an entry keeps the *same* entry id, and
 * therefore the same championship points: a team bringing an upgrade does not
 * get a new driver. Uploading is the only way weights ever change mid-season, so
 * this is where "my model got better" turns into "my car got faster".
 */
export async function enterChampionship(model: ModelMeta): Promise<ArenaEntry> {
  // The account's name, not the one stamped on the model when it was trained:
  // a team is the account, and a model trained before a rename is still ours.
  const team = normalizeName(getCompetitor());
  const driver = normalizeName(model.name);
  if (!team) throw new EntryError('צריך להגדיר שם מתחרה לפני רישום לאליפות');
  if (model.gameId !== 'racing') throw new EntryError('האליפות מתקיימת במירוץ מכוניות בלבד');

  // Both names go onto a public leaderboard, so they are checked here rather
  // than at the keyboard: a model can be renamed at any time, and this is the
  // one moment the name becomes everybody else's problem.
  const teamIssue = nameProblem(team);
  if (teamIssue) throw new EntryError(`שם המתחרה — ${teamIssue}`);
  const driverIssue = nameProblem(driver);
  if (driverIssue) throw new EntryError(`שם המודל — ${driverIssue}`);

  // The name goes public here, so this is where it has to be ours. It is also
  // how a name chosen before names were unique gets claimed.
  try {
    await claimName(team);
  } catch (err) {
    if (err instanceof NameTakenError) throw new EntryError(err.message);
    throw err;
  }

  const [arena, store] = await Promise.all([getArena(), getStore()]);
  const rec = await store.load(model.id);
  if (!rec) throw new EntryError('לא הצלחתי לטעון את המשקולות של המודל');

  const uid = await arena.uid();
  // Strict: an entry list that came back empty because the read failed would
  // look exactly like "this model has never been registered", and the car it
  // already has on the grid would be duplicated instead of updated.
  const entries = await arena.listEntriesForWrite();
  const mine = entries.filter((e) => e.uid === uid);

  /**
   * The car this registration belongs to.
   *
   * Normally that is the entry made from this very model. The second lookup is
   * what stops a driver being split in two: a model that was exported and
   * imported again, or deleted and re-trained, arrives here with a new model id
   * even though it is the same driver of the same team — and a fresh entry for
   * it would mean a fresh set of points, with the season's results scattered
   * between two rows that are obviously one driver. The team name is not part
   * of it: every car of this account is this team, whatever it was called.
   */
  const existing =
    mine.find((e) => e.modelId === model.id) ??
    mine.find((e) => !e.retired && e.driver === driver);

  // Updating a car that is already out there is always allowed; it is only a
  // *new* car that can push a team over the limit. An entry left over from the
  // days of withdrawal counts as new: it is not on the grid, so bringing it back
  // is an arrival.
  if (!existing || existing.retired) {
    const onGrid = mine.filter((e) => !e.retired).length;
    if (onGrid >= MAX_ENTRIES_PER_TEAM) {
      throw new EntryError(
        `לכל קבוצה מותרים ${MAX_ENTRIES_PER_TEAM} רכבים על המסלול. הסירו רכב קיים כדי לרשום אחר במקומו`,
      );
    }
  }

  const entry: ArenaEntry = {
    id: existing?.id ?? newModelId(),
    uid,
    driver,
    team,
    gameId: model.gameId,
    algorithm: model.algorithm,
    arch: model.arch,
    obsVersion: model.obsVersion,
    tag: driverTag(driver),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    modelId: model.id,
    episodes: model.training.episodes,
    retired: false,
  };

  await arena.putEntry(entry, rec.weightsB64);
  invalidateChampionship();
  return entry;
}

/**
 * How far a car on the grid has fallen behind the model it came from.
 *
 * Two things can drift, and they drift for different reasons: weights, because
 * training carries on after registration and is deliberately not pushed on its
 * own; and the name, because a rename before this was wired up never reached the
 * entry. Both are repaired by the same button, and both need saying out loud —
 * a mismatch nobody is told about is one nobody fixes.
 */
export type EntryDrift = 'none' | 'name' | 'weights' | 'both';

export function entryDrift(entry: ArenaEntry, model: ModelMeta): EntryDrift {
  const nameOff = normalizeName(model.name) !== entry.driver;
  const weightsOff = model.training.episodes > entry.episodes;
  if (nameOff && weightsOff) return 'both';
  if (nameOff) return 'name';
  if (weightsOff) return 'weights';
  return 'none';
}

export const DRIFT_LABEL: Record<Exclude<EntryDrift, 'none'>, string> = {
  name: 'שם ישן על המסלול',
  weights: 'גרסה ישנה על המסלול',
  both: 'שם וגרסה ישנים על המסלול',
};

/** The car on the grid that came from this model, if there is one. */
export async function myEntryFor(modelId: string): Promise<ArenaEntry | null> {
  const arena = await getArena();
  const uid = await arena.uid();
  return (await arena.listEntries()).find((e) => e.uid === uid && e.modelId === modelId) ?? null;
}

/**
 * Follow a rename through to the grid.
 *
 * The driver name is a copy of the model's name taken at registration, so
 * renaming in the garage used to leave the championship showing the old one
 * with no way to correct it. The entry id — and therefore every point it has
 * scored — is untouched; only the name and the three-letter code change.
 *
 * Past results keep the old name, because a race card is a frozen snapshot of
 * who lined up. That is the intended behaviour: the results of a race are what
 * they were on the day.
 */
export async function renameEntry(entry: ArenaEntry, driver: string): Promise<void> {
  const name = normalizeName(driver);
  const issue = nameProblem(name);
  if (issue) throw new EntryError(`שם המודל — ${issue}`);
  const arena = await getArena();
  await arena.putEntry({ ...entry, driver: name, tag: driverTag(name), updatedAt: Date.now() }, null);
  invalidateChampionship();
}

/**
 * Take a car off the grid.
 *
 * Used when its model is deleted, when a team swaps one of its cars for
 * another, and directly from the championship screen — which is the only way to
 * reach an entry whose model is already gone.
 *
 * Removal is the only way off the grid: a car is either registered or it is
 * not. There used to be a third, withdrawn state, which left a model wearing a
 * "withdrawn" badge for the rest of the season with nothing to do about it.
 * Past results are unaffected either way — a race card is a frozen snapshot of
 * who lined up, so a season never rewrites itself when someone leaves.
 */
export async function removeEntry(entry: ArenaEntry): Promise<void> {
  const arena = await getArena();
  await arena.removeEntry(entry.id);
  invalidateChampionship();
}

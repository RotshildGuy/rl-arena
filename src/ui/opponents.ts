import { Policy } from '../core/rl/policy';
import { teamColor } from '../core/champ/livery';
import { HOUSE_DRIVERS, houseWeightsUrl, isHouseId } from '../core/champ/house';
import { getArena } from '../storage/arena';
import { getStore } from '../storage';

/**
 * Opponent ids carry their own source.
 *
 * A match can mix cars from your private garage with cars entered in the shared
 * championship, and the two live in different stores; tagging the id keeps the
 * distinction in one character instead of a parallel array.
 */
export const ARENA_PREFIX = 'arena:';

export interface LoadedOpponent {
  policy: Policy;
  name: string;
  team: string;
  color: string;
}

export async function loadOpponent(id: string): Promise<LoadedOpponent | null> {
  if (id.startsWith(ARENA_PREFIX) && isHouseId(id.slice(ARENA_PREFIX.length))) {
    // The house team's weights are public files, like the site itself.
    const entry = HOUSE_DRIVERS.find((h) => h.id === id.slice(ARENA_PREFIX.length))!;
    const res = await fetch(houseWeightsUrl(entry.id));
    if (!res.ok) return null;
    const { weightsB64 } = (await res.json()) as { weightsB64: string };
    return {
      policy: Policy.fromBase64(entry.arch.obsSize, entry.arch.hidden, entry.arch.nActions, weightsB64),
      name: entry.driver,
      team: entry.team,
      color: teamColor(entry.team),
    };
  }
  if (id.startsWith(ARENA_PREFIX)) {
    // A championship car of your own: in the cloud, only its owner may read its weights.
    const entryId = id.slice(ARENA_PREFIX.length);
    const arena = await getArena();
    const [entries, uid] = await Promise.all([arena.listEntries(), arena.uid()]);
    const entry = entries.find((e) => e.id === entryId);
    // Somebody else's car, picked before their weights were sealed: not asked for.
    if (!entry || entry.uid !== uid) return null;
    const weights = await arena.loadEntryWeights(entryId);
    if (!weights) return null;
    return {
      policy: Policy.fromBase64(entry.arch.obsSize, entry.arch.hidden, entry.arch.nActions, weights),
      name: entry.driver,
      team: entry.team,
      color: teamColor(entry.team),
    };
  }

  const store = await getStore();
  const rec = await store.load(id);
  if (!rec) return null;
  return {
    policy: Policy.fromBase64(rec.arch.obsSize, rec.arch.hidden, rec.arch.nActions, rec.weightsB64),
    name: rec.name,
    team: rec.owner || 'המוסך שלי',
    color: teamColor(rec.owner || 'המוסך שלי'),
  };
}

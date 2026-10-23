import { t } from './dict';
import { TRACK_DEFS } from '../core/games/racing/tracks';
import { HOUSE_TEAM, isHouseId } from '../core/champ/house';

/**
 * Names that are stored in Hebrew and shown in the reader's language.
 *
 * A race card is written once, by whichever client builds it first, and read by
 * everybody; its `name` stays the Hebrew one so every card is the same card. The
 * screen shows the round's name from here instead. The house team's drivers are
 * the same: their names are on every card they raced on, and translated only
 * when they are drawn.
 */

/** A circuit's name. One with no translation yet keeps the name in its definition. */
export function trackName(id: string): string {
  return t().tracks[id] ?? TRACK_DEFS.find((d) => d.id === id)?.name ?? id;
}

/** "Oval Grand Prix" - the name of the round run on a circuit. */
export function grandPrixTitle(trackId: string): string {
  return t().champ.grandPrix(trackName(trackId));
}

/** A driver's name as shown: the house drivers are translated, everybody else is who they said they are. */
export function driverName(entry: { id: string; driver: string }): string {
  return isHouseId(entry.id) ? (t().champ.house[entry.id] ?? entry.driver) : entry.driver;
}

/** A team's name as shown. */
export function teamName(team: string): string {
  return team === HOUSE_TEAM ? t().champ.houseTeam : team;
}

/** `driverName` for an entry that may be missing, as tables look them up by id. */
export function driverOf(entry: { id: string; driver: string } | undefined): string | undefined {
  return entry && driverName(entry);
}

/** `teamName` for an entry that may be missing. */
export function teamOf(entry: { team: string } | undefined): string | undefined {
  return entry && teamName(entry.team);
}

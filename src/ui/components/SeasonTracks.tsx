import { seasonRange, seasonRotation, trackForRound } from '../../core/champ/schedule';
import { useT } from '../../i18n';
import { trackName } from '../../i18n/names';

/**
 * The circuits a season visits, in the order it races them. Each season draws
 * its own from the pool, so "which tracks are coming" is no longer something
 * anybody knows by heart - and it is what a team trains for.
 */
export function SeasonTracks({ season, round, label }: { season: number; round?: number; label?: string }) {
  const c = useT().championship;
  const current = round === undefined ? null : trackForRound(round);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="dim tiny">{label ?? c.seasonTracks}</span>
      {seasonRotation(season).map((id) => (
        <span key={id} className={`pill small${id === current ? ' hot' : ''}`}>
          {trackName(id)}
          {debutsIn(id, season) && <span className="track-new">{c.newTrack}</span>}
        </span>
      ))}
    </div>
  );
}

/** A circuit no earlier season has raced on: no model has seen it under race conditions. */
function debutsIn(trackId: string, season: number): boolean {
  // The opening season is all debuts, which is no news to anybody.
  if (season <= 1) return false;
  const { first } = seasonRange(season);
  for (let r = 1; r < first; r++) if (trackForRound(r) === trackId) return false;
  return true;
}

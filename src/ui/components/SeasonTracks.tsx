import { seasonRotation, trackForRound } from '../../core/champ/schedule';
import { useT } from '../../i18n';
import { trackName } from '../../i18n/names';

/**
 * The circuits a season visits, in the order it races them. Each season draws
 * its own from the pool, so "which tracks are coming" is no longer something
 * anybody knows by heart - and it is what a team trains for.
 */
export function SeasonTracks({ season, round }: { season: number; round?: number }) {
  const c = useT().championship;
  const current = round === undefined ? null : trackForRound(round);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="dim tiny">{c.seasonTracks}</span>
      {seasonRotation(season).map((id) => (
        <span key={id} className={`pill small${id === current ? ' hot' : ''}`}>
          {trackName(id)}
        </span>
      ))}
    </div>
  );
}

import { seasonRotation, trackForRound } from '../../core/champ/schedule';
import { TRACK_DEFS } from '../../core/games/racing/tracks';

/**
 * The circuits a season visits, in the order it races them. Each season draws
 * its own from the pool, so "which tracks are coming" is no longer something
 * anybody knows by heart - and it is what a team trains for.
 */
export function SeasonTracks({ season, round }: { season: number; round?: number }) {
  const current = round === undefined ? null : trackForRound(round);
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className="dim tiny">מסלולי העונה:</span>
      {seasonRotation(season).map((id) => (
        <span key={id} className={`pill small${id === current ? ' hot' : ''}`}>
          {TRACK_DEFS.find((t) => t.id === id)?.name ?? id}
        </span>
      ))}
    </div>
  );
}

import { teamColor } from '../../core/champ/livery';

/**
 * The driver cell every table shares: a livery bar, the model's name, and the
 * team under it. Keeping it in one component is what makes qualifying, the
 * classification and the championship table feel like the same screen.
 */
export function DriverCell({
  driver,
  team,
  tag,
  color,
  note,
}: {
  driver: string;
  team: string;
  tag?: string;
  color?: string;
  note?: string;
}) {
  return (
    <div className="driver">
      <span className="livery" style={{ background: color ?? teamColor(team) }} />
      <div className="names">
        <span className="who">{driver}</span>
        <span className="team">
          {team}
          {note ? ` · ${note}` : ''}
        </span>
      </div>
      {tag && <span className="tag">{tag}</span>}
    </div>
  );
}

export function LiveryBar({ team, color }: { team: string; color?: string }) {
  return <span className="livery" style={{ background: color ?? teamColor(team) }} />;
}

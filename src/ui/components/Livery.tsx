import { teamColor } from '../../core/champ/livery';
import { EMBLEM_SHAPES, EMBLEM_SYMBOLS, type Emblem } from '../../core/champ/emblem';
import { useOneTeamPaint } from '../teamLooks';
import { Name } from './Name';

/**
 * The driver cell every table shares: a livery bar, the model's name, and the
 * team under it. Keeping it in one component is what makes qualifying, the
 * classification and the championship table feel like the same screen.
 *
 * Given the team's `uid`, it also reads what the team bought: its colour for
 * the bar and its emblem beside the team name.
 */
export function DriverCell({
  driver,
  team,
  tag,
  color,
  note,
  uid,
}: {
  driver: string;
  team: string;
  tag?: string;
  color?: string;
  note?: string;
  uid?: string;
}) {
  const bought = useOneTeamPaint(uid);
  return (
    <div className="driver">
      <span className="livery" style={{ background: color ?? bought?.color ?? teamColor(team) }} />
      <div className="names">
        <span className="who">
          <Name>{driver}</Name>
        </span>
        <span className="team">
          {bought?.emblem && <TeamEmblem emblem={bought.emblem} size={13} />}
          <Name>{team}</Name>
          {note ? ` · ${note}` : ''}
        </span>
      </div>
      {tag && <span className="tag">{tag}</span>}
    </div>
  );
}

/** A team's livery bar, in its bought colour when given its `uid`, and its emblem after it. */
export function LiveryBar({ team, color, uid, small }: { team: string; color?: string; uid?: string; small?: boolean }) {
  const bought = useOneTeamPaint(uid);
  const size = small ? { width: 4, height: 12 } : {};
  return (
    <>
      <span className="livery" style={{ background: color ?? bought?.color ?? teamColor(team), ...size }} />
      {bought?.emblem && <TeamEmblem emblem={bought.emblem} size={small ? 14 : 16} />}
    </>
  );
}

/** The emblem as an inline picture, the same paths the car is painted with. */
export function TeamEmblem({ emblem, size = 16, title }: { emblem: Emblem; size?: number; title?: string }) {
  const shape = EMBLEM_SHAPES[emblem.shape];
  const symbol = EMBLEM_SYMBOLS[emblem.symbol];
  if (!shape || !symbol) return null;
  return (
    <svg
      className="emblem"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={shape} fill={emblem.bg} stroke="rgba(5, 6, 10, 0.55)" strokeWidth={1.2} />
      <path d={symbol} fill={emblem.fg} fillRule="evenodd" />
    </svg>
  );
}

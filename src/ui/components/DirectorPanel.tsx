import type { RacingSnapshot } from '../../core/games/racing/env';
import { carAhead, carBehind, type DirectorState } from '../three/director';
import { lapTime, shortGap } from '../format';
import { useT } from '../../i18n';
import { Name } from './Name';
import { TeamEmblem } from './Livery';
import type { TowerCar } from './TimingTower';

/** Top speed in the physics, shown as a believable racing figure on screen. */
const KMH_PER_UNIT = 320 / 7;

/**
 * The director's side panel: what the camera is on, and the numbers that say
 * why. In a fight, both cars side by side.
 */
export function DirectorPanel({
  snap,
  shot,
  cars,
  teams,
  totalLaps,
}: {
  snap: RacingSnapshot;
  shot: DirectorState;
  cars: TowerCar[];
  /** Team name per grid slot. */
  teams: string[];
  totalLaps: number;
}) {
  const d = useT().broadcast.director;
  // Both cars whenever the shot has two: a battle, or a close finish.
  const featured = [shot.car, ...(shot.rival !== null && shot.reason !== 'start' ? [shot.rival] : [])];
  // The caption comes up just after the cut, never on it, and goes after four seconds.
  const since = snap.raceMs - shot.cutAt;
  return (
    <div className="director-panel">
      {/* The caption says why on the cut, then gets out of the way. */}
      <div className="eyebrow caption" style={{ opacity: since >= 400 && since < 4000 ? 1 : 0 }}>
        {d.reasons[shot.reason]}
      </div>
      <div className={featured.length > 1 ? 'pair' : ''}>
        {featured.map((i) => (
          <CarCard key={i} snap={snap} car={i} meta={cars[i]} team={teams[i] ?? ''} totalLaps={totalLaps} />
        ))}
      </div>
    </div>
  );
}

function CarCard({
  snap,
  car,
  meta,
  team,
  totalLaps,
}: {
  snap: RacingSnapshot;
  car: number;
  meta: TowerCar | undefined;
  team: string;
  totalLaps: number;
}) {
  const d = useT().broadcast.director;
  const c = snap.cars[car];
  if (!c || !meta) return null;
  const pos = snap.order.indexOf(car) + 1;
  const behind = carBehind(snap, car);
  const behindGap = behind !== null ? snap.cars[behind]?.intervalMs ?? 0 : null;
  const ahead = carAhead(snap, car);
  return (
    <div className="director-car" style={{ borderInlineStartColor: meta.color }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="pos">{pos}</span>
        {meta.look?.emblem && <TeamEmblem emblem={meta.look.emblem} size={22} />}
        <div style={{ minWidth: 0 }}>
          <div className="who">
            <Name>{meta.name}</Name>
          </div>
          <div className="tiny muted">{team}</div>
        </div>
      </div>
      <dl>
        <dt>{d.lap}</dt>
        <dd className="mono">
          {Math.min(totalLaps, c.lap + 1)} / {totalLaps}
        </dd>
        <dt>{d.speed}</dt>
        <dd className="mono">{Math.round(c.speed * KMH_PER_UNIT)}</dd>
        <dt>{d.ahead}</dt>
        <dd className="mono">{ahead === null ? '-' : shortGap(c.intervalMs)}</dd>
        <dt>{d.behind}</dt>
        <dd className="mono">{behindGap === null ? '-' : shortGap(behindGap)}</dd>
        <dt>{d.last}</dt>
        <dd className="mono">{lapTime(c.lastLapMs)}</dd>
        <dt>{d.best}</dt>
        <dd className="mono">{lapTime(c.bestLapMs)}</dd>
        {c.lastSectorsMs.some((s) => s !== null) && (
          <>
            <dt>{d.sectors}</dt>
            <dd className="mono">{c.lastSectorsMs.map((s) => (s === null ? '-' : (s / 1000).toFixed(1))).join(' · ')}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

import type { RacingSnapshot } from '../../core/games/racing/env';
import { lapTime, shortGap } from '../format';

export interface TowerCar {
  /** Grid slot, which is also the index into the snapshot. */
  car: number;
  name: string;
  tag: string;
  color: string;
  mine: boolean;
}

/**
 * The live order, the way a broadcast shows it.
 *
 * Interval to the car ahead rather than gap to the leader: mid-pack, the number
 * that tells you whether something is about to happen is the one in front of
 * you, not the one at the front of the race.
 */
export function TimingTower({
  snap,
  cars,
  mode = 'interval',
}: {
  snap: RacingSnapshot;
  cars: TowerCar[];
  mode?: 'interval' | 'gap';
}) {
  return (
    <div className="tower">
      {snap.order.map((carIdx, i) => {
        const meta = cars[carIdx];
        const c = snap.cars[carIdx];
        if (!meta || !c) return null;
        const retired = c.done && !c.finished;
        return (
          <div className={`row-t ${meta.mine ? 'me' : ''} ${retired ? 'out' : ''}`} key={carIdx}>
            <span className="p">{i + 1}</span>
            <span className="livery" style={{ background: meta.color }} />
            <span className="who">{meta.name}</span>
            <span className="gap">
              {retired
                ? 'פרש'
                : c.finished
                  ? lapTime(c.totalMs)
                  : i === 0
                    ? 'מוביל'
                    : shortGap(mode === 'gap' ? c.gapMs : c.intervalMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

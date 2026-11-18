import type { Radio } from '../../core/champ/radio';
import { useT } from '../../i18n';
import { isolated } from './Name';
import type { TowerCar } from './TimingTower';

/**
 * Team radio over the picture: who is talking, a little waveform, and the
 * exchange - the driver and the pit wall, the way a broadcast puts them on.
 */
export function RadioCard({ radio, cars, teams }: { radio: Radio; cars: TowerCar[]; teams: string[] }) {
  const b = useT().broadcast;
  const car = cars[radio.car];
  const takes = b.radio[radio.kind];
  const lines = takes[radio.variant % takes.length];
  const driver = car?.name ?? '-';
  return (
    <div className="radio-card" style={{ ['--team' as string]: car?.color ?? '#888' }} key={`${radio.at}:${radio.car}`}>
      <div className="radio-head">
        <span className="radio-wave" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
          ))}
        </span>
        <span className="radio-who">{b.radioFrom(isolated(driver))}</span>
      </div>
      {lines.map(([who, text], i) => (
        <div key={i} className={`radio-line ${who}`} style={{ animationDelay: `${i * 1.4}s` }}>
          <span className="radio-speaker">{who === 'driver' ? isolated(driver) : isolated(teams[radio.car] || b.radioTeam)}:</span>{' '}
          {text}
        </div>
      ))}
    </div>
  );
}

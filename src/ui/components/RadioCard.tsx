import type { Radio } from '../../core/champ/radio';
import { ITEM_BY_ID } from '../../core/champ/shop';
import type { CarLook } from '../../core/games/racing/render';
import type { RadioLine } from '../raceAudio';
import { t as words, useT } from '../../i18n';
import { isolated } from './Name';
import type { TowerCar } from './TimingTower';

/**
 * Team radio over the picture: who is talking, a little waveform, and the
 * exchange - the driver and the pit wall, the way a broadcast puts them on.
 */
export function RadioCard({ radio, cars, teams }: { radio: Radio; cars: TowerCar[]; teams: string[] }) {
  const b = useT().broadcast;
  const car = cars[radio.car];
  const lines = radioLines(radio, car?.look);
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

/**
 * The words of a radio call. A winner whose team has a radio quote (a pack
 * prize) says that instead of the usual first line; the pit wall still answers.
 */
export function radioLines(radio: Radio, look: CarLook | undefined): RadioLine[] {
  const takes = words().broadcast.radio[radio.kind];
  const lines = takes[radio.variant % takes.length] as RadioLine[];
  const quote = radio.kind === 'win' && look?.quote ? ITEM_BY_ID.get(look.quote) : undefined;
  if (!quote || quote.kind !== 'quote') return lines;
  const at = lines.findIndex(([who]) => who === 'driver');
  if (at < 0) return [['driver', quote.label], ...lines];
  return lines.map((l, i) => (i === at ? (['driver', quote.label] as RadioLine) : l));
}

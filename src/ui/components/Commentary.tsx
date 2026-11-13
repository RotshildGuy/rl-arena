import type { Comment, Commentator, Radio } from '../../core/champ/commentary';
import { useT } from '../../i18n';
import { lapTime } from '../format';
import { isolated } from './Name';
import type { TowerCar } from './TimingTower';

/** The newest commentary lines and the radio call on air, read off the commentator. */
export function commentaryAt(commentator: Commentator | null, raceMs: number) {
  return {
    lines: commentator?.recent(raceMs, 2) ?? [],
    radio: commentator?.onAir(raceMs) ?? null,
  };
}

/**
 * The written commentary: a strip under the picture with the newest line and
 * the one before it, dimmed. Always two lines high, so the picture above does
 * not jump each time a line arrives or ages out.
 */
export function CommentaryStrip({ lines, cars }: { lines: Comment[]; cars: TowerCar[] }) {
  const b = useT().broadcast;
  const text = (c: Comment) => {
    const words = b.commentary[c.kind];
    const say = words[c.variant % words.length];
    const name = (i: number | undefined) => (i === undefined ? '' : isolated(cars[i]?.name ?? '-'));
    return say({
      a: name(c.car),
      b: name(c.other),
      pos: c.pos ?? 0,
      time: c.ms !== undefined ? lapTime(c.ms) : '',
      gap: c.kind === 'lastLap' && c.ms ? `${(c.ms / 1000).toFixed(1)}s` : '',
    });
  };
  return (
    <div className="commentary" aria-live="polite" aria-label={b.commentaryTitle}>
      {[0, 1].map((slot) => {
        // The newest line is the last one; it takes the bottom row.
        const c = lines[lines.length - 2 + slot];
        return (
          <div key={c ? `${c.at}:${c.kind}:${c.car}` : `empty${slot}`} className={`line ${slot === 1 ? 'now' : 'before'}`}>
            {c && (
              <>
                <span className="livery" style={{ background: cars[c.car]?.color ?? '#888' }} />
                <span>{text(c)}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

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

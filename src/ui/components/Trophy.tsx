import { EMBLEM_SHAPES, EMBLEM_SYMBOLS } from '../../core/champ/emblem';
import type { CarLook } from '../../core/games/racing/render';

type TrophyKind = NonNullable<CarLook['trophy']>;

/** A cup with two handles on a stand, on the emblem's 24x24 box. */
const CUP =
  'M7 3 H17 V9 A5 5 0 0 1 7 9 Z M10.8 13.6 H13.2 V18 H16 V21 H8 V18 H10.8 Z ' +
  'M4 4 H6.6 V5.6 H5.6 A2.2 2.2 0 0 0 7.2 9.6 L7.5 11.2 A3.8 3.8 0 0 1 4 7 Z ' +
  'M20 4 H17.4 V5.6 H18.4 A2.2 2.2 0 0 1 16.8 9.6 L16.5 11.2 A3.8 3.8 0 0 0 20 7 Z';

/** What each trophy is drawn from: its own cup, or a drawing the emblem already has. */
const PATHS: Record<Exclude<TrophyKind, 'laurel'>, string> = {
  cup: CUP,
  star: EMBLEM_SYMBOLS.star,
  wheel: EMBLEM_SYMBOLS.wheel,
  crown: EMBLEM_SYMBOLS.crown,
  diamond: EMBLEM_SHAPES.diamond,
};

const GOLD = '#e6b422';

/**
 * The trophy over the winner on the podium (a pack prize). Paths only, like
 * the emblem, so it draws the same on every device and font.
 */
export function Trophy({ kind, className }: { kind: TrophyKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`trophy trophy-${kind} ${className ?? ''}`} aria-hidden="true">
      {kind === 'laurel' ? (
        // Two branches of leaves curving up round an open middle.
        <g fill={GOLD}>
          {[0, 1, 2, 3, 4].map((k) => {
            const a = Math.PI * (0.62 + k * 0.16);
            const x = 12 + Math.cos(a) * 8;
            const y = 13 - Math.sin(a) * 8 * -1;
            const deg = (a * 180) / Math.PI + 90;
            return (
              <g key={k}>
                <ellipse cx={x} cy={y} rx={1.4} ry={2.8} transform={`rotate(${deg} ${x} ${y})`} />
                <ellipse cx={24 - x} cy={y} rx={1.4} ry={2.8} transform={`rotate(${-deg} ${24 - x} ${y})`} />
              </g>
            );
          })}
        </g>
      ) : (
        <path
          d={PATHS[kind]}
          fill={kind === 'diamond' ? '#bff4ff' : GOLD}
          fillRule="evenodd"
          stroke="rgba(5, 6, 10, 0.55)"
          strokeWidth={0.6}
        />
      )}
    </svg>
  );
}

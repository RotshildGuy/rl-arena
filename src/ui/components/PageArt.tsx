/**
 * A small illustration at the head of each page, drawn here rather than an
 * emoji or a stock picture: one scene per page on a 96-unit tile, in white line
 * and fill over the tile's own ground (the sunset gradient in the dark theme,
 * near-black with a red glow in the light one - the same as the headline card),
 * with one warm highlight colour.
 *
 * Classes: `l` a white line, `w` white, `s` soft white, `k` shade, `h` highlight,
 * `lh` a highlight line.
 */
import type { ReactNode } from 'react';
import { WRENCH } from './Icon';

export type ArtKind =
  | 'championship'
  | 'standings'
  | 'garage'
  | 'play'
  | 'train'
  | 'shop'
  | 'packs'
  | 'bets'
  | 'design';

/** A racing car in profile, nose to the left, 72 wide, its wheels on y = 25.5. */
function Car({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="w" d="M0 18h15v3H0z" />
      <path className="w" d="M2 17.5 10 13l16-1 6-6h10l4 6h14l4-4h8v10h-6L2 19.5z" />
      <path className="w" d="M63 1h9v4h-9zM66 5h3v7h-3z" />
      <path className="k" d="M30 13h22v3H30z" />
      <circle className="h" cx="38" cy="6.5" r="4" />
      <circle className="k l" cx="16" cy="18" r="7" />
      <circle className="k l" cx="56" cy="18" r="7.5" />
      <circle className="w" cx="16" cy="18" r="2.4" />
      <circle className="w" cx="56" cy="18" r="2.4" />
    </g>
  );
}

function Sparkle({ x, y, r, c = 'w' }: { x: number; y: number; r: number; c?: string }) {
  const q = r * 0.32;
  return (
    <path
      className={c}
      d={`M${x} ${y - r}L${x + q} ${y - q}L${x + r} ${y}L${x + q} ${y + q}L${x} ${y + r}L${x - q} ${y + q}L${x - r} ${y}L${x - q} ${y - q}z`}
    />
  );
}

const SCENES: Record<ArtKind, ReactNode> = {
  championship: (
    <>
      <path className="l s-line" d="M8 80h80" />
      <path className="l" d="M22 10v34" />
      <path className="w" d="M22 11h26v18H22z" />
      <path className="k" d="M22 11h6.5v6H22zM35 11h6.5v6H35zM28.5 17H35v6h-6.5zM41.5 17H48v6h-6.5zM22 23h6.5v6H22zM35 23h6.5v6H35z" />
      <Car x={10} y={52} s={1} />
      <path className="l s-line" d="M84 56h8M86 64h6M82 72h10" />
      <Sparkle x={70} y={22} r={6} c="h" />
      <Sparkle x={80} y={36} r={3.5} />
    </>
  ),
  standings: (
    <>
      <path className="s" d="M12 52h24v30H12z" />
      <path className="w" d="M36 40h24v42H36z" />
      <path className="s" d="M60 60h24v22H60z" />
      <circle className="k" cx="24" cy="62" r="4" />
      <circle className="h" cx="48" cy="52" r="5" />
      <circle className="k" cx="72" cy="69" r="4" />
      <path className="h" d="M38 8h20v11a10 10 0 0 1-20 0z" />
      <path className="lh" d="M38 11h-5a6 6 0 0 0 6 9M58 11h5a6 6 0 0 1-6 9" />
      <path className="h" d="M45 28h6v5h-6zM41 33h14v4H41z" />
      <path className="w" d="M16 20l4 2-2 3.5-4-2zM78 16l3.5 2.5-2.5 3-3.5-2.5z" />
      <path className="h" d="M24 36l3 1-1 3-3-1zM73 40l3-1 1 3-3 1z" />
      <Sparkle x={84} y={30} r={4} />
    </>
  ),
  garage: (
    <>
      <path className="l s-line" d="M8 82h80" />
      <path className="s" d="M28 63l-4 19h14l-4-19zM62 63l-4 19h14l-4-19z" />
      <Car x={12} y={40} />
      <g transform="translate(50 -2) scale(1.7)">
        <path className="w" d={WRENCH} transform="rotate(-45 12 12)" />
      </g>
      <Sparkle x={20} y={20} r={5} c="h" />
    </>
  ),
  play: (
    <>
      <path className="track" d="M6 74C22 44 46 88 64 58S86 30 92 18" />
      <path className="l dash" d="M6 74C22 44 46 88 64 58S86 30 92 18" />
      <path
        className="w"
        transform="translate(14 10) scale(2.85)"
        d="M7 8h10a4 4 0 0 1 3.9 3.1l.9 4.3a2.4 2.4 0 0 1-4.2 2L15.5 15h-7l-2.1 2.4a2.4 2.4 0 0 1-4.2-2l.9-4.3A4 4 0 0 1 7 8z"
      />
      <path className="k" d="M33 39h4v14h-4zM28 44h14v4H28z" />
      <circle className="h" cx="59" cy="41.5" r="3.2" />
      <circle className="k" cx="65" cy="47.5" r="3.2" />
    </>
  ),
  train: (
    <>
      <path
        className="l s-line"
        d="M20 30 44 20M20 30 44 42M20 30 44 64M20 52 44 20M20 52 44 42M20 52 44 64M20 74 44 42M20 74 44 64M44 20 72 32M44 42 72 32M44 42 72 58M44 64 72 58M44 20 72 58M44 64 72 32"
      />
      <circle className="w" cx="20" cy="30" r="6" />
      <circle className="w" cx="20" cy="52" r="6" />
      <circle className="w" cx="20" cy="74" r="6" />
      <circle className="s" cx="44" cy="20" r="6" />
      <circle className="w" cx="44" cy="42" r="6" />
      <circle className="s" cx="44" cy="64" r="6" />
      <circle className="h" cx="72" cy="32" r="7" />
      <circle className="w" cx="72" cy="58" r="6" />
      <path className="lh" d="M80 32h10M86 27l4 5-4 5" />
    </>
  ),
  shop: (
    <>
      <path className="s" d="M31 25h18v12H31z" />
      <path className="w" d="M36 18h8v7h-8z" />
      <rect className="w" x="26" y="36" width="28" height="48" rx="6" />
      <path className="h" d="M26 52h28v16H26z" />
      <circle className="h" cx="56" cy="18" r="3" />
      <circle className="h" cx="65" cy="13" r="2.4" />
      <circle className="w" cx="63" cy="23" r="2.2" />
      <circle className="h" cx="72" cy="20" r="2" />
      <circle className="w" cx="73" cy="9" r="1.6" />
      <circle className="w" cx="78" cy="27" r="1.4" />
      <circle className="w" cx="70" cy="66" r="8" />
      <circle className="k l" cx="78" cy="78" r="6.5" />
    </>
  ),
  packs: (
    <>
      <path className="l s-line" d="M48 40V8M48 40 22 18M48 40 74 18M48 40 10 36M48 40 86 36" />
      <rect className="w" x="22" y="52" width="52" height="32" rx="3" />
      <path className="k" d="M22 52h52v5H22z" />
      <rect className="w" x="16" y="38" width="64" height="15" rx="3" />
      <path className="h" d="M43 38h10v46H43z" />
      <path className="h" d="M48 38c-6-14-22-15-18-4 2 4 10 4 18 4zM48 38c6-14 22-15 18-4-2 4-10 4-18 4z" />
      <Sparkle x={16} y={64} r={5} c="h" />
      <Sparkle x={82} y={66} r={4} />
    </>
  ),
  bets: (
    <>
      <g transform="rotate(-12 30 50)">
        <rect className="w" x="12" y="32" width="36" height="36" rx="8" />
        <circle className="k" cx="21" cy="41" r="3.2" />
        <circle className="k" cx="30" cy="50" r="3.2" />
        <circle className="k" cx="39" cy="59" r="3.2" />
      </g>
      <g transform="rotate(14 66 58)">
        <rect className="s" x="50" y="42" width="32" height="32" rx="7" />
        <circle className="w" cx="59" cy="51" r="2.8" />
        <circle className="w" cx="73" cy="51" r="2.8" />
        <circle className="w" cx="59" cy="65" r="2.8" />
        <circle className="w" cx="73" cy="65" r="2.8" />
      </g>
      <circle className="h" cx="70" cy="20" r="11" />
      <circle className="lk" cx="70" cy="20" r="6.5" />
      <Sparkle x={22} y={16} r={5} />
    </>
  ),
  design: (
    <>
      <path
        className="w"
        d="M46 12a34 34 0 1 0 0 68c5.6 0 8-4 6.4-8.4-2-5.2.8-9.6 6.4-9.6H66a14 14 0 0 0 14-14c0-20-15.2-36-34-36z"
      />
      <circle className="c1" cx="27" cy="44" r="5.5" />
      <circle className="c2" cx="34" cy="28" r="5.5" />
      <circle className="c3" cx="52" cy="26" r="5.5" />
      <circle className="c4" cx="64" cy="38" r="5.5" />
      <path className="k" d="M60 84 82 56l5 4-22 28z" />
      <path className="h" d="M82 56l6-8c2-2.5 6 .8 4 3.3l-5 8.7z" />
    </>
  ),
};

export function PageArt({ kind, bare }: { kind: ArtKind; bare?: boolean }) {
  return (
    <svg className={bare ? 'page-art bare' : 'page-art'} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      {SCENES[kind]}
    </svg>
  );
}

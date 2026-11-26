/**
 * Our own icon set, in place of emoji. An emoji is drawn by the phone, so the
 * same button looked different on every device and clashed with the rest of
 * the page; these are drawn here, on one 24-unit grid, with one rounded stroke,
 * and take the colour of the text around them.
 *
 * Shapes marked `f` are filled with the current colour, `s` softly.
 */
import type { ReactNode } from 'react';

const ICONS = {
  flag: (
    <>
      <path d="M5 21V3.5" />
      <path d="M5 4.5h13.5l-2.3 4.25 2.3 4.25H5" />
      <path className="f" d="M5 4.5h3.5v4.25H5zM12 4.5h3.5v4.25H12zM8.5 8.75H12V13H8.5z" />
    </>
  ),
  podium: (
    <>
      <path d="M3 20.5h18" />
      <path d="M9 20.5V8.5h6v12" />
      <path d="M3.5 20.5V12.5H9M15 14.5h5.5v6" />
      <path className="f" d="M12 3l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.1l2-.3z" />
    </>
  ),
  wrench: (
    <path d="M15.5 3.5a4.5 4.5 0 0 0-4.2 6.1L4.2 16.7a2.1 2.1 0 0 0 3 3l7.1-7.1a4.5 4.5 0 0 0 6.1-4.2l-2.7 2.7-2.6-.5-.5-2.6z" />
  ),
  gamepad: (
    <>
      <path d="M7 8h10a4 4 0 0 1 3.9 3.1l.9 4.3a2.4 2.4 0 0 1-4.2 2L15.5 15h-7l-2.1 2.4a2.4 2.4 0 0 1-4.2-2l.9-4.3A4 4 0 0 1 7 8z" />
      <path d="M7.5 10.3v3.4M5.8 12h3.4" />
      <circle className="f" cx="15.6" cy="11.1" r="1" />
      <circle className="f" cx="17.5" cy="13" r="1" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1.1 12.5H6.1z" />
      <path d="M9 10.5V6.5a3 3 0 0 1 6 0v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  chat: (
    <>
      <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5l-5 4v-4H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
      <path d="M10.5 17.8h3" />
    </>
  ),
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z" />,
  warning: (
    <>
      <path d="M12 4 2.8 19.5h18.4z" />
      <path d="M12 10v4.2" />
      <circle className="f" cx="12" cy="16.9" r="1.05" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle className="f" cx="8.6" cy="8.6" r="1.35" />
      <circle className="f" cx="12" cy="12" r="1.35" />
      <circle className="f" cx="15.4" cy="15.4" r="1.35" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  radio: (
    <>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <path d="M4.5 13.5h3v5.5H6a1.5 1.5 0 0 1-1.5-1.5zM19.5 13.5h-3v5.5H18a1.5 1.5 0 0 0 1.5-1.5z" />
      <path d="M18 19c0 1.4-1.8 2-4 2" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5.2 12.5V20h13.6v-7.5M12 8.5V20" />
      <path d="M12 8.5C10.5 5 6.5 4.6 6.5 6.8c0 1.5 2.5 1.7 5.5 1.7zM12 8.5c1.5-3.5 5.5-3.9 5.5-1.7 0 1.5-2.5 1.7-5.5 1.7z" />
    </>
  ),
  sparkle: (
    <>
      <path className="f" d="M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z" />
      <path className="f" d="M18.5 15l.75 1.75 1.75.75-1.75.75-.75 1.75-.75-1.75-1.75-.75 1.75-.75z" />
    </>
  ),
  tag: (
    <>
      <path d="M4 4h7.5l8.5 8.5-7.5 7.5L4 11.5z" />
      <circle className="f" cx="8.2" cy="8.2" r="1.4" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.3.2-2.4 1.6-2.4H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z" />
      <circle className="f" cx="7.8" cy="11.2" r="1.15" />
      <circle className="f" cx="9.6" cy="7.5" r="1.15" />
      <circle className="f" cx="14" cy="7" r="1.15" />
      <circle className="f" cx="16.8" cy="10" r="1.15" />
    </>
  ),
  star: <path className="f" d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle className="f" cx="12" cy="15.5" r="1.3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  rotate: (
    <>
      <rect x="8" y="6" width="9" height="15" rx="2" />
      <path d="M3.5 10A8 8 0 0 1 9.5 3" />
      <path d="M9.5 3 7 2.2M9.5 3l-.9 2.4" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 13.5V9.5M10 3h4M12 3v3.5M18 7l1.3-1.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      <path className="f" d="M7.5 13h3v3h-3z" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5a3 3 0 0 0 3 4.2M16.5 6h3a3 3 0 0 1-3 4.2" />
      <path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z" />
    </>
  ),
  bolt: <path className="f" d="M13.5 2.5 5 13.5h6L10 21.5l8.5-11h-6z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" style={{ strokeWidth: 3 }} />,
  play: <path className="f" d="M8 5.5v13l10.5-6.5z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

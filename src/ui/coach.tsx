import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getStore } from '../storage';
import { useApp } from './store';
import { useChampionship } from './useChampionship';
import { coachStepFor, type CoachStep } from './coachStep';

export type { CoachStep };

/**
 * Bumped whenever the model library changes, so the guide can re-read it.
 *
 * Models are created in one place (`saveModel`) and removed, imported or
 * duplicated in another (the garage, which refreshes itself after every
 * change), and both say so here. Polling the library on a timer would do the
 * same job and cost something on every device that finished the walkthrough
 * months ago.
 */
let version = 0;
const listeners = new Set<() => void>();

export function modelsChanged(): void {
  version += 1;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getVersion(): number {
  return version;
}

/**
 * Which bubble, if any, belongs on the screen right now.
 *
 * The decision itself is in `coachStep.ts`; this is the part that has to watch
 * three different places for it — the team name in the store, the library on
 * disk, and the grid in the championship state.
 */
export function useCoachStep(): CoachStep {
  const screen = useApp((s) => s.screen);
  const gameId = useApp((s) => s.gameId);
  const competitor = useApp((s) => s.competitor);
  const { state } = useChampionship();
  const libraryVersion = useSyncExternalStore(subscribe, getVersion);
  const [models, setModels] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await getStore();
      const list = await store.list(gameId);
      if (!cancelled) setModels(list.length);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, libraryVersion, screen]);

  const registered = state ? state.entries.some((e) => e.uid === state.uid && !e.retired) : false;
  return coachStepFor({ screen, competitor, models, registered });
}

/** Room left around a bubble: away from the control, and away from the edges. */
const GAP = 10;
const EDGE = 10;
/** Wide enough for a sentence, narrow enough to read in one go. Also in the CSS. */
const MAX_WIDTH = 280;

/**
 * The bubble, floated over the page and pointed back at its control.
 *
 * It is rendered into `document.body` and placed in viewport coordinates
 * rather than sitting next to the control in the page. Sitting in the page is
 * simpler and is how this started, but a bubble is by definition wider than
 * the thing it points at, so sooner or later one sticks out of a panel that
 * clips its overflow and the sentence is cut in half. Out here nothing can
 * clip it, and the only thing that can crop it is the screen itself — which is
 * what the clamping below is for: the bubble is kept inside the viewport, and
 * the arrow slides along it to go on pointing at the right place.
 */
function CoachBubble({ anchor, text }: { anchor: HTMLElement; text: string }) {
  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const [, bump] = useState(0);

  /**
   * Follow the control on the frame clock. It moves when the page scrolls, when
   * a panel inside the page scrolls, when the window is resized and when the
   * layout reflows around it. Watching the rectangle itself is one small read a
   * frame, it cannot miss any of those, and only the guide ever runs it.
   */
  useEffect(() => {
    const redraw = () => bump((n) => n + 1);
    // Scrolling and resizing are events, and they are most of it. Capture, so
    // that a panel scrolling inside the page counts and not only the page.
    window.addEventListener('resize', redraw);
    window.addEventListener('scroll', redraw, true);

    // The rest — a layout reflowing above the control, a card opening, a font
    // arriving — announces nothing, so the rectangle is also watched directly.
    // One read a frame, and only while a bubble is on screen.
    let id = 0;
    let last = '';
    const tick = () => {
      const r = anchor.getBoundingClientRect();
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        redraw();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', redraw);
      window.removeEventListener('scroll', redraw, true);
      cancelAnimationFrame(id);
    };
  }, [anchor]);

  // The visible area, which is not `innerWidth`: that counts the scrollbar,
  // and on an RTL page the scrollbar is on the left.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const cap = Math.min(MAX_WIDTH, vw - 2 * EDGE);

  /**
   * Measure once, off-screen, then pin that width.
   *
   * A box with no width of its own is only as wide as the room to the right of
   * wherever it was put — so a bubble placed near one edge would be squeezed
   * into a column and then measured as a column, and the placement computed
   * from that measurement would be wrong. Measuring at the left edge, where the
   * whole screen is available, gives the width the text actually wants, and
   * that width is then set explicitly so the placement cannot change it back.
   *
   */
  // The viewport is part of the key: resizing can change the width the text
  // wants, so the bubble is measured again when it does.
  const key = `${text}|${cap}|${vw}x${vh}`;
  const [natural, setNatural] = useState<{ w: number; h: number; key: string } | null>(null);
  useLayoutEffect(() => {
    if (bubble && natural?.key !== key) setNatural({ w: bubble.offsetWidth, h: bubble.offsetHeight, key });
  }, [bubble, key, natural]);

  /**
   * Where the box landed, against where it was put.
   *
   * `top` and `left` are not always read in the coordinates a rectangle is
   * reported in. This page is RTL, so on a browser with classic scrollbars the
   * bar is on the *left*, and a fixed box at zero is drawn a scrollbar's width
   * from where `getBoundingClientRect` calls zero. Rather than enumerate the
   * cases, the bubble is placed, asked where it ended up, and the difference is
   * kept and added from then on: it settles in one frame and it survives
   * anything else that might shift the origin.
   */
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });

  const placed = natural !== null && natural.key === key;
  let style: React.CSSProperties = { top: 0, left: 0, visibility: 'hidden' };
  let want: { left: number; top: number } | null = null;
  let below = true;

  if (placed) {
    const rect = anchor.getBoundingClientRect();
    const { w, h } = natural;
    // Below the control, unless it sits low enough that the bubble would not
    // fit under it — on a phone the navigation bar is at the bottom.
    below = rect.bottom + GAP + h <= vh - EDGE || rect.top - GAP - h < EDGE;
    const centre = rect.left + rect.width / 2;
    const left = Math.max(EDGE, Math.min(centre - w / 2, Math.max(EDGE, vw - w - EDGE)));
    want = { left, top: below ? rect.bottom + GAP : rect.top - GAP - h };
    style = {
      top: want.top + nudge.dy,
      left: want.left + nudge.dx,
      width: w,
      // Where the control is, from the bubble's own left edge: when the bubble
      // has been pushed off-centre to stay on screen, the arrow stays on it.
      ['--coach-arrow' as string]: `${Math.min(Math.max(centre - left, 14), Math.max(14, w - 14))}px`,
    };
  }

  // No dependency list on purpose: checking where it ended up is something to
  // do after every render, and the half-pixel guard is what stops it there.
  useLayoutEffect(() => {
    if (!bubble || !want) return;
    const at = bubble.getBoundingClientRect();
    const dx = want.left - at.left;
    const dy = want.top - at.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setNudge((n) => ({ dx: n.dx + dx, dy: n.dy + dy }));
  });

  return createPortal(
    <div ref={setBubble} className={`coach ${below ? 'below' : 'above'}`} style={style} role="status" aria-live="polite">
      {text}
    </div>,
    document.body,
  );
}

/** Wraps the control a bubble points at, lights it up, and carries the bubble. */
export function CoachAnchor({
  on,
  text,
  className = '',
  children,
}: {
  on: boolean;
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  return (
    <span ref={setEl} className={`coach-anchor ${on ? 'lit' : ''} ${className}`.trim()}>
      {children}
      {on && el && <CoachBubble anchor={el} text={text} />}
    </span>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';

/**
 * The reward sliders behind a floating button. The button floats above the
 * bottom navigation (in a corner of the screen on a computer); a tap spreads
 * the sliders over the screen from just under the top bar down to the bottom
 * edge, behind the floating tab bar, see-through so the track keeps moving
 * behind them - and the same button folds them away again.
 *
 * Rendered into `body`: the screens sit inside glass cards whose
 * `backdrop-filter` would otherwise become the box a fixed element is placed
 * against, and the sheet would cover a card instead of the screen.
 */
export function SlidersSheet({ children }: { children: ReactNode }) {
  const o = useT().slidersSheet;
  const [open, setOpen] = useState(false);
  /** Where the top bar ends: the sheet starts there, and the bar stays in view. */
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!open) return;
    const bar = document.querySelector('.topbar');
    const measure = () => setTop(bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0);
    measure();
    const ro = bar ? new ResizeObserver(measure) : null;
    if (bar) ro?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return createPortal(
    <>
      {open && (
        <div className="sliders-sheet" role="dialog" aria-label={o.title} style={{ top }}>
          <div className="sliders-sheet-body">{children}</div>
        </div>
      )}
      <button
        className={`sliders-fab ${open ? 'primary' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? o.hide : o.show}
      </button>
    </>,
    document.body,
  );
}

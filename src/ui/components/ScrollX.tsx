import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A wide table that scrolls sideways inside its own box, with a second
 * scrollbar above it on a computer.
 *
 * A long classification puts its own scrollbar at the bottom, so on a desktop
 * the reader has to scroll the page all the way down just to slide the table
 * across. The top bar is a mirror: an empty strip as wide as the table, kept
 * in step with the box in both directions. Phones scroll a table with a finger
 * anywhere on it, so the mirror is only drawn for a mouse (`pointer: fine`)
 * and only while there is actually something to scroll.
 */
export function ScrollX({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [needed, setNeeded] = useState(false);
  /** More table past the far edge: a fade there says "this scrolls" on a phone too. */
  const [more, setMore] = useState(false);
  const checkMore = () => {
    const el = box.current;
    // RTL: scrollLeft runs from 0 towards negative as the table moves on; LTR, towards positive.
    if (el) setMore(Math.abs(el.scrollLeft) + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mouse = window.matchMedia('(pointer: fine)');
    const measure = () => {
      setWidth(el.scrollWidth);
      setNeeded(mouse.matches && el.scrollWidth > el.clientWidth + 1);
      checkMore();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    mouse.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mouse.removeEventListener('change', measure);
    };
  }, []);

  // Each side copies the other; the equality check stops the echo.
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <>
      {needed && (
        <div className="scroll-x-top" ref={top} onScroll={() => follow(top.current, box.current)}>
          <div style={{ width, height: 1 }} />
        </div>
      )}
      <div
        className={more ? 'scroll-x more' : 'scroll-x'}
        ref={box}
        onScroll={() => {
          follow(box.current, top.current);
          checkMore();
        }}
      >
        {children}
      </div>
    </>
  );
}

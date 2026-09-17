import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { TouchKey, TouchLayout } from '../../core/games/registry';

interface Props {
  layout: TouchLayout;
  /** The same key set the keyboard listener fills, so `humanAction` needs no changes. */
  keys: RefObject<Set<string>>;
}

/**
 * On-screen controls.
 *
 * Buttons write the same key codes the physical keyboard produces, which keeps
 * every game's input mapping in one place (`humanAction` in the registry).
 *
 * Codes are reference-counted by pointer id: a layout may bind one code to two
 * buttons — a layout may put the same control under both thumbs — and releasing
 * one of them must
 * not cancel a press still held on the other.
 */
export function TouchPad({ layout, keys }: Props) {
  const holders = useRef(new Map<string, Set<number>>());
  const [pressed, setPressed] = useState<Record<string, boolean>>({});

  const press = (id: string, code: string, pointerId: number) => {
    let set = holders.current.get(code);
    if (!set) {
      set = new Set();
      holders.current.set(code, set);
    }
    set.add(pointerId);
    keys.current?.add(code);
    setPressed((p) => ({ ...p, [id]: true }));
  };

  const release = (id: string, code: string, pointerId: number) => {
    const set = holders.current.get(code);
    if (set) {
      set.delete(pointerId);
      if (set.size === 0) {
        holders.current.delete(code);
        keys.current?.delete(code);
      }
    }
    setPressed((p) => (p[id] ? { ...p, [id]: false } : p));
  };

  const renderKey = (key: TouchKey, id: string) => {
    const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        // Keeps the release on this button even if the finger slides off it.
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Some engines refuse capture for synthetic or already-released pointers;
        // the button still works, it just loses the slide-off guarantee.
      }
      press(id, key.code, e.pointerId);
    };
    const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      release(id, key.code, e.pointerId);
    };
    return (
      <button
        key={id}
        type="button"
        className={`key ${pressed[id] ? 'on' : ''}`}
        aria-label={key.caption}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span>{key.glyph}</span>
        <span className="cap">{key.caption}</span>
      </button>
    );
  };

  return (
    <div className="touchpad">
      <div className={`group ${layout.startStacked ? 'stack' : ''}`}>
        {layout.start.map((k, i) => renderKey(k, `s${i}`))}
      </div>
      <div className={`group ${layout.endStacked ? 'stack' : ''}`}>
        {layout.end.map((k, i) => renderKey(k, `e${i}`))}
      </div>
    </div>
  );
}

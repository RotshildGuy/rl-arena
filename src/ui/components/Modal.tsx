import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dialog that can be dismissed three ways — the button, the backdrop, and
 * Escape — because a modal that traps someone is worse than no modal at all.
 *
 * Rendered into `document.body` rather than where it is written. A dialog is
 * over the whole page, so it must be compared against the whole page: opened
 * from inside the header — which has a z-index of its own — its backdrop was
 * trapped in that stacking context and came out *underneath* the first-run
 * guide's bubble, however high its own z-index was.
 */
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a dialog is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal card notched"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="head">
          <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 style={{ fontSize: 19 }}>{title}</h2>
          </div>
          <div className="fill" />
          <button ref={closeRef} className="ghost small" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

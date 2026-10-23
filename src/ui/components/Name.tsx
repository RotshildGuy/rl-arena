import type { ReactNode } from 'react';

/**
 * A name somebody typed: a team, a driver, a model, a league.
 *
 * It is drawn in its own direction, taken from its own first letter, and kept
 * apart from the text around it. Without that a Hebrew name in the English
 * page reads backwards ("בודק UX" comes out as "UX בודק"), a digit at the end
 * of a Hebrew name jumps to its start ("מירוץ2" as "2מירוץ"), and a Latin
 * name in the Hebrew page drags the punctuation next to it across.
 */
export function Name({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="auto" className={className ? `name ${className}` : 'name'}>
      {children}
    </bdi>
  );
}

/**
 * Text that always reads left to right whatever the page around it does: a
 * lap count ("1/10"), a layer list ("24 → 64 → 9").
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className ? `ltr ${className}` : 'ltr'}>
      {children}
    </bdi>
  );
}

/**
 * The same isolation for a name that goes into a sentence built as a string
 * ("ahead of X"), where there is no element to put it in: wrapped in the
 * Unicode first-strong-isolate marks, which draw as nothing.
 */
export function isolated(name: string): string {
  return `\u2068${name}\u2069`;
}

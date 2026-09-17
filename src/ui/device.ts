import { useEffect, useState } from 'react';

/**
 * Touch capability, not screen size. A narrow desktop window is still a keyboard
 * device, and a large tablet is still a touch device — the two questions have
 * different answers and different consequences.
 */
export const isTouchDevice =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/**
 * Whether to assume a phone-class CPU. Used only to pick lighter training
 * defaults; it never blocks anything, so a false positive costs a smaller network.
 */
export const isMobileClass =
  isTouchDevice && typeof window !== 'undefined' && Math.min(window.screen.width, window.screen.height) < 820;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsPortrait(): boolean {
  return useMediaQuery('(orientation: portrait)');
}

export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 900px)');
}

/**
 * Hold a screen wake lock while `active`.
 *
 * Training can run for many minutes with no touch input, and a phone that sleeps
 * throttles the worker to a stop. The lock is dropped by the browser whenever the
 * tab is hidden, so it has to be re-acquired on visibilitychange.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let sentinel: { release(): Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
      } catch {
        // Denied (low battery, unsupported) — training still runs, the screen
        // just may sleep. Nothing useful to tell the user here.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}

/** Request fullscreen and, where supported (Android Chrome), lock to landscape. */
export async function goFullscreenLandscape(el: HTMLElement): Promise<void> {
  try {
    if (!document.fullscreenElement) await el.requestFullscreen();
    const orientation = screen.orientation as ScreenOrientation & {
      lock?(o: 'landscape'): Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // iOS Safari supports neither reliably; the rotate prompt is the fallback.
  }
}

/**
 * Put the soft keyboard away before a drag starts.
 *
 * Dragging a slider does not move focus on a phone: a number field the user
 * typed into a moment ago keeps it, the keyboard stays up, and the browser keeps
 * scrolling that field back into view on every touch — so each nudge of a reward
 * slider threw the page back to "number of laps". Nothing here fires on a
 * desktop worth noticing: the field was going to lose focus on the next click
 * anyway.
 */
export function dismissKeyboard(): void {
  const el = document.activeElement;
  const typing =
    (el instanceof HTMLInputElement && el.type !== 'range' && el.type !== 'checkbox') ||
    el instanceof HTMLTextAreaElement;
  if (typing) (el as HTMLElement).blur();
}

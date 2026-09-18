import { useEffect, useState, useSyncExternalStore } from 'react';
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

/**
 * The bubble itself: floats off whatever it is rendered inside, which needs
 * the `coach-anchor` class, with its arrow pointing back at it. `aria-live`,
 * so a screen reader is told what changed instead of losing the thread.
 */
export function Coach({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`coach ${className}`.trim()} role="status" aria-live="polite">
      {text}
    </div>
  );
}

/** Wraps the control a bubble is pointing at, and lights it up. */
export function CoachAnchor({
  on,
  className = '',
  children,
}: {
  on: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`coach-anchor ${on ? 'lit' : ''} ${className}`.trim()}>{children}</span>;
}

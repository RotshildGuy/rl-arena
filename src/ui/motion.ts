import { useSyncExternalStore } from 'react';

/**
 * Animations on or off.
 *
 * By default the app follows the device: somebody who asked their phone or
 * computer for less motion (an accessibility setting) gets still pictures.
 * The settings panel can override that either way, on this browser only.
 *
 * Applied as `data-motion` on <html>: "off" stops every CSS animation and
 * transition, "on" overrides the device's request for the few the stylesheet
 * would otherwise switch off. Canvas animations (the podium celebrations) ask
 * `motionOn()` instead.
 */
export type MotionPref = 'system' | 'on' | 'off';

const KEY = 'rl-arena-motion';
const listeners = new Set<() => void>();
const media =
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function readPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: MotionPref = readPref();

export function resolveMotion(p: MotionPref, deviceReduce: boolean): boolean {
  return p === 'system' ? !deviceReduce : p === 'on';
}

/** Whether to animate right now. */
export function motionOn(): boolean {
  return resolveMotion(pref, media?.matches ?? false);
}

function apply(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = motionOn() ? 'on' : 'off';
  listeners.forEach((fn) => fn());
}

export function getMotionPref(): MotionPref {
  return pref;
}

export function setMotionPref(next: MotionPref): void {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
  apply();
}

export function subscribeMotion(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at startup: applies the choice and follows the device from then on. */
export function initMotion(): void {
  apply();
  media?.addEventListener('change', () => {
    if (pref === 'system') apply();
  });
}

export function useMotionPref(): MotionPref {
  return useSyncExternalStore(subscribeMotion, getMotionPref);
}

export function useMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionOn);
}

import { useEffect, useRef, useState } from 'react';
import { RaceAudio } from './raceAudio';

/** Whether the sound is on, kept per browser. Off by default: a page should not start making noise. */
const SOUND_KEY = 'rl-arena-sound';

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * The race sound (`raceAudio.ts`) for a screen that shows a race: on and off
 * with one button, the same choice on every screen, torn down with the screen.
 */
export function useRaceSound() {
  const audioRef = useRef<RaceAudio | null>(null);
  const [soundOn, setSoundOn] = useState(readSound);
  useEffect(() => {
    if (!soundOn) return;
    const audio = new RaceAudio();
    audio.enable();
    audioRef.current = audio;
    return () => {
      audio.disable();
      audioRef.current = null;
    };
  }, [soundOn]);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      // Private mode: for this visit only.
    }
  };
  return { audioRef, soundOn, toggleSound };
}

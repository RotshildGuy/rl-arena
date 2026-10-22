import { Modal } from './Modal';
import { useT } from '../../i18n';

const KEY = 'rl-arena.seen.welcome';

/**
 * What a model is and what happens to it, shown once per device the first time
 * the championship screen opens. It used to sit under the headline on every
 * visit, which was a paragraph too long for a screen people come back to daily.
 */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode: show it every visit rather than never.
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do; it will simply appear again next time.
  }
}

export function Welcome({ onClose }: { onClose(): void }) {
  const t = useT();
  const w = t.welcome;
  return (
    <Modal
      eyebrow={w.eyebrow}
      title={w.title}
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          {w.ok}
        </button>
      }
    >
      <p>{t.championship.intro}</p>
    </Modal>
  );
}

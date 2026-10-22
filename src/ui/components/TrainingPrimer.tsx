import { Modal } from './Modal';
import { useT } from '../../i18n';

const KEY = 'rl-arena.seen.primer';

/**
 * Shown once per device, the first time someone opens the garage.
 *
 * It exists because the single most common way to be disappointed by this app is
 * to assume the model is trying to drive well. It is not. It is trying to
 * collect the number you defined, and those two things come apart the moment the
 * reward table has a cheaper answer in it than driving fast. Somebody who knows
 * that in advance reads a weird-looking model as a bug in their own reward
 * design; somebody who does not reads it as a broken game.
 */
export function hasSeenPrimer(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode: show it every visit rather than never.
    return false;
  }
}

export function markPrimerSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do; it will simply appear again next time.
  }
}

/**
 * `onStart`, when given, makes the button do what it says - open a new
 * training run. Without it the button only closes, and says only that.
 */
export function TrainingPrimer({ onClose, onStart }: { onClose(): void; onStart?(): void }) {
  const p = useT().primer;
  return (
    <Modal
      eyebrow={p.eyebrow}
      title={p.title}
      onClose={onClose}
      footer={
        <button
          className="primary"
          onClick={() => {
            onClose();
            onStart?.();
          }}
        >
          {onStart ? p.startTraining : p.ok}
        </button>
      }
    >
      <p>{p.body1}</p>
      <p>{p.body2}</p>
    </Modal>
  );
}

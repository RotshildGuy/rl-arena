import { Modal } from './Modal';

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

export function TrainingPrimer({ onClose }: { onClose(): void }) {
  return (
    <Modal
      eyebrow="לפני שמתחילים"
      title="המודל לא מנסה לנהוג טוב"
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          הבנתי, בואו נאמן
        </button>
      }
    >
      <p>
        המודל רק מנסה <b>לצבור כמה שיותר נקודות לפי המחוונים שקבעתם.</b> אם יש דרך קלה יותר
        לצבור אותן מאשר לנהוג מהר — הוא ימצא אותה.
      </p>
      <p>
        באליפות נמדד רק <b>זמן</b>, אז כוונו את המחוונים כך שנהיגה מהירה תשתלם. אפשר לשנות אותם
        גם באמצע האימון.
      </p>
    </Modal>
  );
}

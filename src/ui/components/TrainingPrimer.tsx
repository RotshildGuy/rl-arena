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
        המודל לא יודע מה זה "לנהוג טוב", ואף אחד לא מלמד אותו לנהוג. הוא יודע דבר אחד:{' '}
        <b>לצבור כמה שיותר נקודות לפי המחוונים שאתם קבעתם.</b> זה כל העולם שלו.
      </p>

      <div className="primer-point">
        <span className="n">1</span>
        <div>
          <b>ניקוד גבוה הוא לא בהכרח מהיר.</b> אתם מתגמלים על נקודות ביקורת, על מהירות, על
          הקפות — והמודל מחפש את הדרך הזולה ביותר לצבור אותן. לפעמים הדרך הזאת היא בדיוק
          לנהוג מהר. לפעמים ממש לא.
        </div>
      </div>

      <div className="primer-point">
        <span className="n">2</span>
        <div>
          <b>הוא ימצא את הפרצה, לא את הכוונה.</b> אם העונש על פגיעה בקיר נמוך מדי, המודל יגלה
          שהכי משתלם להישען על הגדר ולדחוף לאורך כל המסלול — זה יציב, זה עובר שערים, וזה איטי
          להחריד. אם העונש על עמידה במקום קטן מדי, הוא עלול פשוט לעצור: בשבילו זה עדיף על
          הסיכון להתרסק.
        </div>
      </div>

      <div className="primer-point">
        <span className="n">3</span>
        <div>
          <b>כשהמודל מתנהג מוזר — הוא לא טועה.</b> הוא עשה בדיוק את מה שביקשתם. מצאתם באג
          במחוונים שלכם, לא במודל.
        </div>
      </div>

      <p className="primer-kicker">
        וזה מה שהופך את זה למשחק: <b>באליפות נמדד דבר אחד בלבד — זמן.</b> המחוונים הם
        רק האמצעי שלכם לגרום למודל להגיע לשם, והיא ההחלטה המשמעותית ביותר שתקבלו כאן.
      </p>

      <p className="muted small">
        אפשר להזיז את המחוונים גם באמצע האימון ולראות בזמן אמת איך ההתנהגות משתנה. שווה לנסות.
      </p>
    </Modal>
  );
}

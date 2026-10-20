import { useState } from 'react';
import { useApp } from '../store';
import { disablePush, enablePush, isIos, pushState, type PushState } from '../push';
import { Modal } from './Modal';

/**
 * "Remind me before the race", next to the calendar button. Hidden where push
 * cannot work at all; on an iPhone that has not installed the site it explains
 * how, because that is the only way an iPhone delivers one.
 */
export function PushToggle() {
  const showToast = useApp((s) => s.showToast);
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);
  const [howTo, setHowTo] = useState(false);

  if (state === 'unsupported') return null;

  const toggle = async () => {
    if (state === 'needs-install') {
      setHowTo(true);
      return;
    }
    setBusy(true);
    try {
      const next = state === 'on' ? await disablePush() : await enablePush();
      setState(next);
      if (next === 'on') showToast('תקבלו תזכורת ב-19:45, ואת התוצאה של הרכב שלכם אחרי המרוץ');
      if (next === 'blocked') showToast('ההתראות חסומות בדפדפן. אפשר להפעיל אותן בהגדרות האתר.');
    } catch {
      showToast('לא הצלחתי להפעיל התראות במכשיר הזה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => void toggle()} disabled={busy || state === 'blocked'} title="התראה לפני המרוץ ואחריו">
        {state === 'on' ? '🔔 התראות פועלות' : state === 'blocked' ? '🔕 חסום בדפדפן' : '🔔 התראה לפני המרוץ'}
      </button>
      {howTo && (
        <Modal title="התראות באייפון" onClose={() => setHowTo(false)}>
          <p className="small" style={{ marginTop: 0 }}>
            אייפון שולח התראות רק לאתר שנוסף למסך הבית. זה לוקח עשר שניות:
          </p>
          <ol className="small">
            <li>
              לוחצים על כפתור השיתוף של Safari {isIos() ? '(הריבוע עם החץ למעלה)' : ''}.
            </li>
            <li>בוחרים "הוספה למסך הבית".</li>
            <li>פותחים את RL Arena מהאייקון החדש, ולוחצים כאן שוב.</li>
          </ol>
          <button className="primary" onClick={() => setHowTo(false)}>
            הבנתי
          </button>
        </Modal>
      )}
    </>
  );
}

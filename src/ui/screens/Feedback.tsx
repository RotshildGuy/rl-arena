import { useEffect, useState, useSyncExternalStore } from 'react';
import { LineSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { getAuthView, subscribeAuth } from '../auth';
import {
  CONTACT_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MAX,
  KIND_LABEL,
  STATUS_LABEL,
  feedbackProblem,
  type Feedback as Item,
  type FeedbackKind,
  type FeedbackStatus,
} from '../../core/feedback';
import { allFeedback, feedbackOnline, markFeedback, myFeedback, sendFeedback } from '../../storage/feedback';
import { CONTACT_EMAIL } from '../contact';
import { dateTimeText } from '../format';

/**
 * "Something is broken" and "this would be better if", from inside the app.
 *
 * The report carries the screen it was sent from, because that is most of what
 * a bug report needs, and nothing else unless the sender adds it: device
 * details only with the box ticked, a way back to them only if they write one.
 * Their own messages are listed underneath, with the status and any reply, so
 * a report does not disappear into a void.
 */
export function Feedback() {
  const { go, feedbackFrom, showToast } = useApp();
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [withDevice, setWithDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Item[] | null>(null);
  const [all, setAll] = useState<Item[] | null>(null);
  const online = feedbackOnline();

  const reload = () => {
    void myFeedback().then(setMine).catch(() => setMine([]));
    // Operators only: for everybody else this is refused and the section stays hidden.
    void allFeedback().then(setAll).catch(() => setAll(null));
  };
  useEffect(() => {
    if (auth.phase === 'out') return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.phase]);

  const submit = async () => {
    const problem = feedbackProblem(text, contact);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({
        kind,
        text,
        screen: feedbackFrom,
        contact,
        device: withDevice ? navigator.userAgent.slice(0, 300) : undefined,
      });
      setText('');
      setContact('');
      showToast(online ? 'הפנייה נשלחה. תודה!' : 'הפנייה נשמרה בדפדפן הזה');
      reload();
    } catch {
      setError('השליחה נכשלה. נסו שוב, או כתבו במייל.');
    } finally {
      setBusy(false);
    }
  };

  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`RL Arena - ${KIND_LABEL[kind]}`)}&body=${encodeURIComponent(text)}`;

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">פניות</div>
          <h1 className="display">באג או רעיון?</h1>
          <div className="muted small">כל פנייה נקראת. אפשר לכתוב בחופשיות - גם "זה מבלבל" זה מידע שימושי.</div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => go(feedbackFrom === 'feedback' ? 'championship' : feedbackFrom)}>
            חזרה
          </button>
        </div>
      </div>

      <div className="split-main">
        <div className="card notched">
          <div className="segmented" style={{ width: '100%', marginBottom: 12 }}>
            {FEEDBACK_KINDS.map((k) => (
              <button key={k} style={{ flex: 1 }} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="small muted" htmlFor="fb-text">
            {kind === 'bug'
              ? 'מה קרה, ומה ציפיתם שיקרה? אם אפשר - מה עשיתם רגע לפני.'
              : kind === 'idea'
                ? 'מה הייתם רוצים שיהיה, ולמה?'
                : 'מה תרצו לספר?'}
          </label>
          <textarea
            id="fb-text"
            value={text}
            maxLength={FEEDBACK_MAX}
            rows={7}
            onChange={(e) => setText(e.target.value)}
            style={{ width: '100%', marginTop: 6, resize: 'vertical' }}
          />
          <div className="dim tiny" style={{ textAlign: 'end' }}>
            {text.trim().length}/{FEEDBACK_MAX}
          </div>

          <label className="small muted" htmlFor="fb-contact">
            איך לחזור אליכם (לא חובה)
          </label>
          <input
            id="fb-contact"
            type="text"
            value={contact}
            maxLength={CONTACT_MAX}
            placeholder="מייל, או השאירו ריק"
            onChange={(e) => setContact(e.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />

          <label className="row small" style={{ marginTop: 10, gap: 8 }}>
            <input type="checkbox" checked={withDevice} onChange={(e) => setWithDevice(e.target.checked)} />
            לצרף את סוג הדפדפן והמכשיר (עוזר מאוד לתקן באגים)
          </label>
          <div className="dim tiny" style={{ marginTop: 4 }}>
            נשלח גם שם המסך שממנו פתחתם את הטופס. שום דבר אחר לא מצורף.
          </div>

          {error && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 10 }}>
              {error}
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 14 }}>
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'שולח…' : 'שליחה'}
            </button>
            <a className="small" href={mailto}>
              או במייל
            </a>
          </div>
          {!online && (
            <div className="small muted" style={{ marginTop: 8 }}>
              האתר רץ בלי ענן, אז הפנייה תישמר רק בדפדפן הזה. כדי שתגיע אלינו, שלחו אותה במייל.
            </div>
          )}
        </div>

        <div className="grid">
          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              הפניות שלי
            </div>
            {mine === null && <LineSkeleton />}
            {mine?.length === 0 && <div className="muted small">עוד לא שלחתם פניות.</div>}
            {mine?.map((f) => <FeedbackRow key={f.id} item={f} />)}
          </div>

          {all && <AdminList items={all} onChanged={reload} />}
        </div>
      </div>
    </>
  );
}

function FeedbackRow({ item, admin }: { item: Item; admin?: boolean }) {
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className={`pill small ${item.kind === 'bug' ? 'warn' : ''}`}>{KIND_LABEL[item.kind]}</span>
        <span className={`pill small ${item.status === 'done' ? 'good' : ''}`}>{STATUS_LABEL[item.status]}</span>
        <div style={{ flex: 1 }} />
        <span className="dim tiny">{dateTimeText(item.createdAt)}</span>
      </div>
      <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4, overflowWrap: 'anywhere' }}>
        {item.text}
      </div>
      {admin && (
        <div className="dim tiny" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
          מסך: {item.screen}
          {item.contact && ` · קשר: ${item.contact}`}
          {item.device && ` · ${item.device}`}
          {` · ${item.uid}`}
        </div>
      )}
      {item.reply && (
        <div className="small" style={{ marginTop: 4, color: 'var(--accent-2)' }}>
          תשובה: {item.reply}
        </div>
      )}
    </div>
  );
}

/** For operators: everything that came in, with a status and an optional answer. */
function AdminList({ items, onChanged }: { items: Item[]; onChanged(): void }) {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('new');
  const shown = items.filter((f) => filter === 'all' || f.status === filter);
  return (
    <div className="card notched">
      <div className="head">
        <div className="eyebrow">כל הפניות (מפעילים)</div>
        <div className="fill" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as FeedbackStatus | 'all')} style={{ width: 'auto' }}>
          <option value="new">חדשות</option>
          <option value="seen">נקראו</option>
          <option value="done">טופלו</option>
          <option value="all">הכל</option>
        </select>
      </div>
      {shown.length === 0 && <div className="muted small">אין פניות בסינון הזה.</div>}
      {shown.map((f) => (
        <div key={f.id}>
          <FeedbackRow item={f} admin />
          <AdminActions item={f} onChanged={onChanged} />
        </div>
      ))}
    </div>
  );
}

function AdminActions({ item, onChanged }: { item: Item; onChanged(): void }) {
  const [reply, setReply] = useState(item.reply ?? '');
  const set = (status: FeedbackStatus) =>
    void markFeedback(item.id, status, reply.trim() || undefined)
      .then(onChanged)
      .catch(() => {});
  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
      <input
        type="text"
        value={reply}
        placeholder="תשובה לשולח (לא חובה)"
        onChange={(e) => setReply(e.target.value)}
        style={{ flex: '1 1 200px' }}
      />
      <button className="small" onClick={() => set('seen')}>
        נקראה
      </button>
      <button className="small" onClick={() => set('done')}>
        טופלה
      </button>
    </div>
  );
}

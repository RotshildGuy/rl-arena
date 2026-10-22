import { useEffect, useState, useSyncExternalStore } from 'react';
import { LineSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { getAuthView, subscribeAuth } from '../auth';
import {
  CONTACT_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MAX,
  feedbackProblem,
  type Feedback as Item,
  type FeedbackKind,
  type FeedbackStatus,
} from '../../core/feedback';
import { allFeedback, feedbackOnline, markFeedback, myFeedback, sendFeedback } from '../../storage/feedback';
import { dateTimeText } from '../format';
import { useT } from '../../i18n';

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
  const t = useT();
  const fb = t.feedback;
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
      showToast(online ? fb.sent : fb.savedLocal);
      reload();
    } catch {
      setError(fb.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{fb.eyebrow}</div>
          <h1 className="display">{fb.title}</h1>
          <div className="muted small">{fb.intro}</div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => go(feedbackFrom === 'feedback' ? 'championship' : feedbackFrom)}>
            {fb.back}
          </button>
        </div>
      </div>

      <div className="split-main">
        <div className="card notched">
          <div className="segmented" style={{ width: '100%', marginBottom: 12 }}>
            {FEEDBACK_KINDS.map((k) => (
              <button key={k} style={{ flex: 1 }} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {t.feedbackCore.kind[k]}
              </button>
            ))}
          </div>
          <label className="small muted" htmlFor="fb-text">
            {kind === 'bug'
              ? fb.askBug
              : kind === 'idea'
                ? fb.askIdea
                : fb.askOther}
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
            {fb.contact}
          </label>
          <input
            id="fb-contact"
            type="text"
            value={contact}
            maxLength={CONTACT_MAX}
            placeholder={fb.contactPlaceholder}
            onChange={(e) => setContact(e.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />

          <label className="row small" style={{ marginTop: 10, gap: 8 }}>
            <input type="checkbox" checked={withDevice} onChange={(e) => setWithDevice(e.target.checked)} />
            {fb.withDevice}
          </label>
          <div className="dim tiny" style={{ marginTop: 4 }}>
            {fb.screenToo}
          </div>

          {error && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 10 }}>
              {error}
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 14 }}>
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? fb.sending : fb.send}
            </button>
          </div>
          {!online && (
            <div className="small muted" style={{ marginTop: 8 }}>
              {fb.noCloud}
            </div>
          )}
        </div>

        <div className="grid">
          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {fb.mine}
            </div>
            {mine === null && <LineSkeleton />}
            {mine?.length === 0 && <div className="muted small">{fb.none}</div>}
            {mine?.map((f) => <FeedbackRow key={f.id} item={f} />)}
          </div>

          {all && <AdminList items={all} onChanged={reload} />}
        </div>
      </div>
    </>
  );
}

function FeedbackRow({ item, admin }: { item: Item; admin?: boolean }) {
  const t = useT();
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className={`pill small ${item.kind === 'bug' ? 'warn' : ''}`}>{t.feedbackCore.kind[item.kind]}</span>
        <span className={`pill small ${item.status === 'done' ? 'good' : ''}`}>{t.feedbackCore.status[item.status]}</span>
        <div style={{ flex: 1 }} />
        <span className="dim tiny">{dateTimeText(item.createdAt)}</span>
      </div>
      <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4, overflowWrap: 'anywhere' }}>
        {item.text}
      </div>
      {admin && (
        <div className="dim tiny" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
          {t.feedback.screen(item.screen)}
          {item.contact && t.feedback.contactIs(item.contact)}
          {item.device && ` · ${item.device}`}
          {` · ${item.uid}`}
        </div>
      )}
      {item.reply && (
        <div className="small" style={{ marginTop: 4, color: 'var(--accent-2)' }}>
          {t.feedback.reply} {item.reply}
        </div>
      )}
    </div>
  );
}

/**
 * For operators: everything that came in, with an optional answer and a
 * "handled" mark. There is no "read" step - a message is open until it is
 * handled. Older messages marked "seen" count as open.
 */
type Filter = 'open' | 'done' | 'all';

function AdminList({ items, onChanged }: { items: Item[]; onChanged(): void }) {
  const fb = useT().feedback;
  const [filter, setFilter] = useState<Filter>('open');
  const shown = items.filter((f) => filter === 'all' || (filter === 'done') === (f.status === 'done'));
  return (
    <div className="card notched">
      <div className="head">
        <div className="eyebrow">{fb.all}</div>
        <div className="fill" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ width: 'auto' }}>
          <option value="open">{fb.open}</option>
          <option value="done">{fb.done}</option>
          <option value="all">{fb.everything}</option>
        </select>
      </div>
      {shown.length === 0 && <div className="muted small">{fb.emptyFilter}</div>}
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
  const fb = useT().feedback;
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
        placeholder={fb.replyPlaceholder}
        onChange={(e) => setReply(e.target.value)}
        style={{ flex: '1 1 200px' }}
      />
      {reply.trim() !== (item.reply ?? '') && (
        <button className="small" onClick={() => set(item.status)}>
          {fb.saveReply}
        </button>
      )}
      {item.status !== 'done' && (
        <button className="small" onClick={() => set('done')}>
          {fb.markDone}
        </button>
      )}
    </div>
  );
}

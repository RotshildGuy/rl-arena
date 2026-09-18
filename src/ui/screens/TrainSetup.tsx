import { useEffect, useRef, useState } from 'react';
import { getGame } from '../../core/games/registry';
import { MAX_TRAIN_SLOTS, useApp, type TrainSlot } from '../store';
import { GameOptions } from '../components/GameOptions';
import { RewardEditor } from '../components/RewardEditor';
import { ALGORITHMS, type AlgorithmId } from '../../core/rl/algorithms';
import { estimateTraining, formatEstimate, type TimeEstimate } from '../estimate';
import { isMobileClass } from '../device';
import { getStore, type ModelMeta } from '../../storage';
import { randomModelName } from '../../core/champ/nameGen';
import { Coach, CoachAnchor, useCoachStep } from '../coach';

export function TrainSetup() {
  const { gameId, draft, patchDraft, patchSlot, addSlot, removeSlot, slotFromModel, newDraft, go, setCompetitor } =
    useApp();
  const game = getGame(gameId);
  const coach = useCoachStep();
  const [saved, setSaved] = useState<ModelMeta[]>([]);
  const [tab, setTab] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => setSaved(await (await getStore()).list(gameId)))();
  }, [gameId]);

  /**
   * One suggested name per slot, drawn once and then kept. Redrawing on every
   * render would change the name under the cursor while someone is reading it,
   * and `start` would commit something other than what the field showed. The
   * names already drawn are passed along so no two cars on the grid share one.
   */
  const suggestions = useRef<string[]>([]);
  const suggestFor = (i: number): string => {
    if (!suggestions.current[i]) {
      suggestions.current[i] = randomModelName(Math.random, suggestions.current.filter(Boolean));
    }
    return suggestions.current[i];
  };

  const slots = draft.slots;
  const multi = slots.length > 1;
  const continuing = slots.some((s) => s.modelId !== null && !s.restart);
  const slotIndex = Math.min(tab, slots.length - 1);
  const slot = slots[slotIndex];

  /**
   * A new model joins at the end of the list, and the screen follows it there:
   * its card is brought into view and the sliders panel switches to it, so the
   * thing just created is the thing in front of you.
   */
  const addModel = () => {
    addSlot();
    setTab(slots.length);
    setTimeout(() => listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const start = () => {
    slots.forEach((s, i) => {
      if (!s.name.trim()) patchSlot(i, { name: suggestFor(i) });
    });
    go('training');
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">המוסך</div>
          <h1 className="display">{continuing ? 'המשך אימון' : multi ? 'אימון משותף' : 'מודל חדש'}</h1>
        </div>
        <div className="actions">
          {slots.some((s) => s.modelId) && (
            <button className="ghost" onClick={newDraft}>
              התחל מחדש
            </button>
          )}
        </div>
      </div>

      <div className="split-setup">
        <div className="grid">
          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 10 }}>מי מתאמן</div>

            {multi && (
              <p className="muted small" style={{ margin: '0 0 10px' }}>
                כל המודלים מתאמנים יחד על אותו מסלול ומפריעים זה לזה בדיוק כמו במרוץ אמיתי. לכל אחד
                רשת משלו, מחוונים משלו ושמירה נפרדת.
              </p>
            )}

            <div ref={listRef}>
              {slots.map((s, i) => (
                <SlotCard
                  key={i}
                  index={i}
                  slot={s}
                  saved={saved}
                  removable={slots.length > 1}
                  placeholder={suggestFor(i)}
                  onPatch={(p) => patchSlot(i, p)}
                  onPick={(m) => slotFromModel(i, m)}
                  onRemove={() => {
                    suggestions.current.splice(i, 1);
                    removeSlot(i);
                    setTab(0);
                  }}
                />
              ))}
            </div>

            {/* Under the list, not above it: a new slot is appended, so the
                button sits exactly where the card it creates will appear — the
                finger is already there and nothing scrolls out from under it. */}
            {slots.length < MAX_TRAIN_SLOTS && (
              <button
                className="small"
                style={{ marginTop: 10, width: '100%' }}
                onClick={addModel}
                title="עוד מודל על אותו מסלול, באותו הזמן"
              >
                + הוסף מודל
              </button>
            )}
          </div>

          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 12 }}>המסלול והקבוצה</div>

            {/* One name, remembered: it fills the next model too, and it is what
                the championship entry races under. */}
            <div className="field">
              <label>שם המתחרה — הקבוצה שכל המודלים כאן מתחרים בשמה</label>
              <input
                type="text"
                value={draft.owner}
                placeholder="השם שלך"
                onChange={(e) => setCompetitor(e.target.value)}
              />
              {!draft.owner.trim() && (
                <div className="small muted">בלי שם מתחרה אי אפשר לרשום את המודל לאליפות.</div>
              )}
            </div>

            <GameOptions
              options={game.options}
              value={draft.config}
              minima={{ nCars: slots.length }}
              onChange={(config) => patchDraft({ config })}
            />
          </div>
        </div>

        <div className="grid">
          <div className="card notched">
            {multi && (
              <div className="segmented" style={{ width: '100%', marginBottom: 10 }}>
                {slots.map((s, i) => (
                  <button
                    key={i}
                    style={{ flex: 1 }}
                    className={i === slotIndex ? 'on' : ''}
                    onClick={() => setTab(i)}
                  >
                    {s.name.trim() || `מודל ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
            <RewardEditor
              spec={game.spec}
              value={slot.rewards}
              onChange={(rewards) => patchSlot(slotIndex, { rewards })}
            />
          </div>
          <Estimate />
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="ghost" onClick={() => go('library')}>
          ביטול
        </button>
        <CoachAnchor on={coach === 'setup'}>
          <button className="primary" onClick={start}>
            {continuing ? 'המשך אימון' : 'התחל אימון'}
          </button>
          {coach === 'setup' && (
            <Coach
              className="to-start"
              text="אפשר להשאיר הכל כמו שהוא לאימון ראשון. לחצו התחל אימון והרכב יתחיל לנסוע ולהשתפר מול העיניים שלכם."
            />
          )}
        </CoachAnchor>
      </div>
    </>
  );
}

function SlotCard({
  index,
  slot,
  saved,
  removable,
  placeholder,
  onPatch,
  onPick,
  onRemove,
}: {
  index: number;
  slot: TrainSlot;
  saved: ModelMeta[];
  removable: boolean;
  placeholder: string;
  onPatch: (p: Partial<TrainSlot>) => void;
  onPick: (m: ModelMeta | null) => void;
  onRemove: () => void;
}) {
  // Algorithm and network shape are baked into saved weights, so a model that is
  // being continued cannot switch either without throwing the training away.
  const locked = slot.modelId !== null && !slot.restart;

  return (
    <div className="slot-card">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="pill small">רכב {index + 1}</span>
        <div style={{ flex: 1 }} />
        {slot.modelId && (
          <span className={`pill small ${slot.restart ? 'warn' : 'good'}`}>
            {slot.restart ? 'המשקולות יימחקו' : 'ממשיך מודל קיים'}
          </span>
        )}
        {removable && (
          <button className="ghost small" onClick={onRemove} title="הסר מהמגרש">
            הסר
          </button>
        )}
      </div>

      <div className="cols-2">
        <div className="field">
          <label>שם המודל — כך הוא יופיע כנהג בטבלה</label>
          <input
            type="text"
            value={slot.name}
            placeholder={placeholder}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </div>

        <div className="field">
          <label>מאיפה מתחילים</label>
          <select
            value={slot.modelId ?? ''}
            onChange={(e) => onPick(saved.find((m) => m.id === e.target.value) ?? null)}
          >
            <option value="">מודל חדש מאפס</option>
            {saved.map((m) => (
              <option key={m.id} value={m.id}>
                המשך את {m.name}
              </option>
            ))}
          </select>
          {slot.modelId && (
            <label className="row small" style={{ gap: 6, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={slot.restart}
                onChange={(e) => onPatch({ restart: e.target.checked })}
              />
              התחל את המשקולות שלו מאפס
            </label>
          )}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>איך הוא לומד {locked ? '(נעול — נקבע בעת יצירת המודל)' : ''}</label>
        <div className="segmented" style={{ width: '100%' }}>
          {(Object.keys(ALGORITHMS) as AlgorithmId[]).map((id) => (
            <button
              key={id}
              style={{ flex: 1 }}
              disabled={locked}
              className={slot.algorithm === id ? 'on' : ''}
              onClick={() => onPatch({ algorithm: id })}
            >
              {ALGORITHMS[id].name}
            </button>
          ))}
        </div>
        <div className="small muted">{ALGORITHMS[slot.algorithm].blurb}</div>
      </div>
    </div>
  );
}

/**
 * Measures this device by briefly running the configured algorithm, rather than
 * guessing from the user agent. A phone can be 3-5x slower than a laptop and the
 * gap is not predictable, so the only honest estimate is a measured one.
 */
function Estimate() {
  const { gameId, draft } = useApp();
  const [result, setResult] = useState<TimeEstimate | null>(null);
  const [measuring, setMeasuring] = useState(true);

  const slots = draft.slots.length;
  const key = JSON.stringify([gameId, draft.slots.map((s) => s.algorithm), draft.config]);

  useEffect(() => {
    setMeasuring(true);
    // Debounced and deferred: the probe blocks the main thread for ~250ms, which
    // would make typing in the fields above stutter.
    const timer = setTimeout(() => {
      try {
        // The slowest model sets the pace, and models on one grid share one CPU:
        // two of them take roughly twice as long to get anywhere as one alone.
        const each = draft.slots.map((s) =>
          estimateTraining(gameId, s.algorithm, draft.config, draft.hyper, draft.gaHyper),
        );
        const worst = each.reduce((a, b) => (b.seconds > a.seconds ? b : a));
        setResult({ ...worst, seconds: worst.seconds * slots });
      } catch {
        setResult(null);
      }
      setMeasuring(false);
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="card notched">
      <div className="eyebrow" style={{ marginBottom: 8 }}>כמה זמן זה ייקח</div>
      {measuring && <div className="muted small">מודד את המכשיר…</div>}
      {!measuring && result && (
        <>
          <div className="stat">
            <div className="v" style={{ fontSize: 26, color: 'var(--accent-2)' }}>{formatEstimate(result.seconds)}</div>
            <div className="k">
              {slots > 1 ? `עד ש-${slots} המודלים נוסעים טוב, במצב טורבו` : 'עד שהמודל נוסע טוב, במצב טורבו'}
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            נמדד על המכשיר הזה: {Math.round(result.rate).toLocaleString('he-IL')} {result.rateLabel}.
            ההערכה מבוססת על ריצות ייחוס ולכן היא בקירוב בלבד.
          </div>
        </>
      )}
      {!measuring && !result && <div className="muted small">לא הצלחתי למדוד את המכשיר.</div>}
      {isMobileClass && (
        <div className="pill warn small" style={{ marginTop: 10 }}>
          זוהה מכשיר נייד — נבחרו ברירות מחדל קלות יותר
        </div>
      )}
    </div>
  );
}

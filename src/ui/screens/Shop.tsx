import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { useChampionship } from '../useChampionship';
import { earnedCoins } from '../../core/champ/coins';
import {
  ITEM_BY_ID,
  SHOP_ITEMS,
  paintOf,
  spent,
  type Equipped,
  type ItemKind,
  type ShopDoc,
  type ShopItem,
} from '../../core/champ/shop';
import { settledResults } from '../../core/champ/timing';
import { teamColor, teamLook } from '../../core/champ/livery';
import { drawCarPreview, type CarLook } from '../../core/games/racing/render';
import { myShop, saveShop } from '../../storage/shop';

type SlotKind = Exclude<ItemKind, 'number'>;

const SECTIONS: Array<{ kind: SlotKind; title: string; hint?: string }> = [
  { kind: 'color', title: 'צבע הרכב', hint: 'בלי סגול, ירוק וצהוב - הם שמורים לזמני הקפה.' },
  { kind: 'pattern', title: 'עיצוב' },
  { kind: 'secondary', title: 'צבע שני', hint: 'הפס, החצי האחורי בשני גוונים, והכנפיים.' },
  { kind: 'helmet', title: 'קסדה' },
  { kind: 'smoke', title: 'עשן בדריפט' },
];

/**
 * The shop: coins earned from races, spent on paint. Nothing here changes how
 * a car drives.
 *
 * Everything is shown, not named: colours are swatches, patterns are little
 * cars. Tapping something not yet owned puts it on the preview car first -
 * try as many as you like, then buy what is on the car in one go. What is
 * bought is drawn on track for everybody, and each browser checks it against
 * the coins the team has earned before painting it.
 */
export function Shop() {
  const { competitor, showToast } = useApp();
  const { state, progress } = useChampionship();
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [trial, setTrial] = useState<Equipped>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = state?.uid ?? '';

  useEffect(() => {
    if (!uid) return;
    void myShop(uid).then(setDoc);
  }, [uid]);

  const wallet = useMemo(() => {
    if (!state) return null;
    const now = Date.now();
    return earnedCoins(uid, state.cards, settledResults(state.cards, state.results, now), now);
  }, [state, uid]);

  if (!state || !wallet || !doc) return <div className="empty">{progress ?? 'טוען את החנות…'}</div>;

  const balance = wallet.total - spent(doc.purchases);
  const owned = new Set(doc.purchases);
  const has = (id: string) => (ITEM_BY_ID.get(id)?.price ?? 0) === 0 || owned.has(id);
  const team = competitor || 'הקבוצה שלי';

  // What the preview shows: what is on the car, with whatever is being tried on top.
  const wearing: Equipped = { ...doc.equipped, ...trial };
  const base = teamLook(team, '');
  const paint = paintOf(wearing);
  const previewColor = paint.color ?? teamColor(team);
  const previewLook: CarLook = { ...base, ...paint.look };

  // The items being tried that still have to be paid for.
  const toBuy = [
    ...(['color', 'secondary', 'pattern', 'helmet', 'smoke'] as const)
      .map((k) => trial[k])
      .filter((id): id is string => !!id && !has(id)),
    ...(trial.number !== undefined && !owned.has('number') ? ['number'] : []),
  ];
  const cost = toBuy.reduce((s, id) => s + (ITEM_BY_ID.get(id)?.price ?? 0), 0);

  const persist = async (next: ShopDoc, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveShop(uid, next);
      setDoc(next);
      setTrial({});
      showToast(done);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(
        code === 'permission-denied'
          ? 'השרת סירב לשמור: החנות עוד לא הופעלה ב-Firestore (חסר הכלל של shop). אחרי שהכלל יפורסם זה יעבוד.'
          : 'השמירה נכשלה. בדקו את החיבור ונסו שוב.',
      );
    } finally {
      setBusy(false);
    }
  };

  /** A tap: put an owned item straight on the car, try on one that is not. */
  const tap = (item: ShopItem, kind: SlotKind) => {
    if (has(item.id)) {
      const equipped = { ...doc.equipped, [kind]: item.id };
      const rest = { ...trial };
      delete rest[kind];
      setTrial(rest);
      void persist({ ...doc, equipped: { ...equipped, ...pickOwned(rest, has) } }, `${item.label} על הרכב`);
      return;
    }
    setTrial({ ...trial, [kind]: item.id });
  };

  const reset = (kind: SlotKind) => {
    const equipped = { ...doc.equipped };
    delete equipped[kind];
    void persist({ ...doc, equipped }, 'הוחזר לברירת המחדל');
  };

  const buyAll = () => {
    if (cost > balance) return;
    void persist(
      { ...doc, purchases: [...doc.purchases, ...toBuy], equipped: { ...doc.equipped, ...trial } },
      'נקנה ועל הרכב',
    );
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">החנות</div>
          <h1 className="display">מראה, לא מהירות.</h1>
          <div className="muted small">מטבעות קונים מראה. שום דבר כאן לא משנה איך הרכב נוהג.</div>
        </div>
        <div className="actions">
          <span className="pill" style={{ fontSize: 15 }}>
            🪙 <span className="mono" style={{ fontWeight: 800 }}>{balance}</span> מטבעות
          </span>
        </div>
      </div>

      <div className="shop-layout">
        {/* The car first, and pinned while scrolling: every tap below changes it. */}
        <div className="shop-preview card notched">
          <Preview color={previewColor} look={previewLook} />
          {toBuy.length > 0 ? (
            <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
              <span className="small">
                מנסים על הרכב: <b>{toBuy.map((id) => ITEM_BY_ID.get(id)?.label).join(' · ')}</b>
              </span>
              <div style={{ flex: 1 }} />
              <button className="ghost small" disabled={busy} onClick={() => setTrial({})}>
                ביטול
              </button>
              <button className="primary small" disabled={busy || cost > balance} onClick={buyAll}>
                {cost > balance ? `חסרים ${cost - balance} מטבעות` : `קנייה · 🪙${cost}`}
              </button>
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 8 }}>
              לחצו על משהו כדי לראות אותו על הרכב. קונים רק אם זה מוצא חן.
            </div>
          )}
          {error && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div className="grid">
          {SECTIONS.map((section) => (
            <div className="card notched" key={section.kind}>
              <div className="head">
                <div className="eyebrow">{section.title}</div>
                <div className="fill" />
                {doc.equipped[section.kind] !== undefined && (
                  <button className="ghost small" disabled={busy} onClick={() => reset(section.kind)}>
                    ברירת מחדל
                  </button>
                )}
              </div>
              {section.hint && (
                <div className="muted small" style={{ marginBottom: 10 }}>
                  {section.hint}
                </div>
              )}
              <div className="swatches">
                {SHOP_ITEMS.filter((i) => i.kind === section.kind).map((item) => (
                  <Swatch
                    key={item.id}
                    item={item}
                    owned={has(item.id)}
                    on={wearing[section.kind] === item.id}
                    trying={trial[section.kind] === item.id}
                    previewColor={previewColor}
                    previewLook={previewLook}
                    onTap={() => tap(item, section.kind)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              מספר
            </div>
            <NumberPicker
              owned={owned.has('number')}
              price={ITEM_BY_ID.get('number')!.price}
              value={wearing.number}
              busy={busy}
              onTry={(n) => setTrial({ ...trial, number: n })}
              onSave={(n) =>
                void persist({ ...doc, equipped: { ...doc.equipped, number: n } }, n ? `מספר ${n} על הרכב` : 'בלי מספר משלך')
              }
            />
          </div>

          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              איך הרווחתם
            </div>
            {wallet.breakdown.length === 0 && (
              <div className="muted small">
                עוד אין מטבעות. כל רכב שיוצא למרוץ מרוויח, גם במקום האחרון, ועוד לפי הנקודות שצבר.
              </div>
            )}
            {wallet.breakdown.map((e, i) => (
              <div className="row small" key={i} style={{ padding: '3px 0' }}>
                <span>{e.label}</span>
                <div style={{ flex: 1 }} />
                <span className="mono">+{e.coins}</span>
              </div>
            ))}
            {doc.purchases.length > 0 && (
              <div className="row small" style={{ padding: '3px 0', borderTop: '1px solid var(--line)', marginTop: 4 }}>
                <span className="muted">נקנה</span>
                <div style={{ flex: 1 }} />
                <span className="mono muted">-{spent(doc.purchases)}</span>
              </div>
            )}
            <div className="dim tiny" style={{ marginTop: 8 }}>
              המטבעות מחושבים מהתוצאות שפורסמו, אצל כל אחד בנפרד, ולכן אי אפשר לזייף אותם.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Of the items being tried, the ones already owned (they can go on the car with a tap). */
function pickOwned(trial: Equipped, has: (id: string) => boolean): Equipped {
  const out: Equipped = {};
  for (const k of ['color', 'secondary', 'pattern', 'helmet', 'smoke'] as const) {
    const id = trial[k];
    if (id && has(id)) out[k] = id;
  }
  return out;
}

/**
 * One item, shown rather than named: a colour as a swatch, a pattern as a
 * small car wearing it, drift smoke as a puff. The name is in the tooltip and
 * for screen readers; the price sits under it until it is bought.
 */
function Swatch({
  item,
  owned,
  on,
  trying,
  previewColor,
  previewLook,
  onTap,
}: {
  item: ShopItem;
  owned: boolean;
  on: boolean;
  trying: boolean;
  previewColor: string;
  previewLook: CarLook;
  onTap(): void;
}) {
  return (
    <button
      className={`swatch ${on ? 'on' : ''} ${trying ? 'trying' : ''}`}
      onClick={onTap}
      title={`${item.label}${owned ? '' : ` · ${item.price} מטבעות`}`}
      aria-label={item.label}
      aria-pressed={on}
    >
      {item.kind === 'pattern' ? (
        <MiniCar color={previewColor} look={{ ...previewLook, pattern: item.value as CarLook['pattern'], number: undefined }} />
      ) : item.kind === 'smoke' ? (
        <span className="swatch-dot smoke" style={{ background: `radial-gradient(circle, ${item.value.replace(/[\d.]+\)$/, '0.95)')}, transparent 70%)` }} />
      ) : (
        <span className="swatch-dot" style={{ background: item.value }} />
      )}
      <span className="swatch-price">{owned ? (on ? '✓' : '') : `🪙${item.price}`}</span>
    </button>
  );
}

function MiniCar({ color, look }: { color: string; look: CarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look, null);
  }, [color, look.pattern, look.secondary, look.helmet]);
  return <canvas ref={ref} className="swatch-car" />;
}

function Preview({ color, look }: { color: string; look: CarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look);
  }, [color, look]);
  return <canvas ref={ref} className="shop-canvas" />;
}

function NumberPicker({
  owned,
  price,
  value,
  busy,
  onTry,
  onSave,
}: {
  owned: boolean;
  price: number;
  value: number | undefined;
  busy: boolean;
  onTry(n: number | undefined): void;
  onSave(n: number | undefined): void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const n = Number(draft);
  const ok = Number.isInteger(n) && n >= 1 && n <= 99;
  return (
    <>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="number"
          min={1}
          max={99}
          value={draft}
          placeholder="1-99"
          onChange={(e) => {
            setDraft(e.target.value);
            const v = Number(e.target.value);
            // Typing a number shows it on the car straight away, bought or not.
            onTry(Number.isInteger(v) && v >= 1 && v <= 99 ? v : undefined);
          }}
          style={{ width: 100 }}
          aria-label="מספר הרכב"
        />
        {owned && (
          <button className="small" disabled={busy || !ok || n === value} onClick={() => onSave(n)}>
            שמירה
          </button>
        )}
        {owned && value !== undefined && (
          <button className="ghost small" disabled={busy} onClick={() => onSave(undefined)}>
            להסיר
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {owned ? 'המספר על כיסוי המנוע.' : `הקלידו מספר כדי לראות אותו על הרכב. מספר לבחירה עולה 🪙${price}.`}
      </div>
    </>
  );
}

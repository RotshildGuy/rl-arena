import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { useChampionship } from '../useChampionship';
import { earnedCoins } from '../../core/champ/coins';
import { ITEM_BY_ID, SHOP_ITEMS, spent, validLook, type Equipped, type ItemKind, type ShopDoc, type ShopItem } from '../../core/champ/shop';
import { settledResults } from '../../core/champ/timing';
import { teamColor, teamLook } from '../../core/champ/livery';
import { drawCarPreview } from '../../core/games/racing/render';
import { myShop, saveShop } from '../../storage/shop';

const SECTIONS: Array<{ kind: ItemKind; title: string; hint?: string }> = [
  { kind: 'color', title: 'צבע הרכב', hint: 'במקום הצבע שנגזר משם הקבוצה. בלי סגול, ירוק וצהוב - הם שמורים לזמני הקפה.' },
  { kind: 'pattern', title: 'עיצוב' },
  { kind: 'number', title: 'מספר', hint: 'מופיע על כיסוי המנוע.' },
  { kind: 'helmet', title: 'קסדה' },
  { kind: 'smoke', title: 'עשן בדריפט' },
];

/**
 * The shop: coins earned from races, spent on paint. Nothing here changes how
 * a car drives. What is bought is drawn on track for everybody - each browser
 * checks it against the coins the team has earned before painting it.
 */
export function Shop() {
  const { competitor, showToast } = useApp();
  const { state, progress } = useChampionship();
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [busy, setBusy] = useState(false);
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
  const team = competitor || 'הקבוצה שלי';
  const paint = validLook(doc, wallet.total);
  const previewColor = paint?.color ?? teamColor(team);
  const previewLook = { ...teamLook(team, ''), ...paint?.look };

  const persist = async (next: ShopDoc, done: string) => {
    setBusy(true);
    try {
      await saveShop(uid, next);
      setDoc(next);
      showToast(done);
    } catch {
      showToast('השמירה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const equipKey = (kind: ItemKind): keyof Equipped => kind as keyof Equipped;
  const buy = (item: ShopItem) => {
    if (item.price > balance) return;
    const equipped = { ...doc.equipped };
    if (item.kind !== 'number') (equipped as Record<string, unknown>)[equipKey(item.kind)] = item.id;
    void persist({ ...doc, purchases: [...doc.purchases, item.id], equipped }, `${item.label} - נקנה ועל הרכב`);
  };
  const equip = (item: ShopItem | null, kind: ItemKind) => {
    const equipped = { ...doc.equipped } as Record<string, unknown>;
    if (item) equipped[equipKey(kind)] = item.id;
    else delete equipped[equipKey(kind)];
    void persist({ ...doc, equipped: equipped as Equipped }, item ? `${item.label} על הרכב` : 'הוחזר לברירת המחדל');
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">החנות</div>
          <h1 className="display">מראה, לא מהירות.</h1>
          <div className="muted small">מטבעות קונים צבע, עיצוב ומספר. שום דבר כאן לא משנה איך הרכב נוהג.</div>
        </div>
        <div className="actions">
          <span className="pill" style={{ fontSize: 15 }}>
            🪙 <span className="mono" style={{ fontWeight: 800 }}>{balance}</span> מטבעות
          </span>
        </div>
      </div>

      <div className="split-main">
        <div className="grid">
          {SECTIONS.map((section) => (
            <div className="card notched" key={section.kind}>
              <div className="head">
                <div className="eyebrow">{section.title}</div>
                <div className="fill" />
                {section.kind !== 'number' && doc.equipped[equipKey(section.kind)] !== undefined && (
                  <button className="ghost small" disabled={busy} onClick={() => equip(null, section.kind)}>
                    ברירת מחדל
                  </button>
                )}
              </div>
              {section.hint && <div className="muted small" style={{ marginBottom: 8 }}>{section.hint}</div>}
              {section.kind === 'number' ? (
                <NumberPicker
                  owned={owned.has('number')}
                  price={ITEM_BY_ID.get('number')!.price}
                  balance={balance}
                  value={doc.equipped.number}
                  busy={busy}
                  onBuy={() => buy(ITEM_BY_ID.get('number')!)}
                  onSet={(n) =>
                    void persist({ ...doc, equipped: { ...doc.equipped, number: n } }, n ? `מספר ${n} על הרכב` : 'בלי מספר משלך')
                  }
                />
              ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  {SHOP_ITEMS.filter((i) => i.kind === section.kind).map((item) => {
                    const has = item.price === 0 || owned.has(item.id);
                    const on = doc.equipped[equipKey(item.kind)] === item.id;
                    return (
                      <button
                        key={item.id}
                        className={`small ${on ? 'cyan' : ''}`}
                        disabled={busy || (!has && item.price > balance)}
                        onClick={() => (has ? equip(item, item.kind) : buy(item))}
                        title={has ? 'לשים על הרכב' : `לקנות ב-${item.price} מטבעות`}
                      >
                        {item.kind === 'color' && (
                          <span className="livery" style={{ background: item.value, width: 10, height: 12, marginInlineEnd: 6 }} />
                        )}
                        {item.label}
                        {!has && <span className="dim"> · 🪙{item.price}</span>}
                        {on && ' ✓'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid">
          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              הרכב שלך
            </div>
            <Preview color={previewColor} look={previewLook} />
            <div className="small muted" style={{ marginTop: 8 }}>
              כך הרכבים של {team} ייראו על המסלול, אצל כל מי שצופה.
            </div>
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

function Preview({ color, look }: { color: string; look: Parameters<typeof drawCarPreview>[2] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look);
  }, [color, look]);
  return <canvas ref={ref} style={{ width: '100%', height: 260, borderRadius: 'var(--radius)', display: 'block' }} />;
}

function NumberPicker({
  owned,
  price,
  balance,
  value,
  busy,
  onBuy,
  onSet,
}: {
  owned: boolean;
  price: number;
  balance: number;
  value: number | undefined;
  busy: boolean;
  onBuy(): void;
  onSet(n: number | undefined): void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  if (!owned) {
    return (
      <button className="small" disabled={busy || price > balance} onClick={onBuy}>
        לקנות מספר לבחירה · 🪙{price}
      </button>
    );
  }
  const n = Number(draft);
  const ok = Number.isInteger(n) && n >= 1 && n <= 99;
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        type="number"
        min={1}
        max={99}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: 90 }}
        aria-label="מספר הרכב"
      />
      <button className="small" disabled={busy || !ok || n === value} onClick={() => onSet(n)}>
        שמירה
      </button>
      {value !== undefined && (
        <button className="ghost small" disabled={busy} onClick={() => onSet(undefined)}>
          להסיר
        </button>
      )}
    </div>
  );
}

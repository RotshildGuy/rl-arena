import { useEffect, useMemo, useRef, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship } from '../useChampionship';
import { earnedCoins } from '../../core/champ/coins';
import {
  ITEM_BY_ID,
  SHOP_ITEMS,
  normalizeShop,
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
import { useT } from '../../i18n';

type SlotKind = Exclude<ItemKind, 'number'>;

/** In the order they are shown; titles and hints are in the dictionary (`shop.sections`). */
const SECTIONS: SlotKind[] = ['color', 'pattern', 'secondary', 'helmet', 'smoke'];

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
  const s = useT().shop;
  const { competitor, showToast } = useApp();
  const { state } = useChampionship();
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [trial, setTrial] = useState<Equipped>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = state?.uid ?? '';

  useEffect(() => {
    if (!uid) return;
    // Through the same check every other reader uses: a document of the wrong
    // shape is an empty shop, not a crash.
    void myShop(uid).then((d) => setDoc(normalizeShop(d)));
  }, [uid]);

  const wallet = useMemo(() => {
    if (!state) return null;
    const now = Date.now();
    return earnedCoins(uid, state.cards, settledResults(state.cards, state.results, now), now);
  }, [state, uid]);

  if (!state || !wallet || !doc) return <PageSkeleton variant="cards" />;

  const balance = wallet.total - spent(doc.purchases);
  const owned = new Set(doc.purchases);
  const has = (id: string) => (ITEM_BY_ID.get(id)?.price ?? 0) === 0 || owned.has(id);
  // A seed for the colour and look, not shown: the same in every language.
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
          ? s.denied
          : s.saveFailed,
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
      void persist({ ...doc, equipped: { ...equipped, ...pickOwned(rest, has) } }, s.onCar(item.label));
      return;
    }
    setTrial({ ...trial, [kind]: item.id });
  };

  const reset = (kind: SlotKind) => {
    const equipped = { ...doc.equipped };
    delete equipped[kind];
    void persist({ ...doc, equipped }, s.backToDefault);
  };

  const buyAll = () => {
    if (cost > balance) return;
    void persist(
      { ...doc, purchases: [...doc.purchases, ...toBuy], equipped: { ...doc.equipped, ...trial } },
      s.bought,
    );
  };

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{s.eyebrow}</div>
          <h1 className="display">{s.title}</h1>
          <div className="muted small">{s.intro}</div>
          <div className="muted small">{s.noMoney}</div>
        </div>
        <div className="actions">
          <span className="pill" style={{ fontSize: 15 }}>
            <Coin /> <span className="mono" style={{ fontWeight: 800 }}>{balance}</span> {s.coins}
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
                {s.trying} <b>{toBuy.map((id) => ITEM_BY_ID.get(id)?.label).join(' · ')}</b>
              </span>
              <div style={{ flex: 1 }} />
              <button className="ghost small" disabled={busy} onClick={() => setTrial({})}>
                {s.cancel}
              </button>
              <button className="primary small" disabled={busy || cost > balance} onClick={buyAll}>
                {cost > balance ? (
                  s.missing(cost - balance)
                ) : (
                  <>
                    {s.buy} <Coin /> {cost}
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 8 }}>
              {s.tapToTry}
            </div>
          )}
          {error && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        <div className="grid">
          {SECTIONS.map((kind) => (
            <div className="card notched" key={kind}>
              <div className="head">
                <div className="eyebrow">{s.sections[kind].title}</div>
                <div className="fill" />
                {doc.equipped[kind] !== undefined && (
                  <button className="ghost small" disabled={busy} onClick={() => reset(kind)}>
                    {s.default}
                  </button>
                )}
              </div>
              {s.sections[kind].hint && (
                <div className="muted small" style={{ marginBottom: 10 }}>
                  {s.sections[kind].hint}
                </div>
              )}
              <div className="swatches">
                {SHOP_ITEMS.filter((i) => i.kind === kind).map((item) => (
                  <Swatch
                    key={item.id}
                    item={item}
                    owned={has(item.id)}
                    on={wearing[kind] === item.id}
                    trying={trial[kind] === item.id}
                    previewColor={previewColor}
                    previewLook={previewLook}
                    onTap={() => tap(item, kind)}
                  />
                ))}
              </div>
            </div>
          ))}

          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {s.number}
            </div>
            <NumberPicker
              owned={owned.has('number')}
              price={ITEM_BY_ID.get('number')!.price}
              value={wearing.number}
              busy={busy}
              onTry={(n) => setTrial({ ...trial, number: n })}
              onSave={(n) =>
                void persist({ ...doc, equipped: { ...doc.equipped, number: n } }, n ? s.numberOn(n) : s.noNumber)
              }
            />
          </div>

          <div className="card notched">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {s.earned}
            </div>
            {wallet.breakdown.length === 0 && (
              <div className="muted small">
                {s.noCoins}
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
                <span className="muted">{s.spent}</span>
                <div style={{ flex: 1 }} />
                <span className="mono muted">-{spent(doc.purchases)}</span>
              </div>
            )}
            <div className="dim tiny" style={{ marginTop: 8 }}>
              {s.honest}
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
  const s = useT().shop;
  return (
    <button
      className={`swatch ${on ? 'on' : ''} ${trying ? 'trying' : ''}`}
      onClick={onTap}
      title={`${item.label}${owned ? '' : s.price(item.price)}`}
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
      <span className="swatch-price">
        {owned ? (
          on ? '✓' : ''
        ) : (
          <>
            <Coin /> {item.price}
          </>
        )}
      </span>
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
  const s = useT().shop;
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
          aria-label={s.numberLabel}
        />
        {owned && (
          <button className="small" disabled={busy || !ok || n === value} onClick={() => onSave(n)}>
            {s.save}
          </button>
        )}
        {owned && value !== undefined && (
          <button className="ghost small" disabled={busy} onClick={() => onSave(undefined)}>
            {s.remove}
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {owned ? s.numberWhere : s.numberTry(price)}
      </div>
    </>
  );
}

/**
 * A coin, drawn rather than typed: the coin emoji is recent enough that plenty
 * of phones and Windows machines still show it as an empty box.
 */
function Coin() {
  return <span className="coin" aria-hidden="true" />;
}

import { Fragment, useEffect, useRef, useState } from 'react';
import { ITEM_BY_ID, SHOP_ITEMS, defaultItems, normalizeShop, ownedPrizes, paintOf, type ShopDoc, type ShopItem, type SlotKind } from '../../core/champ/shop';
import { EMBLEM_SYMBOLS } from '../../core/champ/emblem';
import { teamColor, teamLook } from '../../core/champ/livery';
import { FINISH_FX_MS, drawCarPreview, drawFinishFx, type CarLook } from '../../core/games/racing/render';
import { myShop, saveShop } from '../../storage/shop';
import { teamPrizes } from '../../core/champ/packs';
import { previewEngine } from '../raceAudio';
import { useApp } from '../store';
import { useChampionship } from '../useChampionship';
import { useT } from '../../i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { Podium } from '../components/Podium';
import { Trophy } from '../components/Trophy';
import { Celebration } from '../components/Celebration';
import { CarNumbers } from './Shop';
import { Icon } from '../components/Icon';
import { PageArt } from '../components/PageArt';

/** Every part of the look, in the order the screen lists them: the car, then sound, then the podium. */
const PARTS: SlotKind[] = [
  'color', 'secondary', 'pattern', 'shape', 'wing', 'rim', 'helmet', 'visor', 'decal',
  'smoke', 'trail', 'flame', 'engine', 'celebration', 'finish', 'trophy', 'frame', 'banner', 'title', 'quote',
];
/** The tiles in order: the car's number first, then the team's look. */
const TILES: Array<SlotKind | 'number'> = ['number', ...PARTS];
/** Parts whose default is to have none at all, rather than a look of their own. */
const NOTHING_BY_DEFAULT: SlotKind[] = ['trail', 'flame', 'visor', 'decal', 'celebration', 'finish', 'trophy', 'frame', 'banner', 'title', 'quote'];
/** Parts seen on the podium card rather than on the car. */
const PODIUM_PARTS: SlotKind[] = ['trophy', 'frame', 'banner', 'title'];

/** Only the dev server's sample teams have pack prizes before packs open. */
const DEMO_PACKS = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

/**
 * Design, from the garage: how the team's cars look, out of what it already
 * has - paint bought in the shop and prizes won in packs. Nothing is for sale
 * here and nothing can be tried that is not owned. Every part of the look is
 * a tile showing what is on now; a tap opens everything the team has for that
 * part, with an X for none.
 */
export function Design() {
  const words = useT();
  const s = words.shop;
  const d = s.design;
  const { competitor, showToast, go } = useApp();
  const { state } = useChampionship();
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [open, setOpen] = useState<SlotKind | 'number' | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = state?.uid ?? '';
  /** Tiles per row, measured, so the picker opens right under the row of the tile tapped. */
  const gridRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);

  useEffect(() => {
    if (!uid) return;
    void myShop(uid).then((x) => setDoc(normalizeShop(x)));
  }, [uid]);

  const loaded = doc !== null;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    if (open) pickerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  if (!state || !doc) return <PageSkeleton variant="cards" />;

  const team = competitor || 'הקבוצה שלי';
  const myCars = state.entries.filter((e) => e.uid === uid && !e.retired).sort((a, b) => a.createdAt - b.createdAt);
  const driver = myCars[0]?.driver ?? team;
  const bought = new Set(doc.purchases);
  const prizes = new Set(ownedPrizes(doc, { packs: DEMO_PACKS, won: teamPrizes(uid, doc, state.cards) }));
  /** Shop items that are the team's look anyway: they are the default tile, not items of their own. */
  const defaults = defaultItems(team);
  const isDefault = (it: ShopItem) => defaults[it.kind as SlotKind] === it.id;
  /** What the team has: shop paint it bought (or that is free), and prizes it won. */
  const owns = (it: ShopItem) => (it.pack ? prizes.has(it.id) : !isDefault(it) && (it.price === 0 || bought.has(it.id)));
  const ownedOf = (kind: SlotKind) => SHOP_ITEMS.filter((it) => it.kind === kind && owns(it));
  const rowEnd = open ? Math.min(TILES.length - 1, Math.floor(TILES.indexOf(open) / cols) * cols + cols - 1) : -1;
  const base = teamLook(team, driver);
  const defaultLabel = (kind: SlotKind) => (NOTHING_BY_DEFAULT.includes(kind) ? d.none : s.default);
  const DefaultArt = ({ kind }: { kind: SlotKind }) => <DefaultArtOf kind={kind} team={team} base={base} look={look} color={color} />;

  const paint = paintOf(doc.equipped);
  const color = paint.color ?? teamColor(team);
  const firstNumber = myCars.length ? doc.equipped.numbers?.[myCars[0].id] : undefined;
  const look: CarLook = { ...teamLook(team, driver), ...paint.look, ...(firstNumber ? { number: firstNumber } : {}) };
  const current = (kind: SlotKind) => {
    const id = doc.equipped[kind];
    const it = id ? ITEM_BY_ID.get(id) : undefined;
    return it && it.kind === kind && owns(it) ? it : null;
  };

  /** A number per car: the one part that is each car's own, not the team's. */
  const setNumber = async (id: string, n: number | undefined) => {
    const numbers = { ...doc.equipped.numbers };
    if (n === undefined) delete numbers[id];
    else numbers[id] = n;
    const next = { ...doc, equipped: { ...doc.equipped, numbers } };
    setBusy(true);
    try {
      await saveShop(uid, next);
      setDoc(next);
      showToast(n ? s.numberOn(n) : s.noNumber);
    } catch {
      showToast(s.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (kind: SlotKind, it: ShopItem | null) => {
    const equipped = { ...doc.equipped };
    if (it) equipped[kind] = it.id;
    else delete equipped[kind];
    const next = { ...doc, equipped };
    setBusy(true);
    try {
      await saveShop(uid, next);
      setDoc(next);
      showToast(it ? s.onCar(it.label) : s.backToDefault);
      if (it?.kind === 'engine') previewEngine(it.value as NonNullable<CarLook['engine']>);
    } catch {
      showToast(s.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <PageArt kind="design" />
        <div className="title">
          <div className="eyebrow">{d.eyebrow}</div>
          <h1 className="display">{d.title}</h1>
          <div className="muted small">{d.intro}</div>
        </div>
        <div className="actions">
          <button className="ghost small" onClick={() => go('library')}>
            {d.back}
          </button>
          <button className="small" onClick={() => go('shop')}>
            <Icon name="bag" /> {d.toShop}
          </button>
          <button className="small" onClick={() => go('packs')}>
            <Icon name="gift" /> {words.packShop.toPacks}
          </button>
        </div>
      </div>

      <div className="shop-layout">
        <div className="shop-preview design-preview card notched">
          <DesignCar color={color} look={look} />
          {look.finish && <FinishPreview kind={look.finish} color={color} second={look.secondary} />}
          {PODIUM_PARTS.some((k) => current(k)) && <Podium compact places={[{ position: 1, driver, team, color, look }]} />}
        </div>

        <div className="grid">
          <div className="card notched">
            <div className="design-parts" ref={gridRef}>
              {TILES.map((kind, i) => (
                <Fragment key={kind}>
                  {kind === 'number' ? (
                    <button
                      className={`design-part ${open === 'number' ? 'on' : ''}`}
                      onClick={() => setOpen(open === 'number' ? null : 'number')}
                      aria-expanded={open === 'number'}
                    >
                      <span className="design-part-art design-number" aria-hidden="true">
                        {firstNumber ?? '-'}
                      </span>
                      <span className="design-part-title">{s.number}</span>
                      <span className="tiny muted">{bought.has('number') ? d.perCar : s.default}</span>
                      <span className="tiny dim">{d.count(bought.has('number') ? 1 : 0)}</span>
                    </button>
                  ) : (
                    <button
                      className={`design-part ${open === kind ? 'on' : ''}`}
                      onClick={() => setOpen(open === kind ? null : kind)}
                      aria-expanded={open === kind}
                    >
                      <span className="design-part-art" aria-hidden="true">
                        {current(kind) ? <ItemArt item={current(kind)!} color={color} look={look} /> : <DefaultArt kind={kind} />}
                      </span>
                      <span className="design-part-title">{s.sections[kind].title}</span>
                      <span className="tiny muted">{current(kind)?.label ?? defaultLabel(kind)}</span>
                      <span className="tiny dim">{d.count(ownedOf(kind).length + 1)}</span>
                    </button>
                  )}
                  {open && i === rowEnd && (
                    <div className="design-picker" ref={pickerRef}>
                      {open === 'number' ? (
                        !bought.has('number') ? (
                          <div className="small muted">{d.emptyShop}</div>
                        ) : myCars.length === 0 ? (
                          <div className="small muted">{s.noCarsYet}</div>
                        ) : (
                          <CarNumbers cars={myCars} numbers={doc.equipped.numbers ?? {}} busy={busy} onSave={(id, n) => void setNumber(id, n)} />
                        )
                      ) : (
                        <>
                          {s.sections[open].hint && <div className="muted small" style={{ marginBottom: 8 }}>{s.sections[open].hint}</div>}
                          <div className="prize-chips">
                            <button
                              className={`prize-chip ${current(open) ? '' : 'on'}`}
                              disabled={busy}
                              aria-pressed={!current(open)}
                              onClick={() => void choose(open, null)}
                              title={defaultLabel(open)}
                            >
                              <span className="prize-art" aria-hidden="true">
                                <DefaultArt kind={open} />
                              </span>
                              <span className="prize-label">{defaultLabel(open)}</span>
                            </button>
                            {ownedOf(open).map((it) => (
                              <button
                                key={it.id}
                                className={`prize-chip ${it.rarity ? `rarity-${it.rarity}` : ''} ${current(open)?.id === it.id ? 'on' : ''}`}
                                disabled={busy}
                                aria-pressed={current(open)?.id === it.id}
                                onClick={() => void choose(open, it)}
                                title={it.label}
                              >
                                <span className="prize-art" aria-hidden="true">
                                  <ItemArt item={it} color={color} look={look} />
                                </span>
                                <span className="prize-label">{it.label}</span>
                                {it.rarity && <span className="prize-rarity">{s.packs.rarity[it.rarity]}</span>}
                              </button>
                            ))}
                          </div>
                          {ownedOf(open).length === 0 && (
                            <div className="small muted" style={{ marginTop: 8 }}>
                              {SHOP_ITEMS.some((it) => it.kind === open && !it.pack) ? d.emptyShop : d.emptyPacks}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** The car with what it wears, on asphalt: trail and flame included. */
function DesignCar({ color, look }: { color: string; look: CarLook }) {
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

/** A small car in a pattern or a shape, for its tile. */
function TinyCar({ color, look }: { color: string; look: CarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    drawCarPreview(c.getContext('2d')!, color, look, null);
  }, [color, look.pattern, look.shape, look.secondary]);
  return <canvas ref={ref} className="design-tiny-car" />;
}

/** What a part looks like when nothing is chosen for it: the team's own paint, or nothing. */
function DefaultArtOf({ kind, team, base, look, color }: { kind: SlotKind; team: string; base: CarLook; look: CarLook; color: string }) {
  switch (kind) {
    case 'color':
      return <span className="prize-swatch round" style={{ background: teamColor(team) }} />;
    case 'secondary':
      return <span className="prize-swatch round" style={{ background: base.secondary }} />;
    case 'wing':
      return <span className="prize-swatch round" style={{ background: look.secondary ?? base.secondary }} />;
    case 'rim':
      return <span className="prize-swatch round" style={{ background: '#c8d0de' }} />;
    case 'helmet':
      return <span className="prize-swatch round" style={{ background: '#f4f6fb' }} />;
    case 'smoke':
      return <span className="prize-swatch round" style={{ background: 'radial-gradient(circle, rgba(210, 216, 230, 0.95), transparent 70%)' }} />;
    case 'pattern':
      return <TinyCar color={color} look={{ ...look, pattern: base.pattern, number: undefined, emblem: undefined }} />;
    case 'shape':
      return <TinyCar color={color} look={{ ...look, shape: 'classic', number: undefined, emblem: undefined }} />;
    case 'engine':
      return <Icon name="sound" size={22} />;
    default:
      return <span className="design-x"><Icon name="close" /></span>;
  }
}

/** What an item is, shown small: a swatch, a little car, an icon. */
export function ItemArt({ item, color, look }: { item: ShopItem; color: string; look: CarLook }) {
  switch (item.kind) {
    case 'color':
    case 'secondary':
    case 'helmet':
      return <span className="prize-swatch round" style={{ background: item.value }} />;
    case 'smoke':
      return <span className="prize-swatch round" style={{ background: `radial-gradient(circle, ${item.value.replace(/[\d.]+\)$/, '0.95)')}, transparent 70%)` }} />;
    case 'pattern':
      return <TinyCar color={color} look={{ ...look, pattern: item.value as CarLook['pattern'], number: undefined, emblem: undefined }} />;
    case 'shape':
      return <TinyCar color={color} look={{ ...look, shape: item.value as CarLook['shape'], number: undefined, emblem: undefined }} />;
    case 'celebration':
      return (
        <span className="prize-swatch round party">
          <Celebration fit kind={item.value as NonNullable<CarLook['celebration']>} colors={[color, look.secondary ?? '']} />
        </span>
      );
    default:
      return <PrizeArt item={item} color={look.secondary ?? color} />;
  }
}

function PrizeArt({ item, color }: { item: ShopItem; color: string }) {
  switch (item.kind) {
    case 'trail':
      return (
        <span
          className="prize-swatch"
          style={{
            background:
              item.value === 'rainbow'
                ? 'linear-gradient(90deg, #ff2e4d, #ff7a1a, #ffd84d, #38f08a, #38bdf8, #a855f7)'
                : `linear-gradient(90deg, ${item.value}, transparent)`,
          }}
        />
      );
    case 'flame': {
      const [core, outer] = item.value.split('|');
      return <span className="prize-swatch round" style={{ background: `radial-gradient(circle, ${core} 25%, ${outer} 60%, transparent 72%)` }} />;
    }
    case 'wing':
    case 'rim':
      return <span className="prize-swatch round" style={{ background: item.value }} />;
    case 'decal':
      return (
        <svg viewBox="0 0 24 24" className="prize-icon">
          <path d={EMBLEM_SYMBOLS[item.value === 'checker' ? 'chequer' : item.value] ?? ''} fill="currentColor" fillRule="evenodd" transform="translate(-4.8 -4.8) scale(1.4)" />
        </svg>
      );
    case 'visor':
      return <span className={`prize-swatch round visor-${item.value}`} style={{ ['--c' as string]: color }} />;
    case 'trophy':
      return <Trophy kind={item.value as NonNullable<CarLook['trophy']>} className="prize-icon" />;
    case 'frame':
      return <span className={`prize-swatch framed frame-${item.value}`} />;
    case 'banner':
      return <span className={`prize-swatch banner banner-${item.value}`} />;
    case 'engine':
      return <Icon name="sound" size={22} />;
    case 'finish':
      return <Icon name="sparkle" size={22} />;
    case 'title':
      return <Icon name="tag" size={22} />;
    case 'quote':
      return <Icon name="radio" size={22} />;
    default:
      return null;
  }
}

/** The finish-line prize being worn, played over and over on a strip of asphalt. */
function FinishPreview({ kind, color, second }: { kind: NonNullable<CarLook['finish']>; color: string; second?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = ((now - start) % (FINISH_FX_MS + 600)) / FINISH_FX_MS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2b303d';
      ctx.fillRect(0, 0, c.width, c.height);
      if (t < 1) {
        ctx.translate(c.width / 2, c.height / 2);
        drawFinishFx(ctx, kind, t, c.height * 0.18, color, second);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kind, color, second]);
  return <canvas ref={ref} className="finish-preview" />;
}

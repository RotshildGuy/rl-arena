import { useEffect, useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { useMyBets } from '../useBets';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, normalizeShop, paintOf, type Rarity, type ShopDoc, type ShopItem } from '../../core/champ/shop';
import {
  CRAFT_COST,
  DUPE_CHIPS,
  MAX_PACKS,
  PACK_TYPES,
  locker,
  packPrizes,
  packRound,
  type OpenedPack,
  type PackRecord,
  type PackType,
} from '../../core/champ/packs';
import { lockAtForRound, raceIdForRound, seasonForRound, seasonNumber, seasonRange } from '../../core/champ/schedule';
import { teamColor, teamLook } from '../../core/champ/livery';
import type { CarLook } from '../../core/games/racing/render';
import { myShop, saveShop } from '../../storage/shop';
import { useT } from '../../i18n';
import { dateText, whenText } from '../format';
import { Coin } from './Shop';
import { ItemArt } from './Design';

/** Packs this browser has already watched being opened: the reveal is shown once, the prizes are the team's either way. */
const SEEN_KEY = 'rl-arena-packs-seen';
function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(keys: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), ...keys])]));
  } catch {
    // A private window: the reveal comes again next time, nothing else changes.
  }
}

/**
 * Packs (ROADMAP 5.7): buy with coins, open after the next lock. What is in
 * each pack is worked out here from its record and the race card (`packs.ts`),
 * exactly as every other browser works it out when it checks the team's look.
 */
export function Packs() {
  const words = useT();
  const p = words.packShop;
  const rarityWords = words.shop.packs.rarity;
  const { competitor, showToast, go } = useApp();
  const { state } = useChampionship();
  const now = useNow(15_000);
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const [opening, setOpening] = useState<OpenedPack[] | null>(null);
  const uid = state?.uid ?? '';

  useEffect(() => {
    if (!uid) return;
    void myShop(uid).then((d) => setDoc(normalizeShop(d)));
  }, [uid]);

  const mine = useMyBets(doc);
  const box = useMemo(() => (doc && state ? locker(uid, doc.packs ?? [], doc.crafted ?? [], state.cards) : null), [doc, state, uid]);

  if (!state || !doc || !mine || !box) return <PageSkeleton variant="cards" />;

  const team = competitor || 'הקבוצה שלי';
  const paint = paintOf(doc.equipped);
  const color = paint.color ?? teamColor(team);
  const look: CarLook = { ...teamLook(team, ''), ...paint.look };
  const round = packRound(now);
  const open = seasonNumber(round) >= PACKS_SEASON;
  const firstPackRound = seasonRange(PACKS_SEASON).first;
  const key = (pk: PackRecord) => `${uid}:${pk.n}`;
  const ready = box.opened.filter((o) => !seen.has(key(o.pack)));
  const history = box.opened.filter((o) => seen.has(key(o.pack))).reverse();
  const prizes = packPrizes();

  const buy = async (type: PackType) => {
    if (busy || type.price > mine.balance || !open) return;
    const packs = doc.packs ?? [];
    if (packs.length >= MAX_PACKS) return;
    const record: PackRecord = {
      n: packs.length + 1,
      type: type.id,
      round,
      raceId: raceIdForRound(round),
      seasonId: seasonForRound(round),
      boughtAt: Date.now(),
    };
    const next: ShopDoc = { ...doc, packs: [...packs, record] };
    setBusy(true);
    try {
      await saveShop(uid, next);
      setDoc(next);
      showToast(p.bought(round));
    } catch (e) {
      showToast((e as { code?: string })?.code === 'permission-denied' ? p.denied : p.failed);
    } finally {
      setBusy(false);
    }
  };

  const craft = async (it: ShopItem) => {
    if (busy || !it.rarity || CRAFT_COST[it.rarity] > box.chips) return;
    const next: ShopDoc = { ...doc, crafted: [...(doc.crafted ?? []), it.id] };
    setBusy(true);
    try {
      await saveShop(uid, next);
      setDoc(next);
      showToast(p.crafted(it.label));
    } catch (e) {
      showToast((e as { code?: string })?.code === 'permission-denied' ? p.denied : p.failed);
    } finally {
      setBusy(false);
    }
  };

  const finishOpening = (list: OpenedPack[]) => {
    markSeen(list.map((o) => key(o.pack)));
    setSeen(readSeen());
    setOpening(null);
  };

  return (
    <div className="packs-screen">
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{p.eyebrow}</div>
          <h1 className="display">{p.title}</h1>
          <div className="muted small">{p.intro}</div>
          <div className="muted small">{p.noMoney}</div>
        </div>
        <div className="actions">
          <span className="pill" style={{ fontSize: 15 }}>
            <Coin /> <span className="mono" dir="ltr" style={{ fontWeight: 800 }}>{mine.balance}</span> {p.coins}
          </span>
          <span className="pill" style={{ fontSize: 15 }}>
            <span aria-hidden="true">◆</span> <span className="mono" style={{ fontWeight: 800 }}>{box.chips}</span> {p.chips}
          </span>
        </div>
      </div>

      {!open && <div className="card notched small" style={{ marginBottom: 14 }}>🔒 {p.locked(PACKS_SEASON, dateText(lockAtForRound(firstPackRound)))}</div>}

      {ready.length > 0 && (
        <div className="card notched pack-ready" style={{ marginBottom: 14 }}>
          <div className="head">
            <div className="eyebrow">{p.ready}</div>
            <div className="fill" />
            <button className="primary" onClick={() => setOpening(ready)}>
              🎁 {ready.length > 1 ? `${p.openAll} (${ready.length})` : p.open}
            </button>
          </div>
          <div className="pack-row">
            {ready.map((o) => (
              <button key={o.pack.n} className={`pack-box pack-${o.pack.type} small-box wobble`} onClick={() => setOpening([o])} aria-label={`${p.open} ${p.packNo(o.pack.n)}`}>
                <span className="pack-box-mark">?</span>
                <span className="tiny">{p.packNo(o.pack.n)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pack-types">
        {PACK_TYPES.map((type) => (
          <div key={type.id} className="card notched pack-type">
            <div className={`pack-box pack-${type.id}`} aria-hidden="true">
              <span className="pack-box-mark">{type.id === 'premium' ? '★' : '?'}</span>
            </div>
            <div className="pack-type-body">
              <h2 style={{ margin: 0 }}>{p.types[type.id].name}</h2>
              <div className="small muted">
                {p.types[type.id].hint} · {p.items(type.items)}
              </div>
              <div className="tiny muted" style={{ marginTop: 8 }}>
                {p.odds}
              </div>
              <div className="pack-odds">
                {RARITIES.map((r) => (
                  <div key={r} className={`pack-odd rarity-${r}`}>
                    <span>{rarityWords[r]}</span>
                    <span className="mono" dir="ltr">{type.odds[r]}%</span>
                  </div>
                ))}
              </div>
              <button
                className="primary"
                style={{ marginTop: 10, width: '100%' }}
                disabled={busy || !open || type.price > mine.balance}
                onClick={() => void buy(type)}
              >
                {busy ? p.buying : type.price > mine.balance ? <>{p.missing(type.price - mine.balance)} <Coin /></> : <>{p.buy(type.price)} <Coin /></>}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="dim tiny" style={{ margin: '6px 2px 14px' }}>
        {p.noPity}
      </div>

      {box.waiting.length > 0 && (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {p.waiting}
          </div>
          <div className="pack-row">
            {box.waiting.map((pk) => (
              <div key={pk.n} className={`pack-box pack-${pk.type} small-box sealed`}>
                <span className="pack-box-mark">🔒</span>
                <span className="tiny">{p.packNo(pk.n)}</span>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {[...new Set(box.waiting.map((pk) => pk.round))].map((r) => p.opensAt(r, whenText(lockAtForRound(r), now))).join(' · ')}
          </div>
        </div>
      )}

      <div className="card notched" style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {p.history}
        </div>
        {history.length === 0 && box.waiting.length === 0 && ready.length === 0 && <div className="small muted">{p.noneYet}</div>}
        {history.map((o) => (
          <div key={o.pack.n} className="pack-history-row">
            <span className="small" style={{ minWidth: 90 }}>
              {p.packNo(o.pack.n)}
            </span>
            <div className="prize-chips" style={{ flex: 1 }}>
              {o.items.map((x) => {
                const it = ITEM_BY_ID.get(x.id)!;
                return (
                  <span key={x.id} className={`prize-chip rarity-${it.rarity}`} title={it.label}>
                    <span className="prize-art" aria-hidden="true">
                      <ItemArt item={it} color={color} look={look} />
                    </span>
                    <span className="prize-label">{it.label}</span>
                    <span className="prize-rarity">{x.dupe ? p.dupe(x.chips) : rarityWords[it.rarity!]}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {box.invalid.length > 0 && <div className="tiny dim">{p.invalid(box.invalid.length)}</div>}
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="ghost small" onClick={() => go('shop')}>
            {p.back}
          </button>
          <button className="small" onClick={() => go('design')}>
            {p.toDesign}
          </button>
        </div>
      </div>

      <div className="card notched" style={{ marginBottom: 14 }}>
        <div className="head">
          <div className="eyebrow">{p.workshop}</div>
          <div className="fill" />
          <span className="tiny muted">{p.collection(box.owned.size, prizes.length)}</span>
        </div>
        <div className="small muted" style={{ margin: '6px 0 8px' }}>
          {p.workshopIntro}
        </div>
        <div className="pack-odds" style={{ marginBottom: 10 }}>
          {RARITIES.map((r) => (
            <div key={r} className={`pack-odd rarity-${r}`}>
              <span>
                {p.dupeValue} ({rarityWords[r]})
              </span>
              <span className="mono" dir="ltr">+{DUPE_CHIPS[r]}</span>
            </div>
          ))}
        </div>
        {box.owned.size >= prizes.length ? (
          <div className="small">{p.allOwned}</div>
        ) : (
          RARITIES.map((r: Rarity) => {
            const missing = prizes.filter((it) => it.rarity === r && !box.owned.has(it.id));
            if (!missing.length) return null;
            return (
              <div key={r} style={{ marginBottom: 10 }}>
                <div className={`tiny pack-rarity-head rarity-${r}`}>
                  {rarityWords[r]} · {p.craft(CRAFT_COST[r])}
                </div>
                <div className="prize-chips">
                  {missing.map((it) => (
                    <button
                      key={it.id}
                      className={`prize-chip rarity-${r}`}
                      disabled={busy || CRAFT_COST[r] > box.chips}
                      onClick={() => void craft(it)}
                      title={it.label}
                    >
                      <span className="prize-art" aria-hidden="true">
                        <ItemArt item={it} color={color} look={look} />
                      </span>
                      <span className="prize-label">{it.label}</span>
                      <span className="prize-rarity">◆ {CRAFT_COST[r]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {opening && <PackOpening packs={opening} color={color} look={look} onDone={() => finishOpening(opening)} />}
    </div>
  );
}

/**
 * The opening: the pack shakes until it is tapped, bursts, and the prizes come
 * out one at a time - face down first, then turned over, the rarest last.
 */
function PackOpening({ packs, color, look, onDone }: { packs: OpenedPack[]; color: string; look: CarLook; onDone(): void }) {
  const words = useT();
  const p = words.packShop;
  const rarityWords = words.shop.packs.rarity;
  const [which, setWhich] = useState(0);
  /** -1: sealed. Then how many prizes are turned over. */
  const [shown, setShown] = useState(-1);
  const pack = packs[which];
  const total = pack.items.length;
  const best = pack.items.reduce((b, x) => Math.max(b, RARITIES.indexOf(ITEM_BY_ID.get(x.id)!.rarity!)), 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onDone]);

  const step = () => {
    if (shown < total) setShown(shown + 1);
    else if (which < packs.length - 1) {
      setWhich(which + 1);
      setShown(-1);
    } else onDone();
  };

  const done = shown >= total;
  return (
    <div className={`pack-open-backdrop glow-${RARITIES[best]}`} role="dialog" aria-modal="true" aria-label={p.packNo(pack.pack.n)} onClick={step}>
      <div className="pack-open-stage">
        <div className="eyebrow">
          {p.types[pack.pack.type].name} · {p.packNo(pack.pack.n)}
          {packs.length > 1 ? ` · ${which + 1}/${packs.length}` : ''}
        </div>
        {shown < 0 ? (
          <div className={`pack-box pack-${pack.pack.type} big-box shake`}>
            <span className="pack-box-mark">?</span>
          </div>
        ) : (
          <div className="pack-cards">
            {pack.items.map((x, i) => {
              const it = ITEM_BY_ID.get(x.id)!;
              const up = i < shown;
              return (
                <div key={x.id} className={`pack-card rarity-${it.rarity} ${up ? 'up' : ''}`} style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="pack-card-inner">
                    <div className="pack-card-back">?</div>
                    <div className="pack-card-face">
                      <span className="pack-card-rarity">{rarityWords[it.rarity!]}</span>
                      <span className="prize-art big" aria-hidden="true">
                        <ItemArt item={it} color={color} look={look} />
                      </span>
                      <span className="pack-card-label">{it.label}</span>
                      <span className={`pack-card-tag ${x.dupe ? 'dupe' : 'new'}`}>{x.dupe ? p.dupe(x.chips) : p.isNew}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="small muted pack-open-hint">{shown < 0 ? p.tapToOpen : done ? '' : p.tapNext}</div>
        {done && (
          <button
            className="primary"
            onClick={(e) => {
              e.stopPropagation();
              step();
            }}
          >
            {which < packs.length - 1 ? `${p.open} ${p.packNo(packs[which + 1].pack.n)}` : p.done}
          </button>
        )}
      </div>
    </div>
  );
}

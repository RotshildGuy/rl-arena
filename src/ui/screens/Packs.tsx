import { useEffect, useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { ITEM_BY_ID, PACKS_SEASON, RARITIES, normalizeShop, paintOf, type ShopDoc } from '../../core/champ/shop';
import {
  DAY_MS,
  DUPE_COINS,
  PACK_TYPES,
  STREAK_DAYS,
  currentStreak,
  giftDay,
  locker,
  packPrizes,
  packsOpen,
  type GiftRecord,
  type OpenedPack,
} from '../../core/champ/packs';
import { lockAtForRound, seasonRange } from '../../core/champ/schedule';
import { teamColor, teamLook } from '../../core/champ/livery';
import type { CarLook } from '../../core/games/racing/render';
import { myShop, onShopChanged } from '../../storage/shop';
import { useT } from '../../i18n';
import { dateText, whenText } from '../format';
import { ItemArt } from './Design';
import { Icon } from '../components/Icon';
import { PageArt } from '../components/PageArt';

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

/** A gift day as a date, read at its middle so no time zone moves it to the day before. */
const dayDate = (g: GiftRecord) => dateText(g.day * DAY_MS + DAY_MS / 2);

/**
 * Packs (ROADMAP 5.7): a gift for every day the team opens the game, opened
 * after the next lock. What is in each one is worked out here from its claim
 * and the race card (`packs.ts`), exactly as every other browser works it out
 * when it checks the team's look. Nothing here is for sale.
 */
export function Packs() {
  const words = useT();
  const p = words.packShop;
  const rarityWords = words.shop.packs.rarity;
  const { competitor, go } = useApp();
  const { state } = useChampionship();
  const now = useNow(15_000);
  const [doc, setDoc] = useState<ShopDoc | null>(null);
  const [seen, setSeen] = useState(readSeen);
  const [opening, setOpening] = useState<OpenedPack[] | null>(null);
  const [tick, setTick] = useState(0);
  const uid = state?.uid ?? '';

  // Read again when today's gift lands (it is claimed as the app opens, maybe while this screen is up).
  useEffect(() => onShopChanged(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (!uid) return;
    void myShop(uid).then((d) => setDoc(normalizeShop(d)));
  }, [uid, tick]);

  const box = useMemo(() => (doc && state ? locker(uid, doc.gifts ?? [], state.cards) : null), [doc, state, uid]);

  if (!state || !doc || !box) return <PageSkeleton variant="cards" />;

  const team = competitor || 'הקבוצה שלי';
  const paint = paintOf(doc.equipped);
  const color = paint.color ?? teamColor(team);
  const look: CarLook = { ...teamLook(team, ''), ...paint.look };
  const open = packsOpen(now);
  const today = giftDay(now);
  const gifts = doc.gifts ?? [];
  const claimedToday = gifts.some((g) => g.day === today);
  const streak = currentStreak(gifts, today);
  // Days until the next premium, today included while it is still to come.
  const toPremium = STREAK_DAYS - (streak % STREAK_DAYS) - (claimedToday ? 0 : 1);
  const firstPackRound = seasonRange(PACKS_SEASON).first;
  const key = (g: GiftRecord) => `${uid}:${g.day}`;
  const ready = box.opened.filter((o) => !seen.has(key(o.gift)));
  const history = box.opened.filter((o) => seen.has(key(o.gift))).reverse();
  const prizes = packPrizes();

  const finishOpening = (list: OpenedPack[]) => {
    markSeen(list.map((o) => key(o.gift)));
    setSeen(readSeen());
    setOpening(null);
  };

  return (
    <div className="packs-screen">
      <div className="toolbar">
        <PageArt kind="packs" />
        <div className="title">
          <h1 className="display">{p.title}</h1>
          <div className="muted small">{p.intro}</div>
        </div>
        <div className="actions">
          <span className="pill">{p.collection(box.owned.size, prizes.length)}</span>
        </div>
      </div>

      {!open ? (
        <div className="card notched small" style={{ marginBottom: 14 }}>
          <Icon name="lock" /> {p.locked(PACKS_SEASON, dateText(lockAtForRound(firstPackRound)))}
        </div>
      ) : (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="eyebrow">{p.daily}</div>
          <div className="pack-daily-row">
            <div className="pack-streak" aria-label={p.streak(streak)}>
              {Array.from({ length: STREAK_DAYS }, (_, i) => {
                const filled = i < streak % STREAK_DAYS || (streak > 0 && streak % STREAK_DAYS === 0 && claimedToday);
                const last = i === STREAK_DAYS - 1;
                return (
                  <span key={i} className={`pack-streak-dot ${filled ? 'on' : ''} ${last ? 'premium' : ''}`}>
                    {last ? <Icon name="star" size={14} /> : i + 1}
                  </span>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 700 }}>
                {claimedToday ? p.claimed : p.notYet}
              </div>
              <div className="small muted">
                {p.streak(streak)} · {toPremium <= 0 ? p.types.premium.name : p.nextPremium(toPremium)}
              </div>
              <div className="tiny dim" style={{ marginTop: 4 }}>
                {p.streakRule(STREAK_DAYS)} {p.dayTurns}
              </div>
            </div>
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="head">
            <div className="eyebrow">{p.ready}</div>
            <div className="fill" />
            <button className="primary" onClick={() => setOpening(ready)}>
              <Icon name="gift" /> {ready.length > 1 ? `${p.openAll} (${ready.length})` : p.open}
            </button>
          </div>
          <div className="pack-row">
            {ready.map((o) => (
              <button
                key={o.gift.day}
                className={`pack-box pack-${o.type} small-box wobble`}
                onClick={() => setOpening([o])}
                aria-label={`${p.open} ${p.packOf(dayDate(o.gift))}`}
              >
                <span className="pack-box-mark">{o.type === 'premium' ? <Icon name="star" /> : '?'}</span>
                <span className="tiny">{dayDate(o.gift)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {box.waiting.length > 0 && (
        <div className="card notched" style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {p.waiting}
          </div>
          <div className="pack-row">
            {box.waiting.map(({ gift, type }) => (
              <div key={gift.day} className={`pack-box pack-${type} small-box sealed`}>
                <span className="pack-box-mark"><Icon name="lock" /></span>
                <span className="tiny">{dayDate(gift)}</span>
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {[...new Set(box.waiting.map(({ gift }) => gift.round))].map((r) => p.opensAt(r, whenText(lockAtForRound(r), now))).join(' · ')}
          </div>
        </div>
      )}

      <div className="pack-types">
        {PACK_TYPES.map((type) => (
          <div key={type.id} className="card notched pack-type">
            <div className={`pack-box pack-${type.id}`} aria-hidden="true">
              <span className="pack-box-mark">{type.id === 'premium' ? <Icon name="star" /> : '?'}</span>
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
                    <span className="mono" dir="ltr">
                      {type.odds[r]}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="dim tiny" style={{ margin: '6px 2px 14px' }}>
        {p.noPity}
      </div>

      <div className="card notched" style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          {p.history}
        </div>
        {history.length === 0 && box.waiting.length === 0 && ready.length === 0 && <div className="small muted">{p.noneYet}</div>}
        {history.map((o) => (
          <div key={o.gift.day} className="pack-history-row">
            <span className="small" style={{ minWidth: 110 }}>
              {o.type === 'premium' ? <><Icon name="star" size={13} /> </> : ''}
              {p.packOf(dayDate(o.gift))}
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
                    <span className="prize-rarity">{x.dupe ? p.dupe(x.coins) : rarityWords[it.rarity!]}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
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
          <div className="eyebrow">{p.dupes}</div>
          <div className="fill" />
          <span className="tiny muted">
            {p.dupesTotal}{' '}
            <span className="mono" dir="ltr" style={{ fontWeight: 800 }}>
              +{box.coins}
            </span>
          </span>
        </div>
        <div className="small muted" style={{ margin: '6px 0 8px' }}>
          {p.dupesIntro}
        </div>
        <div className="pack-odds">
          {RARITIES.map((r) => (
            <div key={r} className={`pack-odd rarity-${r}`}>
              <span>{rarityWords[r]}</span>
              <span className="mono" dir="ltr">
                +{DUPE_COINS[r]}
              </span>
            </div>
          ))}
        </div>
        {box.owned.size >= prizes.length && (
          <div className="small" style={{ marginTop: 8 }}>
            {p.allOwned}
          </div>
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
  const label = p.packOf(dayDate(pack.gift));

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
    <div className={`pack-open-backdrop glow-${RARITIES[best]}`} role="dialog" aria-modal="true" aria-label={label} onClick={step}>
      <div className="pack-open-stage">
        <div className="eyebrow">
          {p.types[pack.type].name} · {label}
          {packs.length > 1 ? ` · ${which + 1}/${packs.length}` : ''}
        </div>
        {shown < 0 ? (
          <div className={`pack-box pack-${pack.type} big-box shake`}>
            <span className="pack-box-mark">{pack.type === 'premium' ? <Icon name="star" /> : '?'}</span>
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
                      <span className={`pack-card-tag ${x.dupe ? 'dupe' : 'new'}`}>{x.dupe ? p.dupe(x.coins) : p.isNew}</span>
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
            {which < packs.length - 1 ? `${p.open} · ${p.packOf(dayDate(packs[which + 1].gift))}` : p.done}
          </button>
        )}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { PageSkeleton } from '../components/PageSkeleton';
import { useApp } from '../store';
import { useChampionship, useNow } from '../useChampionship';
import { useMyBets } from '../useBets';
import {
  MIN_STAKE,
  bettableRound,
  newBetId,
  raceOdds,
  seasonOdds,
  titleDecided,
  type Bet,
  type BetKind,
  type BetMarket,
  type Runner,
} from '../../core/champ/bets';
import { ratingsBefore } from '../../core/champ/ratings';
import { eligibleEntries } from '../../core/champ/card';
import { raceIdForRound, seasonForRound, seasonNumber, startsAtForRound, trackForRound } from '../../core/champ/schedule';
import { settledResults } from '../../core/champ/timing';
import { placeBet } from '../../storage/bets';
import { useT } from '../../i18n';
import { driverName, teamName, trackName } from '../../i18n/names';
import { Name } from '../components/Name';
import { Coin } from './Shop';
import { Icon } from '../components/Icon';
import { PageArt } from '../components/PageArt';

/**
 * Betting (`core/champ/bets.ts`): the next race and the season's title, a
 * driver or a team, with the coins the team has. The odds are all this
 * screen ever shows of the ratings behind them.
 */
export function Bets() {
  const b = useT().bets;
  const { state } = useChampionship();
  const mine = useMyBets();
  const now = useNow(5000);
  const minute = Math.floor(now / 60_000);
  const round = bettableRound(now);
  const season = seasonNumber(round);

  const view = useMemo(() => {
    if (!state) return null;
    const t = minute * 60_000;
    const settled = settledResults(state.cards, state.results, t);
    const card = state.cards.find((c) => c.round === round) ?? null;
    const field = card ? card.entries : eligibleEntries(state.entries, round);
    const ratings = ratingsBefore(state.cards, settled, round);
    return {
      card,
      field,
      race: { driver: raceOdds('driver', field, ratings), team: raceOdds('team', field, ratings) },
      season: {
        driver: seasonOdds('driver', round, state.cards, settled, field),
        team: seasonOdds('team', round, state.cards, settled, field),
      },
      decided: {
        driver: titleDecided('driver', round, state.cards, settled),
        team: titleDecided('team', round, state.cards, settled),
      },
    };
  }, [state, round, minute]);

  if (!state || !view || !mine) return <PageSkeleton variant="cards" />;

  return (
    <>
      <div className="card notched" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 14, marginBottom: 6 }}>
          <PageArt kind="bets" />
          <h1 className="display" style={{ margin: 0 }}>
            {b.title}
          </h1>
        </div>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {b.intro}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">{b.balance}</span>
          <strong className="mono" style={{ fontSize: 22 }}>
            <Coin /> {mine.balance}
          </strong>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 14 }}>
        <Market
          kind="race"
          title={b.nextRace(round, trackName(trackForRound(round)))}
          note={view.card ? b.final : b.estimate}
          runners={view.race}
          round={round}
          balance={mine.balance}
          uid={state.uid}
        />
        <Market
          kind="season"
          title={b.season(season)}
          note={b.seasonEstimate}
          runners={view.season}
          decided={view.decided}
          round={round}
          balance={mine.balance}
          uid={state.uid}
        />
      </div>

      <div className="card notched">
        <div className="head">
          <div className="eyebrow">{b.mine}</div>
        </div>
        {mine.book.rows.length === 0 ? (
          <div className="muted small">{b.none}</div>
        ) : (
          <table className="timing">
            <tbody>
              {mine.book.rows.map(({ bet, s }) => (
                <tr key={bet.id}>
                  <td>
                    <div className="small">
                      {bet.kind === 'race' ? b.onRace(bet.round) : b.onSeason(seasonNumber(bet.round), bet.round)}
                    </div>
                    <div className="tiny muted">
                      <Name>{pickLabel(bet, state.cards, state.entries)}</Name>
                      {s.odds !== null && <> · ×{s.odds}</>}
                      {s.status === 'void' && s.reason && <> · {b.voidReason[s.reason]}</>}
                    </div>
                  </td>
                  <td className="mono" style={{ textAlign: 'end' }}>
                    {bet.stake}
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    <span className={`pill small ${s.status === 'won' ? 'good' : s.status === 'lost' ? 'warn' : ''}`}>
                      {b.status[s.status]}
                    </span>
                  </td>
                  <td className="mono" style={{ textAlign: 'end' }}>
                    {s.status === 'won' ? b.won(s.payout) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="dim tiny" style={{ marginTop: 10 }}>
          {b.privacy}
        </div>
      </div>
    </>
  );
}

/** Who a bet backed, by name, from whatever still knows the id. */
function pickLabel(bet: Bet, cards: { entries: { id: string; uid: string; driver: string; team: string }[] }[], entries: { id: string; uid: string; driver: string; team: string }[]): string {
  const all = [...entries, ...cards.flatMap((c) => c.entries)];
  if (bet.market === 'driver') {
    const e = all.find((x) => x.id === bet.pick);
    return e ? driverName(e) : '-';
  }
  const e = all.find((x) => x.uid === bet.pick);
  return e ? teamName(e.team) : '-';
}

function Market({
  kind,
  title,
  note,
  runners,
  decided,
  round,
  balance,
  uid,
}: {
  kind: BetKind;
  title: string;
  note: string;
  runners: Record<BetMarket, Runner[]>;
  /** A title already won: no market. */
  decided?: Record<BetMarket, boolean>;
  round: number;
  balance: number;
  uid: string;
}) {
  const b = useT().bets;
  const { showToast } = useApp();
  const [market, setMarket] = useState<BetMarket>('driver');
  const [pick, setPick] = useState<string | null>(null);
  // 25 to start with, or whatever is left when that is less.
  const [stake, setStake] = useState(() => Math.max(MIN_STAKE, Math.min(25, balance)));
  const [busy, setBusy] = useState(false);
  const list = runners[market];
  const chosen = list.find((r) => r.id === pick) ?? null;
  const won = !!decided?.[market];
  const open = !won && Date.now() < startsAtForRound(round);

  const submit = async () => {
    if (!chosen) return;
    if (stake < MIN_STAKE) return showToast(b.limits(MIN_STAKE));
    if (stake > balance) return showToast(b.notEnough);
    setBusy(true);
    try {
      await placeBet(uid, {
        id: newBetId(),
        kind,
        market,
        pick: chosen.id,
        stake,
        round,
        raceId: raceIdForRound(round),
        seasonId: seasonForRound(round),
        placedAt: Date.now(),
      });
      showToast(b.placed);
      setPick(null);
    } catch {
      showToast(b.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card notched bet-market">
      <div className="head">
        <div className="eyebrow">{title}</div>
        <div className="fill" />
        <div className="segmented">
          {(['driver', 'team'] as const).map((m) => (
            <button
              key={m}
              className={market === m ? 'on' : ''}
              onClick={() => {
                setMarket(m);
                setPick(null);
              }}
            >
              {m === 'driver' ? b.driver : b.team}
            </button>
          ))}
        </div>
      </div>
      <div className="tiny muted" style={{ marginBottom: 8 }}>
        {note}
      </div>
      {won ? (
        <div className="muted small">{b.decided}</div>
      ) : list.length < 2 ? (
        <div className="muted small">{b.noField}</div>
      ) : (
        <div className="bet-runners" role="radiogroup" aria-label={b.pick}>
          {list.slice(0, 12).map((r) => (
            <button
              key={r.id}
              role="radio"
              aria-checked={pick === r.id}
              className={`bet-runner ${pick === r.id ? 'on' : ''}`}
              disabled={!open}
              onClick={() => setPick(r.id)}
            >
              <span className="bet-name">
                <Name>{market === 'driver' ? driverName({ id: r.id, driver: r.label }) : teamName(r.label)}</Name>
                {market === 'driver' && (
                  <span className="tiny dim">
                    {' '}
                    · <Name>{teamName(r.team)}</Name>
                  </span>
                )}
              </span>
              <span className="mono bet-odds">×{r.odds}</span>
            </button>
          ))}
        </div>
      )}
      {won ? null : !open ? (
        <div className="small muted" style={{ marginTop: 10 }}>
          {b.closed}
        </div>
      ) : (
        chosen && (
          <div className="bet-slip">
            <label className="small">{b.stake}</label>
            <div className="row wrap" style={{ gap: 6 }}>
              {[10, 25, 50, 100].map((v) => (
                <button key={v} className={`small ${stake === v ? 'on' : ''}`} onClick={() => setStake(v)} disabled={v > balance}>
                  {v}
                </button>
              ))}
              <button className={`small ${stake === balance ? 'on' : ''}`} onClick={() => setStake(balance)} disabled={balance < MIN_STAKE}>
                {b.allIn}
              </button>
              <input
                type="number"
                min={MIN_STAKE}
                max={balance}
                value={stake}
                onChange={(e) => setStake(Math.round(Number(e.target.value) || 0))}
                style={{ width: 90 }}
              />
            </div>
            <div className="small" style={{ margin: '8px 0' }}>
              {b.payout(Math.floor(stake * chosen.odds))}
            </div>
            <button className="primary" disabled={busy || stake > balance || stake < MIN_STAKE} onClick={submit}>
              {busy ? b.placing : `${b.place} · ${stake}`}
            </button>
          </div>
        )
      )}
    </div>
  );
}

/** On the championship page: the next race's favourite, and the way in. */
export function BetsCard() {
  const b = useT().bets;
  const { state } = useChampionship();
  const { go } = useApp();
  const now = useNow(30_000);
  const minute = Math.floor(now / 60_000);
  const round = bettableRound(now);
  const favourite = useMemo(() => {
    if (!state) return null;
    const settled = settledResults(state.cards, state.results, minute * 60_000);
    const card = state.cards.find((c) => c.round === round);
    const field = card ? card.entries : eligibleEntries(state.entries, round);
    if (field.length < 2) return null;
    return raceOdds('driver', field, ratingsBefore(state.cards, settled, round))[0] ?? null;
  }, [state, round, minute]);
  if (!favourite) return null;
  return (
    <div className="card notched bets-card" style={{ marginBottom: 14 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <Icon name="dice" size={28} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="eyebrow">{b.cardTitle}</div>
          <div className="small">
            {b.cardBody(driverName({ id: favourite.id, driver: favourite.label }), favourite.odds)}
          </div>
        </div>
        <button className="primary" onClick={() => go('bets')}>
          {b.open}
        </button>
      </div>
    </div>
  );
}

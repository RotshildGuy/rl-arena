import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store';
import { LEAGUE_NAME_MAX, type League } from '../../core/champ/league';
import { createLeague, inviteLink, leaguesAvailable, leaveLeague, myLeagues } from '../../storage/leagues';
import { useT } from '../../i18n';
import { Name } from './Name';

/** This account's leagues, re-read on demand. Empty without the cloud. */
export function useLeagues(): { leagues: League[]; reload(): void } {
  const [leagues, setLeagues] = useState<League[]>([]);
  const reload = useCallback(() => {
    if (!leaguesAvailable()) return;
    void myLeagues()
      .then(setLeagues)
      .catch(() => setLeagues([]));
  }, []);
  useEffect(reload, [reload]);
  return { leagues, reload };
}

/**
 * Start a league, invite people to it, or leave one. A league is a name and a
 * link; the table under it is the same races, counted only for its members.
 */
export function LeaguePanel({ leagues, onChanged }: { leagues: League[]; onChanged(): void }) {
  const { showToast, setLeague, leagueId } = useApp();
  const l10n = useT().leagues;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!leaguesAvailable()) {
    return (
      <div className="card notched" style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>{l10n.title}</div>
        <div className="muted small">{l10n.needsCloud}</div>
      </div>
    );
  }

  const create = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      const league = await createLeague(name);
      setName('');
      onChanged();
      setLeague(league.id);
      await copy(league);
    } catch {
      showToast(l10n.createFailed);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (league: League) => {
    const link = inviteLink(league.id);
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    try {
      if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await nav.share({ title: league.name, text: l10n.shareText(league.name), url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      showToast(l10n.copied);
    } catch {
      showToast(link);
    }
  };

  const leave = async (league: League) => {
    try {
      await leaveLeague(league.id);
      if (leagueId === league.id) setLeague(null);
      onChanged();
      showToast(l10n.left(league.name));
    } catch {
      showToast(l10n.leaveFailed);
    }
  };

  return (
    <div className="card notched" style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{l10n.title}</div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        {l10n.intro}
      </p>
      {leagues.map((l) => (
        <div className="row wrap" key={l.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <button className={`small ${leagueId === l.id ? 'cyan' : 'ghost'}`} onClick={() => setLeague(l.id)}>
            <Name>{l.name}</Name>
          </button>
          <span className="dim tiny">{l10n.members(l.members.length)}</span>
          <div style={{ flex: 1 }} />
          <button className="ghost small" onClick={() => void copy(l)}>
            {l10n.invite}
          </button>
          <button className="ghost small" onClick={() => void leave(l)}>
            {l10n.leave}
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          type="text"
          value={name}
          maxLength={LEAGUE_NAME_MAX}
          placeholder={l10n.newName}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
          {l10n.create}
        </button>
      </div>
    </div>
  );
}

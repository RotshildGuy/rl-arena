import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store';
import { LEAGUE_NAME_MAX, type League } from '../../core/champ/league';
import { createLeague, inviteLink, leaguesAvailable, leaveLeague, myLeagues } from '../../storage/leagues';

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
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!leaguesAvailable()) {
    return (
      <div className="card notched" style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>ליגת חברים</div>
        <div className="muted small">ליגות דורשות חיבור לענן, והאתר רץ כרגע בלעדיו.</div>
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
      showToast('יצירת הליגה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (league: League) => {
    const link = inviteLink(league.id);
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    try {
      if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await nav.share({ title: league.name, text: `הצטרפו לליגה "${league.name}" ב-RL Arena`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      showToast('קישור ההזמנה הועתק');
    } catch {
      showToast(link);
    }
  };

  const leave = async (league: League) => {
    try {
      await leaveLeague(league.id);
      if (leagueId === league.id) setLeague(null);
      onChanged();
      showToast(`יצאתם מ"${league.name}"`);
    } catch {
      showToast('היציאה נכשלה');
    }
  };

  return (
    <div className="card notched" style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>ליגת חברים</div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        אותם מרוצים, טבלה רק שלכם: ליגה סופרת רק את הרכבים של החברים בה, עם הנקודות שהם באמת צברו.
        מי שיש לו את הקישור יכול להצטרף.
      </p>
      {leagues.map((l) => (
        <div className="row wrap" key={l.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
          <button className={`small ${leagueId === l.id ? 'cyan' : 'ghost'}`} onClick={() => setLeague(l.id)}>
            {l.name}
          </button>
          <span className="dim tiny">{l.members.length} חברים</span>
          <div style={{ flex: 1 }} />
          <button className="ghost small" onClick={() => void copy(l)}>
            הזמנה
          </button>
          <button className="ghost small" onClick={() => void leave(l)}>
            יציאה
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          type="text"
          value={name}
          maxLength={LEAGUE_NAME_MAX}
          placeholder="שם לליגה חדשה"
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
          יצירה
        </button>
      </div>
    </div>
  );
}

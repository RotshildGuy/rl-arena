import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../store';
import { getArena } from '../../storage/arena';
import { deleteMyData } from '../deleteMyData';
import { getAuthView, isLinked, providerLabel, subscribeAuth } from '../auth';
import { AccountModal } from '../components/Account';
import { GRID_SIZE, MIN_ENTRIES, RACE_LAPS } from '../../core/champ/format';
import { MAX_CARS_PER_TEAM } from '../../core/champ/card';
import { NAME_MAX } from '../../core/champ/names';
import { POINTS, FASTEST_LAP_BONUS, CLASSIFY_FRACTION } from '../../core/champ/points';
import { lockLeadText } from '../../core/champ/schedule';
import { loadMetrics } from '../../storage/metrics';
import { dayKey, summarize, type MetricsSummary } from '../../core/metrics';
import { useT } from '../../i18n';

/**
 * The page nobody reads until they need it: how to play, what the rules are,
 * what is stored, and how to make it all go away. Kept on one screen with a
 * switcher rather than four, because a legal page split across four routes is a
 * legal page nobody finishes.
 */
type Tab = 'how' | 'terms' | 'privacy' | 'notices';

const TABS: Tab[] = ['how', 'terms', 'privacy', 'notices'];

export function Info() {
  const i = useT().info;
  const { go, infoTab, openInfo } = useApp();

  return (
    <>
      <div className="toolbar">
        <div className="title">
          <div className="eyebrow">{i.eyebrow}</div>
          <h1 className="display">{i.title}</h1>
        </div>
        <div className="actions">
          <div className="segmented">
            {TABS.map((tab) => (
              <button key={tab} className={infoTab === tab ? 'on' : ''} onClick={() => openInfo(tab)}>
                {i.tabs[tab]}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={() => go('championship')}>
            {i.back}
          </button>
        </div>
      </div>

      <div className="prose card notched">
        {infoTab === 'how' &&
          i.howTo({
            lockLead: lockLeadText(),
            maxCars: MAX_CARS_PER_TEAM,
            minEntries: MIN_ENTRIES,
            raceLaps: RACE_LAPS,
            gridSize: GRID_SIZE,
            points: POINTS.join(' · '),
            fastLapBonus: FASTEST_LAP_BONUS,
            classifyPct: Math.round(CLASSIFY_FRACTION * 100),
          })}
        {infoTab === 'terms' && i.terms(NAME_MAX)}
        {infoTab === 'privacy' && <Privacy />}
        {infoTab === 'notices' && <Notices />}
      </div>
    </>
  );
}

function Privacy() {
  const i = useT().info;
  const { openFeedback } = useApp();
  return (
    <>
      {i.privacy}
      {/* Privacy and takedown requests go through the same box as everything
          else, so the operator's own address never has to be on the page. */}
      <button className="ghost" onClick={openFeedback}>
        {i.toFeedback}
      </button>
    </>
  );
}

function Notices() {
  const i = useT().info;
  const [uid, setUid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(false);
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const showToast = useApp((s) => s.showToast);
  const go = useApp((s) => s.go);

  useEffect(() => {
    // At the gate, where this page is also reachable, there is no identity to
    // ask for and the arena would wait for one that never comes. Without cloud
    // keys ('off') there is one - the local arena's - and it is worth showing.
    if (auth.phase === 'out') return;
    void getArena()
      .then((a) => a.uid())
      .then(setUid)
      .catch(() => setUid(null));
  }, [auth.phase]);

  const wipe = async () => {
    setBusy(true);
    try {
      const report = await deleteMyData();
      // The name lives in the store too, and every header reads it from there.
      useApp.getState().adoptCompetitor('');
      showToast(i.deleted(report.models, report.entries));
      go('championship');
    } catch {
      showToast(i.deleteFailed);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      {i.disclaimers}

      <h3>{i.myAccount}</h3>
      {auth.phase !== 'in' ? (
        <p className="muted small">{i.noAccount}</p>
      ) : isLinked(auth) ? (
        <>
          <p className="small">
            {i.signedVia} {auth.email ? <b className="mono">{auth.email}</b> : null} {i.via}{' '}
            {auth.providers.map(providerLabel).join(' · ')}
            {i.anyDevice}
          </p>
          <button className="small" onClick={() => setAccount(true)}>
            {i.manage}
          </button>
        </>
      ) : (
        <>
          <p className="small">{i.guest}</p>
          <button className="small primary" onClick={() => setAccount(true)}>
            {i.link}
          </button>
        </>
      )}
      {account && <AccountModal onClose={() => setAccount(false)} />}

      {auth.phase === 'in' && <MetricsPanel />}

      <h3>{i.yourId}</h3>
      <p className="muted small">{i.idNote}</p>
      <p className="mono small" style={{ overflowWrap: 'anywhere' }}>
        {uid ?? '-'}
      </p>

      <h3>{i.deleteTitle}</h3>
      <p>{i.deleteBody}</p>
      <div className="row wrap">
        {auth.phase === 'out' ? (
          <span className="muted small">{i.needSignIn}</span>
        ) : confirming ? (
          <>
            <button className="danger" disabled={busy} onClick={() => void wipe()}>
              {busy ? i.deleting : i.confirmDelete}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {i.cancel}
            </button>
          </>
        ) : (
          <button className="danger" onClick={() => setConfirming(true)}>
            {i.deleteAll}
          </button>
        )}
      </div>
    </>
  );
}

/**
 * Retention for the operators, and nothing for anybody else.
 *
 * Only `admins()` may read the metrics collection, so for everybody else the
 * read is refused and the section never renders - there is no button to find
 * and no empty state to wonder about.
 */
function MetricsPanel() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadMetrics(45)
      .then((rows) => {
        if (!cancelled) setSummary(summarize(rows, dayKey(Date.now())));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const i = useT().info;
  if (!summary || summary.accounts === 0) return null;

  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '-');
  const { funnel } = summary;
  return (
    <>
      <h3>{i.metrics}</h3>
      <p className="muted small">{i.metricsWindow(summary.accounts)}</p>
      <ul className="small">
        {summary.retention.map((r) => (
          <li key={r.day}>
            {i.returned(r.day)} <b>{pct(r.returned, r.cohort)}</b>{' '}
            <span className="muted">{i.ofCohort(r.returned, r.cohort)}</span>
          </li>
        ))}
        <li>
          {i.reachedEntry} <b>{pct(funnel.enter, funnel.visit)}</b>{' '}
          <span className="muted">{i.funnel(funnel.visit, funnel.train, funnel.save, funnel.enter, funnel.watch)}</span>
        </li>
      </ul>
    </>
  );
}

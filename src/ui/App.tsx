import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useApp, type Screen } from './store';
import { getCloudStatus, subscribeCloudStatus } from '../storage';
import { getAuthView, subscribeAuth } from './auth';
import { getCompetitor, pullCompetitor } from './identity';
import { claimName, NameTakenError } from '../storage/teamNames';
import { teamColor } from '../core/champ/livery';
import { Championship } from './screens/Championship';
import { Standings } from './screens/Standings';
import { Broadcast } from './screens/Broadcast';
import { RaceReport } from './screens/RaceReport';
import { Garage } from './screens/Garage';
import { TrainSetup } from './screens/TrainSetup';
import { TrainDashboard } from './screens/TrainDashboard';
import { RaceSetup } from './screens/RaceSetup';
import { RaceScreen } from './screens/RaceScreen';
import { Info } from './screens/Info';
import { Feedback } from './screens/Feedback';
import { Shop } from './screens/Shop';
import { SignIn } from './screens/SignIn';
import { AccountButton } from './components/Account';
import { ThemeButton } from './components/ThemeButton';
import { CoachAnchor, useCoachStep } from './coach';
import { useIsNarrow } from './device';
import { track } from '../storage/metrics';
import { joinLeague, leaguesAvailable } from '../storage/leagues';

interface Tab {
  id: Screen;
  label: string;
  glyph: string;
  /** Other screens that should keep this tab lit. */
  also?: Screen[];
}

const TABS: Tab[] = [
  { id: 'championship', label: 'אליפות', glyph: '🏁', also: ['broadcast', 'report'] },
  { id: 'standings', label: 'טבלאות', glyph: '📊' },
  { id: 'library', label: 'המוסך', glyph: '🔧', also: ['trainSetup', 'training'] },
  { id: 'raceSetup', label: 'לשחק', glyph: '🎮', also: ['race'] },
  { id: 'shop', label: 'חנות', glyph: '🛒' },
];

/**
 * The identity gate.
 *
 * Nothing under it may mount before there is an account to own what it reads:
 * every screen goes to the library or to the grid, and both are per-identity.
 * Keeping the whole app behind one branch - rather than letting each screen
 * cope with "no user yet" - is also what keeps the stores simple, because by
 * the time anything calls them the answer exists.
 *
 * Somebody who signed in on this device before never sees any of this: Firebase
 * restores the session, so the gate only stands in front of a genuinely new
 * visit. Without cloud keys there is nothing to sign in to, and the app opens
 * straight into its local championship exactly as it always did.
 *
 * `needsDoor` is the third case, and the reason the gate is not simply "is
 * anybody signed in". Before there was a sign-in screen the app minted an
 * anonymous identity by itself on first load, so a browser can hold a session
 * nobody ever chose - and a session nobody chose would otherwise sail past the
 * door forever, which is how somebody signs into their account on a second
 * device and lands in an empty garage that is not theirs.
 */
export function App() {
  const screen = useApp((s) => s.screen);
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);

  if (auth.phase === 'loading') return <Splash />;
  if (auth.phase === 'out' || auth.needsDoor) {
    // The rules and the privacy notice are part of deciding whether to sign in
    // at all, so they stay reachable from the door.
    return screen === 'info' ? <GateInfo /> : <SignIn />;
  }
  return <Arena />;
}

function Arena() {
  const screen = useApp((s) => s.screen);
  const adoptCompetitor = useApp((s) => s.adoptCompetitor);
  const toast = useApp((s) => s.toast);
  const go = useApp((s) => s.go);
  const openInfo = useApp((s) => s.openInfo);
  const openFeedback = useApp((s) => s.openFeedback);

  // Every screen opens at its top. The page itself never scrolls - `.content`
  // does - and it would otherwise keep the scroll of the screen before, so a
  // race report opened from far down the championship screen started halfway.
  const contentRef = useRef<HTMLElement>(null);
  const viewRaceId = useApp((s) => s.viewRaceId);
  const infoTab = useApp((s) => s.infoTab);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo(0, 0);
  }, [screen, viewRaceId, infoTab]);
  // And it stays at its top. An iPhone still moves the page itself now and then
  // (a pull past the top of a list, or the keyboard lifting a field into view
  // and leaving the page where it was when it closes), and a moved page takes
  // the bottom navigation off the screen. While a field is being typed into
  // the move is left alone, so the keyboard does not cover it.
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };
    const settle = () => {
      if ((window.scrollY !== 0 || window.scrollX !== 0) && !typing()) window.scrollTo(0, 0);
    };
    // After focus leaves a field, the next field may already have it.
    const afterBlur = () => setTimeout(settle, 50);
    window.addEventListener('scroll', settle, { passive: true });
    document.addEventListener('focusout', afterBlur);
    return () => {
      window.removeEventListener('scroll', settle);
      document.removeEventListener('focusout', afterBlur);
    };
  }, []);
  const cloud = useSyncExternalStore(subscribeCloudStatus, getCloudStatus);
  const auth = useSyncExternalStore(subscribeAuth, getAuthView);
  const competitor = useApp((s) => s.competitor);
  const coach = useCoachStep();

  // Counted once a day, behind the gate: a visit is somebody who came in.
  useEffect(() => track('visit'), []);

  // An invitation link (?league=id): join, then show that league's table. Done
  // here, behind the gate, because joining needs the account to join with -
  // somebody who arrives signed out comes back to it once they are in.
  const setLeague = useApp((s) => s.setLeague);
  const showToast = useApp((s) => s.showToast);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('league');
    if (!id || !leaguesAvailable()) return;
    params.delete('league');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    void joinLeague(id)
      .then((league) => {
        setLeague(league.id);
        go('standings');
        showToast(`הצטרפתם לליגה "${league.name}"`);
      })
      .catch(() => showToast('הקישור לליגה לא עבד - אולי הליגה נמחקה'));
  }, [go, setLeague, showToast]);

  // The team name lives with the account, not with the browser, so the first
  // thing to do behind the gate is ask the account what it is. On the device
  // that already knows, this changes nothing; on a new one it is the difference
  // between racing as yourself and being asked to type your name again.
  //
  // Then the name is claimed, which is a no-op for a name that is already this
  // account's. A name picked before names were unique may turn out to be
  // somebody else's; the championship screen then asks for another one.
  const setNameTaken = useApp((s) => s.setNameTaken);
  useEffect(() => {
    void pullCompetitor().then(async (name) => {
      if (name) adoptCompetitor(name);
      const current = getCompetitor();
      if (!current) return;
      try {
        await claimName(current);
      } catch (err) {
        if (err instanceof NameTakenError) setNameTaken(true);
      }
    });
  }, [adoptCompetitor, setNameTaken]);

  // The match screen takes the whole viewport on a phone in landscape and draws
  // its own chrome; a header and a nav bar on top of it would eat the track.
  const bare = screen === 'race' || screen === 'broadcast';

  // On a phone the tabs are a bar at the bottom, and that bar is the last row
  // of the app's column rather than something pinned over the page: pinned, it
  // lands behind a bottom browser toolbar or the phone's navigation buttons.
  const narrow = useIsNarrow();
  const nav = (
    <nav className={narrow ? 'nav bottom' : 'nav'} aria-label="ניווט ראשי">
      {TABS.map((t) => {
        // The garage is the only tab the guide ever points at, and it does
        // so for two different reasons: nothing built yet, or something
        // built that never made it onto the grid.
        const nudge = t.id === 'library' && (coach === 'garage' || coach === 'unregistered');
        return (
          <CoachAnchor
            key={t.id}
            step={nudge ? coach : null}
            text={
              coach === 'garage'
                ? 'עכשיו למוסך - שם מאמנים את המודל שינהג בשבילכם.'
                : 'המודל שלכם עדיין לא על הגריד. חזרו למוסך כדי לרשום אותו לאליפות.'
            }
          >
            <button
              className={screen === t.id || t.also?.includes(screen) ? 'on' : ''}
              aria-label={t.label}
              aria-current={screen === t.id || t.also?.includes(screen) ? 'page' : undefined}
              onClick={() => go(t.id)}
            >
              <span className="glyph" aria-hidden="true">{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          </CoachAnchor>
        );
      })}
    </nav>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">RL</span>
          <span>ARENA</span>
          <span className="sub">CHAMPIONSHIP</span>
        </div>

        {!narrow && nav}

        <div className="spacer" />

        <button className="ghost small info-link" onClick={() => openInfo('how')} title="הוראות, תנאי שימוש ופרטיות">
          מידע
        </button>
        <ThemeButton />
        <AccountButton />
        {competitor && (
          <span className="pill" title="שם המתחרה שלכם - הקבוצה שהמודלים שלכם מתחרים בשמה">
            <span className="livery" style={{ background: teamColor(competitor), width: 4, height: 12 }} />
            {/* Its own direction: a Latin name inside the RTL bar was cut off
                from its start, losing exactly the part that identifies it. */}
            <bdi dir="auto" className="pill-name">{competitor}</bdi>
          </span>
        )}
        {/* A guest is told they are a guest. A green "connected" next to an
            anonymous identity read as "signed in, my progress is safe". */}
        {auth.anonymous && cloud.state === 'ok' ? (
          <span
            className="pill small"
            title="אתם משחקים כאורחים: ההתקדמות שמורה, אבל רק בדפדפן הזה. כדי לשמור אותה גם במכשיר אחר, לחצו על שמירת החשבון."
          >
            👤 אורח
          </span>
        ) : (
          <CloudBadge state={cloud.state} message={cloud.message} />
        )}
      </header>

      <main ref={contentRef} className="content" style={bare ? { padding: 0, overflow: 'hidden' } : undefined}>
        <div className="wrap" style={bare ? { maxWidth: 'none', height: '100%' } : undefined}>
          {screen === 'championship' && <Championship />}
          {screen === 'standings' && <Standings />}
          {screen === 'broadcast' && <Broadcast />}
          {screen === 'report' && <RaceReport />}
          {screen === 'library' && <Garage />}
          {screen === 'trainSetup' && <TrainSetup />}
          {screen === 'training' && <TrainDashboard />}
          {screen === 'raceSetup' && <RaceSetup />}
          {screen === 'race' && <RaceScreen />}
          {screen === 'info' && <Info />}
          {screen === 'feedback' && <Feedback />}
          {screen === 'shop' && <Shop />}
          {!bare && screen !== 'info' && <Footer onOpen={openInfo} onFeedback={openFeedback} />}
        </div>
      </main>

      {narrow && nav}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * The half-second before Firebase says who is signed in.
 *
 * It is the difference between a returning visitor seeing their championship
 * appear and seeing a sign-in screen flash past first - which would read as
 * having been logged out.
 */
/**
 * The first moment, while the account is restored: the app's frame with soft
 * shapes where the content will be. The same markup is in index.html, so the
 * hand-over from the page to React does not move anything.
 */
function Splash() {
  return (
    <div className="skel-app" aria-busy aria-label="טוען">
      <div className="skel-top">
        <span className="brand"><span className="mark">RL</span> <span>ARENA</span></span>
        <span className="skel pill wide-only" style={{ width: '300px', height: '34px' }}></span>
        <span className="grow"></span>
        <span className="skel pill" style={{ width: '34px', height: '30px' }}></span>
        <span className="skel pill" style={{ width: '84px', height: '30px' }}></span>
      </div>
      <div className="skel-body">
        <span className="skel" style={{ width: '130px', height: '12px' }}></span>
        <span className="skel" style={{ width: 'min(420px, 80%)', height: '30px' }}></span>
        <span className="skel" style={{ width: 'min(560px, 95%)', height: '14px' }}></span>
        <div className="skel-cols">
          <div className="skel-card" style={{ minHeight: '280px' }}>
            <span className="skel" style={{ width: '40%', height: '12px' }}></span>
            <span className="skel" style={{ width: '70%', height: '34px' }}></span>
            <span className="skel" style={{ width: '55%', height: '52px' }}></span>
            <span className="skel" style={{ width: '100%', height: '64px' }}></span>
            <span className="skel pill" style={{ width: '160px', height: '38px' }}></span>
          </div>
          <div className="skel-card" style={{ minHeight: '200px' }}>
            <span className="skel" style={{ width: '35%', height: '12px' }}></span>
            <span className="skel" style={{ width: '100%', height: '40px' }}></span>
            <span className="skel" style={{ width: '100%', height: '40px' }}></span>
            <span className="skel" style={{ width: '100%', height: '40px' }}></span>
          </div>
        </div>
      </div>
      <div className="skel-nav" />
    </div>
  );
}

/** The information screen, reachable from the sign-in gate itself. */
function GateInfo() {
  return (
    <div className="app">
      <main className="content">
        <div className="wrap">
          <Info />
        </div>
      </main>
    </div>
  );
}

/**
 * Every page ends with the way out to the rules and the privacy notice. A link
 * in the header alone is a link nobody finds on a phone, where the header is
 * three things wide.
 */
function Footer({
  onOpen,
  onFeedback,
}: {
  onOpen: (tab: 'how' | 'terms' | 'privacy' | 'notices') => void;
  onFeedback(): void;
}) {
  return (
    <footer className="site-foot">
      <button className="ghost small" onClick={onFeedback}>
        🐞 באג או רעיון?
      </button>
      <span className="dim">·</span>
      <button className="ghost small" onClick={() => onOpen('how')}>
        איך זה עובד
      </button>
      <span className="dim">·</span>
      <button className="ghost small" onClick={() => onOpen('terms')}>
        תנאי שימוש
      </button>
      <span className="dim">·</span>
      <button className="ghost small" onClick={() => onOpen('privacy')}>
        פרטיות
      </button>
      <span className="dim">·</span>
      <button className="ghost small" onClick={() => onOpen('notices')}>
        חשבון ונתונים
      </button>
      <div className="grow" />
      <span className="dim tiny">פרויקט חובבים · ללא קשר לשום סדרת מרוצים אמיתית</span>
    </footer>
  );
}

/**
 * Reports what actually happened, not what was configured. Showing a cloud icon
 * while sync is silently failing is worse than showing no cloud icon at all.
 */
function CloudBadge({ state, message }: { state: string; message: string | null }) {
  if (state === 'local') {
    return (
      <span className="pill small" title="אין חיבור ענן - האליפות רצה מול המודלים של הדפדפן הזה בלבד">
        💾 מקומי
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span className="pill small" title="מתחבר ל-Firestore">
        ☁ מתחבר…
      </span>
    );
  }
  if (state === 'ok') {
    return (
      <span className="pill small good" title="המודלים והאליפות מסונכרנים עם השרת. זה לא אומר שיש חשבון - את זה מראה כפתור החשבון.">
        ☁ מסונכרן
      </span>
    );
  }
  return (
    <span className="pill small warn" title={message ?? 'סנכרון הענן נכשל'}>
      ⚠ ענן לא זמין
    </span>
  );
}

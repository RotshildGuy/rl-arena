import { useEffect, useSyncExternalStore } from 'react';
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
import { SignIn } from './screens/SignIn';
import { AccountButton } from './components/Account';
import { CoachAnchor, useCoachStep } from './coach';
import { useIsNarrow } from './device';

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
];

/**
 * The identity gate.
 *
 * Nothing under it may mount before there is an account to own what it reads:
 * every screen goes to the library or to the grid, and both are per-identity.
 * Keeping the whole app behind one branch — rather than letting each screen
 * cope with "no user yet" — is also what keeps the stores simple, because by
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
 * nobody ever chose — and a session nobody chose would otherwise sail past the
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
  const cloud = useSyncExternalStore(subscribeCloudStatus, getCloudStatus);
  const competitor = useApp((s) => s.competitor);
  const coach = useCoachStep();

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
    <nav className={narrow ? 'nav bottom' : 'nav'}>
      {TABS.map((t) => {
        // The garage is the only tab the guide ever points at, and it does
        // so for two different reasons: nothing built yet, or something
        // built that never made it onto the grid.
        const nudge = t.id === 'library' && (coach === 'garage' || coach === 'unregistered');
        return (
          <CoachAnchor
            key={t.id}
            on={nudge}
            text={
              coach === 'garage'
                ? 'עכשיו למוסך — שם מאמנים את המודל שינהג בשבילכם.'
                : 'המודל שלכם עדיין לא על הגריד. חזרו למוסך כדי לרשום אותו לאליפות.'
            }
          >
            <button
              className={screen === t.id || t.also?.includes(screen) ? 'on' : ''}
              onClick={() => go(t.id)}
            >
              <span className="glyph">{t.glyph}</span>
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
        <AccountButton />
        {competitor && (
          <span className="pill" title="שם המתחרה שלך — הקבוצה שהמודלים שלך מתחרים בשמה">
            <span className="livery" style={{ background: teamColor(competitor), width: 4, height: 12 }} />
            {competitor}
          </span>
        )}
        <CloudBadge state={cloud.state} message={cloud.message} />
      </header>

      <main className="content" style={bare ? { padding: 0, overflow: 'hidden' } : undefined}>
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
          {!bare && screen !== 'info' && <Footer onOpen={openInfo} />}
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
 * appear and seeing a sign-in screen flash past first — which would read as
 * having been logged out.
 */
function Splash() {
  return (
    <div className="signin">
      <div className="brand" style={{ opacity: 0.6 }}>
        <span className="mark">RL</span>
        <span>ARENA</span>
      </div>
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
function Footer({ onOpen }: { onOpen: (tab: 'how' | 'terms' | 'privacy' | 'notices') => void }) {
  return (
    <footer className="site-foot">
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
        קרדיטים
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
      <span className="pill small" title="אין חיבור ענן — האליפות רצה מול המודלים של הדפדפן הזה בלבד">
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
      <span className="pill small good" title="מחובר לאליפות המשותפת">
        ☁ מחובר
      </span>
    );
  }
  return (
    <span className="pill small warn" title={message ?? 'סנכרון הענן נכשל'}>
      ⚠ ענן לא זמין
    </span>
  );
}

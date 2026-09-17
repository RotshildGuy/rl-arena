import { useSyncExternalStore } from 'react';
import { useApp, type Screen } from './store';
import { getCloudStatus, subscribeCloudStatus } from '../storage';
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

export function App() {
  const screen = useApp((s) => s.screen);
  const toast = useApp((s) => s.toast);
  const go = useApp((s) => s.go);
  const openInfo = useApp((s) => s.openInfo);
  const cloud = useSyncExternalStore(subscribeCloudStatus, getCloudStatus);
  const competitor = useApp((s) => s.competitor);

  // The match screen takes the whole viewport on a phone in landscape and draws
  // its own chrome; a header and a nav bar on top of it would eat the track.
  const bare = screen === 'race' || screen === 'broadcast';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">RL</span>
          <span>ARENA</span>
          <span className="sub">CHAMPIONSHIP</span>
        </div>

        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={screen === t.id || t.also?.includes(screen) ? 'on' : ''}
              onClick={() => go(t.id)}
            >
              <span className="glyph">{t.glyph}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="spacer" />

        <button className="ghost small info-link" onClick={() => openInfo('how')} title="הוראות, תנאי שימוש ופרטיות">
          מידע
        </button>
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

      {toast && <div className="toast">{toast}</div>}
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

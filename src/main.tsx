import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { initTheme } from './ui/theme';
import { initLang, subscribeLang, t } from './i18n';
import { startFreshIfNewEpoch } from './ui/forgetLocal';
import { registerServiceWorker } from './ui/serviceWorker';
import { startSlidingTabs } from './ui/slidingTabs';

initTheme();
initLang();
// The tab's title follows the language; index.html carries the Hebrew one.
const retitle = () => (document.title = t().app.docTitle);
retitle();
subscribeLang(retitle);
startSlidingTabs();
registerServiceWorker();

// A fresh start of the database is a fresh start of every browser too, and it
// has to finish before anything reads what the browser kept - which the app's
// modules already do as they load (the team name, the guide's progress), so
// they are imported only after it. Theme and language survive it, so the two
// read above are safe.
void startFreshIfNewEpoch().then(async () => {
  const [{ App }, { ErrorBoundary }, { useApp }, { startAuth }] = await Promise.all([
    import('./ui/App'),
    import('./ui/components/ErrorBoundary'),
    import('./ui/store'),
    import('./ui/auth'),
  ]);

  // Before the first render: the session Firebase already has is what decides
  // whether anybody sees the sign-in screen at all, and asking early means a
  // returning visitor never sees it flash.
  startAuth();

  // No StrictMode: its double-invoked effects would spawn two training workers.
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary page onHome={() => useApp.getState().go('championship')}>
      <App />
    </ErrorBoundary>,
  );
});

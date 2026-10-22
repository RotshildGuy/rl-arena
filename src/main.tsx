import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { useApp } from './ui/store';
import { startAuth } from './ui/auth';
import './ui/styles.css';
import { initTheme } from './ui/theme';
import { initLang, subscribeLang, t } from './i18n';
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

import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { initTheme } from './ui/theme';
import { startFreshIfNewEpoch } from './ui/forgetLocal';
import { refreshPush, registerServiceWorker } from './ui/push';

initTheme();
registerServiceWorker();

// A fresh start of the database is a fresh start of every browser too, and it
// has to finish before anything reads what the browser kept - which the app's
// modules already do as they load (the team name, the guide's progress), so
// they are imported only after it.
void startFreshIfNewEpoch().then(async () => {
  const [{ App }, { startAuth }] = await Promise.all([import('./ui/App'), import('./ui/auth')]);

  // Before the first render: the session Firebase already has is what decides
  // whether anybody sees the sign-in screen at all, and asking early means a
  // returning visitor never sees it flash.
  startAuth();

  // Waits for the sign-in like every other cloud write, so it never delays the page.
  void refreshPush();

  // No StrictMode: its double-invoked effects would spawn two training workers.
  createRoot(document.getElementById('root')!).render(<App />);
});

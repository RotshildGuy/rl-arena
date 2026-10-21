import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { startAuth } from './ui/auth';
import './ui/styles.css';
import { initTheme } from './ui/theme';
import { refreshPush, registerServiceWorker } from './ui/push';

initTheme();
registerServiceWorker();

// Before the first render: the session Firebase already has is what decides
// whether anybody sees the sign-in screen at all, and asking early means a
// returning visitor never sees it flash.
startAuth();

// Waits for the sign-in like every other cloud write, so it never delays the page.
void refreshPush();

// No StrictMode: its double-invoked effects would spawn two training workers.
createRoot(document.getElementById('root')!).render(<App />);
